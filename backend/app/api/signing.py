import asyncio
import os
import io
import uuid
import shutil
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.models import Envelope, Recipient, Field, Signature, AuditEvent, DomainVerification, CorrectionRequest
from app.schemas import (
    SigningSessionOut, SubmitSignaturesRequest, FieldOut, RecipientOut, RecipientPublicOut,
    DeclineRequest, DelegateRequest, CorrectionRequestCreate, CorrectionRequestOut,
    SigningVerificationSendResponse, SigningVerificationVerifyRequest, SigningVerificationVerifyResponse,
)
from app.services.verification_channels.manager import (
    send_recipient_otp,
    verify_recipient_otp,
    get_recipient_target,
)
from app.services.verification_channels.base import obfuscate_target
from app.services.contract_analyzer import ContractAnalyzer
from app.services.qr_generator import generate_qr_base64
from app.services.pdf_service import (
    overlay_fields_on_pdf, 
    generate_certificate_of_completion_pdf, 
    append_certificate_page,
    get_pdf_pages_info,
    render_pdf_page_png
)
from app.services.crypto_engine import sign_pdf_with_pades, calculate_file_sha256
from app.services.storage_layout import artifact_path, ensure_dir
from app.services.webhook_dispatcher import WebhookDispatcher
from app.services import mailer, smtp_config
from app.api.ws import manager

router = APIRouter(prefix="/signing", tags=["signing"])

def _envelope_artifact_path(envelope: Envelope, filename: str) -> str:
    """
    Completion artifacts live in the owning account's storage directory. Rows
    created before accounts existed keep their flat, original-path-derived
    directory, so legacy envelopes complete exactly as they always did.
    """
    if envelope.account_id:
        path = artifact_path(settings.STORAGE_DIR, envelope.account_id, filename)
        ensure_dir(os.path.dirname(path))
        return path
    return os.path.join(os.path.dirname(envelope.original_pdf_path), filename)

def _assert_token_live(recipient: Recipient) -> None:
    """
    Reject a signing link whose expiry has passed. Recipients created before expiry
    tracking carry no expiry and stay valid, so this cannot retroactively lock anyone out.
    """
    expires_at = getattr(recipient, "token_expires_at", None)
    if expires_at is None:
        return
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(
            status_code=410,
            detail="This signing link has expired. Please ask the sender to issue a new one.",
        )

def _assert_signer_verified(recipient: Recipient) -> None:
    """
    If the recipient has a verification channel requirement other than 'none',
    access to the document PDF, pages, or signature submission is forbidden
    until verified_at is stamped.
    """
    channel = getattr(recipient, "verification_channel", "none") or "none"
    if channel != "none" and getattr(recipient, "verified_at", None) is None:
        raise HTTPException(
            status_code=403,
            detail="Signer identity verification required before accessing document content.",
        )



@router.get("/{token}", response_model=SigningSessionOut)
async def get_signing_session(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(
            selectinload(Recipient.envelope).selectinload(Envelope.recipients),
            selectinload(Recipient.envelope).selectinload(Envelope.fields),
        )
    )
    result = await db.execute(query)
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid or expired signing link.")

    _assert_token_live(recipient)
        
    envelope = recipient.envelope
    
    # Record 'opened' event if first time
    if recipient.status == "sent" or recipient.status == "waiting":
        recipient.status = "opened"
        ip = request.client.host if request.client else "127.0.0.1"
        ua = request.headers.get("User-Agent", "Browser")
        audit = AuditEvent(
            envelope_id=envelope.id,
            event_type="opened",
            actor_name=recipient.name,
            actor_email=recipient.email,
            ip_address=ip,
            user_agent=ua,
            description=f"Recipient {recipient.name} ({recipient.email}) viewed the document.",
        )
        db.add(audit)
        await db.commit()

        await WebhookDispatcher.dispatch_event(
            db, envelope.account_id, "recipient.opened", {
                "envelope_id": envelope.id,
                "recipient_name": recipient.name,
                "recipient_email": recipient.email
            }
        )
        
    pdf_url = f"{settings.API_V1_STR}/signing/{token}/pdf"
    
    requires_verif = (recipient.verification_channel or "none") != "none"
    is_verif = (not requires_verif) or (recipient.verified_at is not None)
    target = get_recipient_target(recipient) if requires_verif else None
    target_obf = obfuscate_target(recipient.verification_channel or "none", target) if requires_verif else None

    return SigningSessionOut(
        envelope_id=envelope.id,
        envelope_title=envelope.title,
        recipient=RecipientOut.model_validate(recipient),
        pdf_url=pdf_url,
        fields=[FieldOut.model_validate(f) for f in envelope.fields],
        # Public projection: co-signer progress without their signing tokens.
        all_recipients=[RecipientPublicOut.model_validate(r) for r in envelope.recipients],
        requires_verification=requires_verif,
        verification_channel=recipient.verification_channel or "none",
        target_obfuscated=target_obf,
        is_verified=is_verif,
    )

@router.get("/{token}/pdf")
async def get_signing_pdf(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    _assert_signer_verified(recipient)
        
    envelope = recipient.envelope
    pdf_path = envelope.signed_pdf_path or envelope.original_pdf_path
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF file not found.")
        
    return FileResponse(pdf_path, media_type="application/pdf")

@router.get("/{token}/pages")
async def get_signing_pages(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """Returns page list and aspect ratios for the document being signed."""
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    _assert_signer_verified(recipient)
    envelope = recipient.envelope
    pdf_path = envelope.original_pdf_path
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF document not found.")

    # fitz parse of the whole document; off the event loop.
    pages_info = await asyncio.to_thread(get_pdf_pages_info, pdf_path)
    pages = []
    for p in pages_info:
        p_num = p["page_number"]
        pages.append({
            "page_number": p_num,
            "width": p["width"],
            "height": p["height"],
            "aspect_ratio": p["aspect_ratio"],
            "url": f"/api/signing/{token}/pages/{p_num}"
        })
    return {"page_count": len(pages), "pages": pages}

@router.get("/{token}/pages/{page_number}")
async def get_signing_page_image(
    token: str,
    page_number: int,
    dpi: int = 150,
    db: AsyncSession = Depends(get_db)
):
    """Renders a specific page of the signing envelope as a PNG image."""
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    _assert_signer_verified(recipient)
    envelope = recipient.envelope
    pdf_path = envelope.original_pdf_path
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF document not found.")

    # Bound the render cost; dpi is caller-supplied on a signed-in route.
    dpi = max(72, min(dpi, 300))
    png_bytes = await asyncio.to_thread(render_pdf_page_png, pdf_path, page_number, dpi=dpi)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f"inline; filename=page_{page_number}.png"
        }
    )


@router.get("/{token}/mobile_handshake")
async def mobile_handshake(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate dynamic QR code for 'Scan to Sign on Phone' hand-off.
    """
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
        
    envelope = recipient.envelope
    signing_url = f"{settings.APP_URL}/sign/{token}?mobile=true"
    qr_b64 = generate_qr_base64(signing_url)
    
    # Audit log mobile hand-off
    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="mobile_handshake",
        actor_name=recipient.name,
        actor_email=recipient.email,
        description=f"Generated mobile touchscreen hand-off QR code for {recipient.name}.",
    )
    db.add(audit)
    await db.commit()
    
    return {
        "signing_url": signing_url,
        "qr_base64": qr_b64
    }

@router.post("/{token}/verification/send", response_model=SigningVerificationSendResponse)
async def send_verification_code(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Dispatch a one-time verification passcode to the signer via their designated channel.
    Enforces a 30-second cooldown between requests.
    """
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)

    if recipient.verified_at is not None:
        target = get_recipient_target(recipient)
        return SigningVerificationSendResponse(
            success=True,
            channel=recipient.verification_channel or "none",
            target_obfuscated=obfuscate_target(recipient.verification_channel or "none", target),
            message="Signer identity is already verified.",
            cooldown_seconds=0,
        )

    res = await send_recipient_otp(recipient, recipient.envelope, db)
    if not res["success"]:
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to send verification code."))

    return SigningVerificationSendResponse(
        success=True,
        channel=res["channel"],
        target_obfuscated=res["target_obfuscated"],
        message=res["message"],
        cooldown_seconds=30,
    )


@router.post("/{token}/verification/verify", response_model=SigningVerificationVerifyResponse)
async def verify_verification_code(
    token: str,
    payload: SigningVerificationVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify the one-time passcode submitted by the signer.
    On success, unlocks document access and records an evidentiary audit event.
    """
    query = select(Recipient).where(Recipient.signing_token == token)
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")

    res = await verify_recipient_otp(recipient, payload.code, ip, ua, db)
    if not res["success"]:
        raise HTTPException(status_code=400, detail=res.get("error", "Verification failed."))

    return SigningVerificationVerifyResponse(
        success=True,
        verified=True,
        message=res["message"],
    )


@router.post("/{token}/submit")
async def submit_signatures(
    token: str,
    req: SubmitSignaturesRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(
            selectinload(Recipient.envelope).selectinload(Envelope.recipients),
            selectinload(Recipient.envelope).selectinload(Envelope.fields),
            selectinload(Recipient.envelope).selectinload(Envelope.audit_events),
        )
    )
    result = await db.execute(query)
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    _assert_signer_verified(recipient)

    # Bound the signature image payload before doing any work. It is stored in
    # the database verbatim, so an unbounded base64 blob is a memory/DB DoS.
    if req.signature_data_url and len(req.signature_data_url) > 2_000_000:
        raise HTTPException(
            status_code=413,
            detail="Signature image is too large. Please use a smaller signature."
        )

    envelope = recipient.envelope
    if envelope.status in ["completed", "voided", "declined"]:
        raise HTTPException(status_code=400, detail=f"Document is already {envelope.status}.")

    if recipient.status == "signed":
        raise HTTPException(status_code=400, detail="You have already signed this document.")

    # Sequential routing: a recipient may only sign once everyone ahead of them has.
    # The routing order was previously modelled but never enforced, so any recipient
    # could sign at any time.
    blocking = [
        r for r in envelope.recipients
        if r.role == "signer"
        and r.status not in ["signed", "declined", "delegated"]
        and (r.routing_order or 1) < (recipient.routing_order or 1)
    ]
    if blocking:
        waiting_on = min(blocking, key=lambda r: (r.routing_order or 1))
        raise HTTPException(
            status_code=409,
            detail=(
                f"This document is routed sequentially. It is not your turn yet; "
                f"it is currently awaiting {waiting_on.name}."
            ),
        )

    # Serialise completion. Without this lock two recipients submitting at the same
    # moment can both observe "all signed" and each run the sealing pipeline.
    await db.execute(
        select(Envelope.id).where(Envelope.id == envelope.id).with_for_update()
    )

    # The lock serialises concurrent submitters, but the recipient/field rows
    # were loaded before it was acquired. After waiting on the lock, this
    # request would otherwise evaluate completion against the stale snapshot it
    # started with (expire_on_commit=False), never see the first submitter's
    # commit, conclude "not all signed", and leave the envelope stuck in
    # "delivered" forever. Re-read the collections under the lock.
    envelope = (
        await db.execute(
            select(Envelope)
            .where(Envelope.id == envelope.id)
            .options(
                selectinload(Envelope.recipients),
                selectinload(Envelope.fields),
                selectinload(Envelope.audit_events),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    recipient = next(r for r in envelope.recipients if r.id == recipient.id)

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")

    # 1. Update field values. A signer may only write fields assigned to them
    # (or unassigned fields): submission values are flattened into the sealed
    # PDF and attributed to the field's owner, so writing another signer's
    # field would alter their executed document.
    for sig_sub in req.signatures:
        f = next((field for field in envelope.fields if field.id == sig_sub.field_id), None)
        if f is None or (f.recipient_id and f.recipient_id != recipient.id):
            continue
        f.value = sig_sub.value

    # 2. Record Signature record
    if req.signature_data_url:
        sig_record = Signature(
            envelope_id=envelope.id,
            recipient_id=recipient.id,
            signature_type=req.signature_type or "draw",
            signature_data=req.signature_data_url,
            signer_name=recipient.name,
            ip_address=ip,
            user_agent=ua,
        )
        db.add(sig_record)

    # 3. Mark recipient as signed
    recipient.status = "signed"
    recipient.signed_at = datetime.now(timezone.utc)

    # 4. Add audit event
    signer_domain = recipient.email.split("@")[1].lower() if "@" in recipient.email else ""
    is_domain_authenticated = False
    if signer_domain and envelope.account_id:
        v_dom_q = select(DomainVerification).where(
            DomainVerification.account_id == envelope.account_id,
            DomainVerification.domain == signer_domain,
            DomainVerification.status == "verified"
        )
        v_dom = (await db.execute(v_dom_q)).scalars().first()
        if v_dom:
            is_domain_authenticated = True
            domain_audit = AuditEvent(
                envelope_id=envelope.id,
                event_type="domain_auth_asserted",
                actor_name="Docurama DNS Trust Engine",
                actor_email=recipient.email,
                ip_address=ip,
                user_agent=ua,
                description=f"Enterprise Authentication Asserted: Corporate domain (@{signer_domain}) validated via active DNS TXT challenge ({v_dom.txt_record_host}).",
            )
            db.add(domain_audit)

    audit_desc = f"Recipient {recipient.name} ({recipient.email}) signed the document using {req.signature_type or 'draw'}."
    if is_domain_authenticated:
        audit_desc += f" [DNS Domain Authenticated: @{signer_domain}]"

    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="signed",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=ip,
        user_agent=ua,
        description=audit_desc,
    )
    db.add(audit)

    await WebhookDispatcher.dispatch_event(
        db, envelope.account_id, "recipient.signed", {
            "envelope_id": envelope.id,
            "recipient_name": recipient.name,
            "recipient_email": recipient.email
        }
    )

    # 5. Check if all signers completed
    signers = [r for r in envelope.recipients if r.role == "signer"]
    all_signed = all(s.status == "signed" for s in signers)

    if all_signed:
        flattened_pdf_path = _envelope_artifact_path(envelope, f"{envelope.id}_flattened.pdf")
        
        fields_list = [
            {
                "page_number": f.page_number,
                "x": f.x,
                "y": f.y,
                "width": f.width,
                "height": f.height,
                "value": f.value,
                "field_type": f.field_type
            }
            for f in envelope.fields
        ]
        # Flattening rewrites the full PDF with fitz; off the event loop.
        await asyncio.to_thread(
            overlay_fields_on_pdf, envelope.original_pdf_path, flattened_pdf_path, fields_list
        )

        # Generate Certificate of Completion PDF
        cert_pdf_path = _envelope_artifact_path(envelope, f"{envelope.id}_certificate.pdf")
        # Each signer's own recorded IP. Previously every row on the certificate was
        # stamped with the last signer's address, misrepresenting the audit record.
        sig_rows = (await db.execute(
            select(Signature).where(Signature.envelope_id == envelope.id)
        )).scalars().all()
        ip_by_recipient = {}
        for s in sig_rows:
            if s.ip_address:
                ip_by_recipient[s.recipient_id] = s.ip_address

        recipients_summary = [
            {
                "name": r.name,
                "email": r.email,
                "role": r.role,
                "status": r.status,
                "signed_at": r.signed_at.strftime("%Y-%m-%d %H:%M:%S UTC") if r.signed_at else "N/A",
                "ip_address": ip_by_recipient.get(r.id) or ("Not recorded" if r.status != "signed" else ip),
                "verification_channel": getattr(r, "verification_channel", "none") or "none",
                "phone": getattr(r, "phone", None),
                "verified_at": r.verified_at.strftime("%Y-%m-%d %H:%M:%S UTC") if getattr(r, "verified_at", None) else None,
            }
            for r in envelope.recipients
        ]
        
        verified_domain_name = None
        if envelope.account_id:
            d_query = select(DomainVerification).where(
                DomainVerification.account_id == envelope.account_id,
                DomainVerification.status == "verified"
            )
            d_res = await db.execute(d_query)
            vd = d_res.scalars().first()
            if vd:
                verified_domain_name = vd.domain

        envelope_dict = {
            "id": envelope.id,
            "title": envelope.title,
            "verification_code": envelope.verification_code,
            "sha256_original": envelope.sha256_original,
            # The sealed file's digest cannot appear inside the document it digests.
            # The certificate carries the original digest and the verification code,
            # which is what a counterparty checks against the portal.
            "sha256_signed": None,
            "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "verified_domain": verified_domain_name,
            # Unknown at render time; set explicitly only on the failure path, where the
            # certificate is regenerated so the delivered document carries the warning.
            "seal_status": None,
            "pades_level": None,
        }
        
        audit_list = [
            {
                "created_at": a.created_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "event_type": a.event_type,
                "actor_name": a.actor_name,
                "description": a.description,
            }
            for a in (envelope.audit_events or [])
        ]
        await asyncio.to_thread(
            generate_certificate_of_completion_pdf, envelope_dict, recipients_summary, audit_list, cert_pdf_path
        )

        combined_pdf_path = _envelope_artifact_path(envelope, f"{envelope.id}_combined.pdf")
        await asyncio.to_thread(append_certificate_page, flattened_pdf_path, cert_pdf_path, combined_pdf_path)

        final_sealed_path = _envelope_artifact_path(envelope, f"{envelope.id}_sealed.pdf")
        # Off the event loop, deliberately. pyHanko's sign_pdf() calls asyncio.run()
        # internally, which raises "cannot be called from a running event loop" inside
        # an async endpoint. Handing it a worker thread gives it a loop-free context.
        # Sealing is also CPU- and network-bound (it reaches the TSA), so it has no
        # business blocking the event loop regardless.
        crypto_res = await asyncio.to_thread(
            sign_pdf_with_pades, combined_pdf_path, final_sealed_path
        )

        envelope.signed_pdf_path = final_sealed_path
        envelope.certificate_pdf_path = cert_pdf_path
        envelope.sha256_signed = crypto_res.get("sha256")
        envelope.status = "completed"
        envelope.completed_at = datetime.now(timezone.utc)

        # Record what the signing run actually achieved. The verification portal reads
        # this rather than assuming a seal was applied.
        sealed = bool(crypto_res.get("sealed"))
        pades_level = crypto_res.get("pades_level")
        envelope.seal_status = "sealed" if sealed else "unsealed"
        seal_details = {
            "sealed": sealed,
            "pades_level": pades_level,
            "subject": crypto_res.get("subject"),
            "issuer": crypto_res.get("issuer"),
            "timestamp_server": crypto_res.get("timestamp_server"),
            "timestamp_utc": crypto_res.get("timestamp_utc"),
            "error": crypto_res.get("error"),
            "sealed_at": datetime.now(timezone.utc).isoformat(),
        }

        if not sealed:
            # Rebuild the certificate so the delivered document itself carries the
            # warning, rather than the gap only being visible in the portal.
            envelope_dict["seal_status"] = "unsealed"
            envelope_dict["pades_level"] = None
            audit_list.append({
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                "event_type": "seal_failed",
                "actor_name": "Docurama Trust Engine",
                "description": f"Cryptographic sealing did not complete: {crypto_res.get('error')}",
            })
            generate_certificate_of_completion_pdf(
                envelope_dict, recipients_summary, audit_list, cert_pdf_path
            )
            append_certificate_page(flattened_pdf_path, cert_pdf_path, combined_pdf_path)
            shutil.copy2(combined_pdf_path, final_sealed_path)
            envelope.sha256_signed = calculate_file_sha256(final_sealed_path)

        seal_details["sha256"] = envelope.sha256_signed
        envelope.seal_details = seal_details

        digest_fragment = (envelope.sha256_signed or "")[:16]
        if sealed:
            seal_description = (
                f"Envelope completed and sealed at {pades_level or 'PAdES'} "
                f"(SHA-256: {digest_fragment}...)."
            )
        else:
            seal_description = (
                f"Envelope completed but NOT cryptographically sealed: {crypto_res.get('error')} "
                f"(SHA-256: {digest_fragment}...)."
            )

        audit_sealed = AuditEvent(
            envelope_id=envelope.id,
            event_type="completed",
            actor_name="Docurama Trust Engine",
            actor_email=settings.SYSTEM_ACTOR_EMAIL,
            description=seal_description,
            hash_state=envelope.sha256_signed,
        )
        db.add(audit_sealed)

        await WebhookDispatcher.dispatch_event(
            db, envelope.account_id, "envelope.completed", {
                "envelope_id": envelope.id,
                "title": envelope.title,
                "verification_code": envelope.verification_code,
                "sha256": envelope.sha256_signed,
                "seal_status": envelope.seal_status,
                "pades_level": pades_level
            }
        )
    else:
        envelope.status = "delivered"

    await db.commit()

    if all_signed:
        # Deliver the completed document to every party. The notice states the real
        # seal outcome, so a document that was not sealed is never described as sealed.
        verify_url = f"{settings.APP_URL}/verify?code={envelope.verification_code}"
        attachments = [p for p in [envelope.signed_pdf_path] if p and os.path.exists(p)]
        smtp = await smtp_config.resolve(db, envelope.account_id)
        completion_batch = mailer.BatchResult()
        for r in envelope.recipients:
            subject, html, text = mailer.completion_notice(
                r.name, envelope.title, verify_url, sealed
            )
            completion_batch.results.append(
                await asyncio.to_thread(mailer.send_email, smtp, r.email, r.name, subject, html, text, attachments=attachments)
            )
        db.add(AuditEvent(
            envelope_id=envelope.id,
            event_type="completion_notice_sent" if completion_batch.any_sent else "completion_notice_failed",
            actor_name="Docurama Trust Engine",
            actor_email=settings.SYSTEM_ACTOR_EMAIL,
            description=f"Completion notices: {completion_batch.summary()}",
        ))
        await db.commit()
    else:
        # Sequential routing: whoever is next can only act once notified.
        remaining = [
            r for r in envelope.recipients
            if r.role == "signer" and r.status not in ["signed", "declined", "delegated"]
        ]
        if remaining:
            next_signer = min(remaining, key=lambda r: (r.routing_order or 1))
            signing_url = f"{settings.APP_URL}/s/{next_signer.signing_token}"
            subject, html, text = mailer.signing_invitation(
                next_signer.name, envelope.title, signing_url, recipient.name
            )
            smtp = await smtp_config.resolve(db, envelope.account_id)
            notify = await asyncio.to_thread(
                mailer.send_email, smtp, next_signer.email, next_signer.name, subject, html, text
            )
            db.add(AuditEvent(
                envelope_id=envelope.id,
                event_type="sent" if notify.sent else "send_failed",
                actor_name="Docurama Trust Engine",
                actor_email=settings.SYSTEM_ACTOR_EMAIL,
                description=(
                    f"Routing notification to {next_signer.name} ({next_signer.email}): "
                    + ("delivered." if notify.sent else f"failed - {notify.error}")
                ),
            ))
            await db.commit()

    await manager.broadcast_to_session(token, {
        "type": "COMPLETED" if all_signed else "STEP_SIGNED",
        "signer": recipient.name,
        "all_signed": all_signed,
        "envelope_status": envelope.status
    })

    return {
        "success": True,
        "message": "Document successfully signed.",
        "envelope_status": envelope.status,
        "verification_code": envelope.verification_code
    }

@router.post("/{token}/decline")
async def decline_signing(
    token: str,
    req: DeclineRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    query = select(Recipient).where(Recipient.signing_token == token).options(selectinload(Recipient.envelope))
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    
    envelope = recipient.envelope
    recipient.status = "declined"
    recipient.declined_reason = req.reason
    envelope.status = "declined"
    
    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")
    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="declined",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=ip,
        user_agent=ua,
        description=f"Recipient {recipient.name} declined to sign. Reason: {req.reason}",
    )
    db.add(audit)
    await db.commit()

    await WebhookDispatcher.dispatch_event(
        db, envelope.account_id, "envelope.declined", {
            "envelope_id": envelope.id,
            "title": envelope.title,
            "declined_by": recipient.email,
            "reason": req.reason
        }
    )

    await manager.broadcast_to_session(token, {
        "type": "DECLINED",
        "signer": recipient.name,
        "reason": req.reason,
        "envelope_status": "declined"
    })

    return {"success": True, "message": "Signature declined.", "status": "declined"}

@router.post("/{token}/delegate")
async def delegate_signing(
    token: str,
    req: DelegateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(
            selectinload(Recipient.envelope).selectinload(Envelope.recipients),
            selectinload(Recipient.envelope).selectinload(Envelope.fields)
        )
    )
    recipient = (await db.execute(query)).scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing token.")

    _assert_token_live(recipient)
    
    envelope = recipient.envelope
    recipient.status = "delegated"
    recipient.delegated_to_email = req.email
    recipient.delegated_to_name = req.name
    recipient.delegated_at = datetime.now(timezone.utc)
    
    new_token = f"dcr_sig_{uuid.uuid4().hex}"
    new_recipient = Recipient(
        envelope_id=envelope.id,
        name=req.name,
        email=req.email,
        role=recipient.role,
        routing_order=recipient.routing_order,
        status="sent",
        signing_token=new_token
    )
    db.add(new_recipient)
    await db.flush()

    for f in envelope.fields:
        if f.recipient_id == recipient.id:
            f.recipient_id = new_recipient.id

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")
    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="delegated",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=ip,
        user_agent=ua,
        description=f"Recipient {recipient.name} ({recipient.email}) delegated signing authority to {req.name} ({req.email}).",
    )
    db.add(audit)
    await db.commit()

    await WebhookDispatcher.dispatch_event(
        db, envelope.account_id, "recipient.delegated", {
            "envelope_id": envelope.id,
            "original_recipient": recipient.email,
            "delegated_to": req.email
        }
    )

    return {
        "success": True,
        "message": f"Signing delegated to {req.name}.",
        "new_signing_token": new_token,
        "new_signing_url": f"/sign/{new_token}"
    }

@router.get("/{token}/contract-analysis")
async def get_contract_analysis(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Returns an instant executive summary and risk assessment of the contract.
    """
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(selectinload(Recipient.envelope))
    )
    res = await db.execute(query)
    recipient = res.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing link.")

    envelope = recipient.envelope
    if not envelope.original_pdf_path or not os.path.exists(envelope.original_pdf_path):
        raise HTTPException(status_code=404, detail="Contract document file unavailable for analysis.")

    return ContractAnalyzer.analyze_pdf(envelope.original_pdf_path)

@router.post("/{token}/request-correction")
async def request_correction(
    token: str,
    req: CorrectionRequestCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Submits an in-line correction or clarification request without voiding or declining the envelope.
    """
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(selectinload(Recipient.envelope))
    )
    res = await db.execute(query)
    recipient = res.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing link.")

    envelope = recipient.envelope
    correction = CorrectionRequest(
        envelope_id=envelope.id,
        submitter_id=recipient.id,
        field_id=req.field_id,
        clause_title=req.clause_title,
        suggested_correction=req.suggested_correction,
        status="open"
    )
    db.add(correction)

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")
    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="correction_requested",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=ip,
        user_agent=ua,
        description=f"Recipient {recipient.name} requested in-line correction: '{req.suggested_correction[:100]}...'",
    )
    db.add(audit)
    await db.commit()
    await db.refresh(correction)

    # Dispatch webhook event
    await WebhookDispatcher.dispatch_event(
        db, envelope.account_id, "envelope.correction_requested", {
            "envelope_id": envelope.id,
            "recipient_email": recipient.email,
            "clause_title": req.clause_title,
            "suggested_correction": req.suggested_correction
        }
    )

    return {
        "success": True,
        "id": correction.id,
        "message": "Correction request recorded and transmitted to the document creator.",
        "status": correction.status
    }

@router.get("/{token}/corrections", response_model=List[CorrectionRequestOut])
async def list_corrections(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves all active in-line correction requests for this envelope.
    """
    query = (
        select(Recipient)
        .where(Recipient.signing_token == token)
        .options(selectinload(Recipient.envelope))
    )
    res = await db.execute(query)
    recipient = res.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Invalid signing link.")

    corrections_query = (
        select(CorrectionRequest)
        .where(CorrectionRequest.envelope_id == recipient.envelope_id)
        .order_by(CorrectionRequest.created_at.desc())
    )
    c_res = await db.execute(corrections_query)
    return c_res.scalars().all()
