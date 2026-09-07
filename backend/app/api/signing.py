import os
import io
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.models import Envelope, Recipient, Field, Signature, AuditEvent, DomainVerification
from app.schemas import SigningSessionOut, SubmitSignaturesRequest, FieldOut, RecipientOut
from app.services.qr_generator import generate_qr_base64
from app.services.pdf_service import overlay_fields_on_pdf, generate_certificate_of_completion_pdf, append_certificate_page
from app.services.crypto_engine import sign_pdf_with_pades, calculate_file_sha256
from app.api.ws import manager

router = APIRouter(prefix="/signing", tags=["signing"])

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
        
    envelope = recipient.envelope
    
    # Record 'opened' event if first time
    if recipient.status == "sent":
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
        
    pdf_url = f"{settings.API_V1_STR}/signing/{token}/pdf"
    
    return SigningSessionOut(
        envelope_id=envelope.id,
        envelope_title=envelope.title,
        recipient=RecipientOut.model_validate(recipient),
        pdf_url=pdf_url,
        fields=[FieldOut.model_validate(f) for f in envelope.fields],
        all_recipients=[RecipientOut.model_validate(r) for r in envelope.recipients],
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
        
    envelope = recipient.envelope
    pdf_path = envelope.signed_pdf_path or envelope.original_pdf_path
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF file not found.")
        
    return FileResponse(pdf_path, media_type="application/pdf")

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

    mobile_url = f"{settings.APP_URL}/s/{token}?source=mobile_qr"
    qr_b64 = generate_qr_base64(mobile_url, box_size=8, border=2)

    return {
        "mobile_url": mobile_url,
        "qr_code_base64": qr_b64,
        "instructions": "Scan with your smartphone camera to sign on touch screen with natural pen physics."
    }

@router.post("/{token}/submit")
async def submit_signatures(
    token: str,
    payload: SubmitSignaturesRequest,
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
        
    envelope = recipient.envelope
    if envelope.status in ["completed", "voided", "declined"]:
        raise HTTPException(status_code=400, detail=f"This document is already {envelope.status}.")

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")

    # Save Signature record if provided
    if payload.signature_data_url:
        sig = Signature(
            envelope_id=envelope.id,
            recipient_id=recipient.id,
            signature_type=payload.signature_type or "draw",
            signature_data=payload.signature_data_url,
            signer_name=recipient.name,
            ip_address=ip,
            user_agent=ua,
        )
        db.add(sig)

    # Update field values
    for s in payload.signatures:
        for f in envelope.fields:
            if f.id == s.field_id:
                f.value = s.value

    recipient.status = "signed"
    recipient.signed_at = datetime.now(timezone.utc)

    # Audit event for signing
    audit_sign = AuditEvent(
        envelope_id=envelope.id,
        event_type="signed",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=ip,
        user_agent=ua,
        description=f"Recipient {recipient.name} signed using {payload.signature_type or 'digital pen'} signature.",
    )
    db.add(audit_sign)
    await db.flush()

    # Check if all signers are done
    all_signed = all(
        r.status == "signed" for r in envelope.recipients if r.role in ["signer", "approver"]
    )

    if all_signed:
        # 1. Overlay signatures and field values onto PDF
        storage_dir = settings.STORAGE_DIR
        flattened_pdf_path = os.path.join(storage_dir, f"{envelope.id}_flattened.pdf")
        
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
        overlay_fields_on_pdf(envelope.original_pdf_path, flattened_pdf_path, fields_list)

        # 2. Generate Certificate of Completion PDF
        cert_pdf_path = os.path.join(storage_dir, f"{envelope.id}_certificate.pdf")
        recipients_summary = [
            {
                "name": r.name,
                "email": r.email,
                "role": r.role,
                "status": r.status,
                "signed_at": r.signed_at.strftime("%Y-%m-%d %H:%M:%S UTC") if r.signed_at else "N/A",
                "ip_address": ip,
            }
            for r in envelope.recipients
        ]
        
        # Check if issuer account has verified domain
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
            "sha256_signed": "Calculating...",
            "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "verified_domain": verified_domain_name,
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
        generate_certificate_of_completion_pdf(envelope_dict, recipients_summary, audit_list, cert_pdf_path)

        # 3. Append Certificate to document
        combined_pdf_path = os.path.join(storage_dir, f"{envelope.id}_combined.pdf")
        append_certificate_page(flattened_pdf_path, cert_pdf_path, combined_pdf_path)

        # 4. Cryptographically Sign with StalFe PAdES-LTV Digital Certificate
        final_sealed_path = os.path.join(storage_dir, f"{envelope.id}_sealed.pdf")
        crypto_res = sign_pdf_with_pades(combined_pdf_path, final_sealed_path)

        envelope.signed_pdf_path = final_sealed_path
        envelope.certificate_pdf_path = cert_pdf_path
        envelope.sha256_signed = crypto_res.get("sha256")
        envelope.status = "completed"
        envelope.completed_at = datetime.now(timezone.utc)

        # Final audit event
        audit_sealed = AuditEvent(
            envelope_id=envelope.id,
            event_type="completed",
            actor_name="StalFe Trust Engine",
            actor_email="system@stalfe.com",
            ip_address="127.0.0.1",
            description=f"Envelope completed and sealed with StalFe PAdES-LTV (SHA-256: {envelope.sha256_signed[:16]}...).",
            hash_state=envelope.sha256_signed,
        )
        db.add(audit_sealed)
    else:
        envelope.status = "delivered"

    await db.commit()

    # Broadcast WebSocket event to refresh desktop screen in real-time
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
