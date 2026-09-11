import os
import shutil
import uuid
import csv
import io
import json
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.security import generate_secure_token
from app.api.auth import get_current_user
from app.api.tenant import require_tenant_binding
from app.models import User, Envelope, Recipient, Field, AuditEvent, Template
from app.schemas import EnvelopeOut, EnvelopeDetailOut
from app.services.crypto_engine import calculate_file_sha256
from app.services.storage_layout import artifact_path, ensure_dir
from app.services.tenant_resolver import TenantContext
from app.services.webhook_dispatcher import WebhookDispatcher
from app.services import mailer, smtp_config

router = APIRouter(prefix="/envelopes", tags=["envelopes"])

@router.get("", response_model=List[EnvelopeOut])
async def list_envelopes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = (
        select(Envelope)
        .where(Envelope.account_id == current_user.account_id)
        .options(selectinload(Envelope.recipients))
        .order_by(Envelope.created_at.desc())
    )
    result = await db.execute(query)
    envelopes = result.scalars().all()
    
    out = []
    for env in envelopes:
        recipients = env.recipients or []
        signed_count = sum(1 for r in recipients if r.status == "signed")
        out.append(
            EnvelopeOut(
                id=env.id,
                title=env.title,
                status=env.status,
                verification_code=env.verification_code,
                completed_at=env.completed_at,
                created_at=env.created_at,
                updated_at=env.updated_at,
                recipients_count=len(recipients),
                signed_count=signed_count,
                seal_status=env.seal_status,
            )
        )
    return out

@router.post("", response_model=EnvelopeDetailOut)
async def create_envelope(
    request: Request,
    title: str = Form(...),
    recipients_json: str = Form(...),
    fields_json: Optional[str] = Form("[]"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)
    
    envelope_id = str(uuid.uuid4())
    verification_code = str(uuid.uuid4()).replace("-", "")[:24].upper()
    file_ext = os.path.splitext(file.filename)[1] or ".pdf"
    original_pdf_path = artifact_path(settings.STORAGE_DIR, current_user.account_id,
                                      f"{envelope_id}_original{file_ext}")
    ensure_dir(os.path.dirname(original_pdf_path))
    
    with open(original_pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    original_sha = calculate_file_sha256(original_pdf_path)
    
    envelope = Envelope(
        id=envelope_id,
        account_id=current_user.account_id,
        created_by_user_id=current_user.id,
        title=title,
        status="sent",
        original_pdf_path=original_pdf_path,
        sha256_original=original_sha,
        verification_code=verification_code,
    )
    db.add(envelope)
    await db.flush()
    
    try:
        recipients_data = json.loads(recipients_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid recipients JSON format.")
        
    created_recipients = {}
    for idx, r in enumerate(recipients_data):
        client_ref_id = r.get("id", str(idx))
        signing_token = generate_secure_token(32)
        rec = Recipient(
            envelope_id=envelope.id,
            name=r.get("name", "Signer"),
            email=r.get("email", ""),
            role=r.get("role", "signer"),
            routing_order=r.get("routing_order", idx + 1),
            status="sent",
            signing_token=signing_token,
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=settings.SIGNING_TOKEN_EXPIRE_DAYS),
        )
        db.add(rec)
        await db.flush()
        created_recipients[client_ref_id] = rec.id

    try:
        fields_data = json.loads(fields_json)
    except Exception:
        fields_data = []

    for f in fields_data:
        rec_id = created_recipients.get(f.get("recipient_id")) or (list(created_recipients.values())[0] if created_recipients else None)
        field = Field(
            envelope_id=envelope.id,
            recipient_id=rec_id,
            field_type=f.get("field_type", "signature"),
            page_number=f.get("page_number", 1),
            x=f.get("x", 0.0),
            y=f.get("y", 0.0),
            width=f.get("width", 150.0),
            height=f.get("height", 50.0),
            required=f.get("required", True),
            label=f.get("label"),
            placeholder=f.get("placeholder"),
            validation_regex=f.get("validation_regex"),
            options=f.get("options", []),
            value=f.get("value"),
        )
        db.add(field)

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("User-Agent", "Browser")
    
    event_created = AuditEvent(
        envelope_id=envelope.id,
        event_type="created",
        actor_name=f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email,
        actor_email=current_user.email,
        ip_address=ip,
        user_agent=ua,
        description=f"Envelope '{title}' created with SHA-256: {original_sha[:16]}...",
        hash_state=original_sha,
    )
    db.add(event_created)
    await db.commit()

    # Invitations are dispatched synchronously so that the audit event describes the
    # actual delivery outcome. The previous implementation recorded "Sent envelope
    # invitations to N recipient(s)" while no mail was ever sent.
    sender_name = f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email
    # Resolved once per batch: the account's own mail profile, else the platform default.
    smtp = await smtp_config.resolve(db, envelope.account_id)
    invite_batch = mailer.BatchResult()
    for client_ref_id, rec_id in created_recipients.items():
        rec = await db.get(Recipient, rec_id)
        if not rec or rec.role not in ("signer", "approver"):
            continue
        signing_url = f"{settings.APP_URL}/s/{rec.signing_token}"
        subject, html, text = mailer.signing_invitation(
            rec.name, envelope.title, signing_url, sender_name
        )
        invite_batch.results.append(
            mailer.send_email(smtp, rec.email, rec.name, subject, html, text)
        )

    event_sent = AuditEvent(
        envelope_id=envelope.id,
        event_type="sent" if invite_batch.any_sent else "send_failed",
        actor_name="Docurama Trust Engine",
        actor_email=settings.SYSTEM_ACTOR_EMAIL,
        ip_address=ip,
        user_agent=ua,
        description=f"Envelope invitations: {invite_batch.summary()}",
    )
    db.add(event_sent)
    await db.commit()

    await WebhookDispatcher.dispatch_event(
        db, envelope.account_id, "envelope.created", {
            "envelope_id": envelope.id,
            "title": envelope.title,
            "recipients_count": len(recipients_data)
        }
    )

    query = (
        select(Envelope)
        .where(Envelope.id == envelope.id)
        .options(
            selectinload(Envelope.recipients),
            selectinload(Envelope.fields),
            selectinload(Envelope.audit_events),
        )
    )
    envelope_full = (await db.execute(query)).scalar_one()
    return envelope_full

@router.get("/{id}", response_model=EnvelopeDetailOut)
async def get_envelope(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = (
        select(Envelope)
        .where(Envelope.id == id, Envelope.account_id == current_user.account_id)
        .options(
            selectinload(Envelope.recipients),
            selectinload(Envelope.fields),
            selectinload(Envelope.audit_events),
        )
    )
    result = await db.execute(query)
    envelope = result.scalar_one_or_none()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found.")
    return envelope

@router.post("/{id}/remind")
async def remind_envelope(
    id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Manually triggers an automated reminder to all signers who have not yet signed.
    """
    query = (
        select(Envelope)
        .where(Envelope.id == id, Envelope.account_id == current_user.account_id)
        .options(selectinload(Envelope.recipients))
    )
    result = await db.execute(query)
    envelope = result.scalar_one_or_none()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found.")
    
    pending_signers = [r for r in envelope.recipients if r.status in ["sent", "opened", "waiting"]]
    if not pending_signers:
        return {"success": True, "message": "All recipients have already signed.", "reminded_count": 0}

    now = datetime.now(timezone.utc)
    smtp = await smtp_config.resolve(db, envelope.account_id)
    batch = mailer.BatchResult()

    for r in pending_signers:
        signing_url = f"{settings.APP_URL}/s/{r.signing_token}"
        reminder_number = (r.reminders_sent_count or 0) + 1
        subject, html, text = mailer.signing_reminder(
            r.name, envelope.title, signing_url, reminder_number
        )
        result = mailer.send_email(smtp, r.email, r.name, subject, html, text)
        batch.results.append(result)
        # The counter tracks delivered reminders. Incrementing on a failed send would
        # silently exhaust a recipient's reminder budget without them hearing anything.
        if result.sent:
            r.reminders_sent_count = reminder_number
            r.last_reminded_at = now

    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="reminder_sent" if batch.any_sent else "reminder_failed",
        actor_name=f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email,
        actor_email=current_user.email,
        description=f"Manual reminder: {batch.summary()}",
    )
    db.add(audit)
    await db.commit()

    return {
        "success": batch.any_sent,
        "message": batch.summary(),
        "reminded_count": batch.sent_count,
        "failed_count": batch.failed_count,
    }

@router.get("/{id}/export-csv")
async def export_envelope_csv(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    """
    Exports all submission fields and signer responses as CSV.
    """
    query = (
        select(Envelope)
        .where(Envelope.id == id, Envelope.account_id == current_user.account_id)
        .options(
            selectinload(Envelope.recipients),
            selectinload(Envelope.fields)
        )
    )
    result = await db.execute(query)
    envelope = result.scalar_one_or_none()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found.")

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Headers
    writer.writerow([
        "Envelope ID", "Title", "Status", "Verification Code",
        "Recipient Name", "Recipient Email", "Role", "Signer Status", "Signed At",
        "Field Label", "Field Type", "Field Value"
    ])

    for r in envelope.recipients:
        rec_fields = [f for f in envelope.fields if f.recipient_id == r.id]
        if not rec_fields:
            writer.writerow([
                envelope.id, envelope.title, envelope.status, envelope.verification_code,
                r.name, r.email, r.role, r.status, r.signed_at or "N/A",
                "N/A", "N/A", "N/A"
            ])
        else:
            for f in rec_fields:
                writer.writerow([
                    envelope.id, envelope.title, envelope.status, envelope.verification_code,
                    r.name, r.email, r.role, r.status, r.signed_at or "N/A",
                    f.label or f.field_type, f.field_type, f.value or ""
                ])

    output.seek(0)
    filename = f"Docurama_Export_{envelope.id[:8]}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.post("/bulk")
async def bulk_send_envelopes(
    template_id: str = Form(...),
    csv_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Uploads a CSV file of recipients (name, email) and dispatches individual envelopes using a template.
    """
    t_query = select(Template).where(Template.id == template_id, Template.account_id == current_user.account_id)
    template = (await db.execute(t_query)).scalar_one_or_none()
    if not template or not template.pdf_path or not os.path.exists(template.pdf_path):
        raise HTTPException(status_code=404, detail="Template or PDF document not found.")

    content = await csv_file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8", errors="ignore")))
    
    dispatched_envelopes = []

    for row in reader:
        name = row.get("name") or row.get("Name") or "Signer"
        email = row.get("email") or row.get("Email")
        if not email:
            continue

        envelope_id = str(uuid.uuid4())
        new_pdf_path = artifact_path(settings.STORAGE_DIR, template.account_id,
                                     f"{envelope_id}_original.pdf")
        ensure_dir(os.path.dirname(new_pdf_path))
        shutil.copyfile(template.pdf_path, new_pdf_path)
        sha256_orig = calculate_file_sha256(new_pdf_path)
        ver_code = f"DCR-{uuid.uuid4().hex[:12].upper()}"

        envelope = Envelope(
            id=envelope_id,
            account_id=current_user.account_id,
            created_by_user_id=current_user.id,
            title=f"{template.title} - {name}",
            status="sent",
            original_pdf_path=new_pdf_path,
            sha256_original=sha256_orig,
            verification_code=ver_code,
        )
        db.add(envelope)

        signing_token = f"dcr_sig_{uuid.uuid4().hex}"
        rec = Recipient(
            envelope_id=envelope_id,
            name=name,
            email=email,
            role="signer",
            routing_order=1,
            status="sent",
            signing_token=signing_token
        )
        db.add(rec)
        await db.flush()

        for f_data in (template.fields_data or []):
            field_val = row.get(f_data.get("label", "")) or None
            f = Field(
                envelope_id=envelope_id,
                recipient_id=rec.id,
                field_type=f_data.get("field_type", "signature"),
                page_number=f_data.get("page_number", 1),
                x=f_data.get("x", 0.0),
                y=f_data.get("y", 0.0),
                width=f_data.get("width", 150.0),
                height=f_data.get("height", 50.0),
                required=f_data.get("required", True),
                label=f_data.get("label"),
                value=field_val
            )
            db.add(f)

        dispatched_envelopes.append({
            "envelope_id": envelope_id,
            "recipient": email,
            "verification_code": ver_code
        })

    await db.commit()

    return {
        "success": True,
        "dispatched_count": len(dispatched_envelopes),
        "envelopes": dispatched_envelopes
    }

@router.post("/{id}/void")
async def void_envelope(
    id: str,
    reason: str = Form("Voided by sender"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Envelope).where(Envelope.id == id, Envelope.account_id == current_user.account_id)
    envelope = (await db.execute(query)).scalar_one_or_none()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found.")
        
    envelope.status = "voided"
    audit = AuditEvent(
        envelope_id=envelope.id,
        event_type="voided",
        actor_name=f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email,
        actor_email=current_user.email,
        description=f"Envelope voided: {reason}",
    )
    db.add(audit)
    await db.commit()
    return {"message": "Envelope voided successfully"}

@router.get("/{id}/download")
async def download_signed_pdf(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = select(Envelope).where(Envelope.id == id, Envelope.account_id == current_user.account_id)
    envelope = (await db.execute(query)).scalar_one_or_none()
    if not envelope:
        raise HTTPException(status_code=404, detail="Envelope not found.")
        
    file_path = envelope.signed_pdf_path or envelope.original_pdf_path
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document file not found on disk.")
        
    filename = f"{envelope.title.replace(' ', '_')}_Sealed.pdf"
    return FileResponse(file_path, media_type="application/pdf", filename=filename)

@router.get("/{id}/certificate")
async def download_certificate(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = select(Envelope).where(Envelope.id == id, Envelope.account_id == current_user.account_id)
    envelope = (await db.execute(query)).scalar_one_or_none()
    if not envelope or not envelope.certificate_pdf_path or not os.path.exists(envelope.certificate_pdf_path):
        raise HTTPException(status_code=404, detail="Certificate of Completion not generated yet.")
        
    filename = f"{envelope.title.replace(' ', '_')}_Certificate.pdf"
    return FileResponse(envelope.certificate_pdf_path, media_type="application/pdf", filename=filename)
