import os
import shutil
import uuid
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.security import generate_secure_token
from app.api.auth import get_current_user
from app.models import User, Envelope, Recipient, Field, AuditEvent
from app.schemas import EnvelopeOut, EnvelopeDetailOut
from app.services.crypto_engine import calculate_file_sha256
import json

router = APIRouter(prefix="/envelopes", tags=["envelopes"])

@router.get("", response_model=List[EnvelopeOut])
async def list_envelopes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
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
    original_pdf_path = os.path.join(storage_dir, f"{envelope_id}_original{file_ext}")
    
    # Save uploaded PDF
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
    
    # Parse Recipients
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
        )
        db.add(rec)
        await db.flush()
        created_recipients[client_ref_id] = rec.id

    # Parse Fields
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
            value=f.get("value"),
        )
        db.add(field)

    # Initial Audit Trail Events
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
    event_sent = AuditEvent(
        envelope_id=envelope.id,
        event_type="sent",
        actor_name="Docurama Trust Engine",
        actor_email="system@stalfe.com",
        ip_address=ip,
        user_agent=ua,
        description=f"Sent envelope invitations to {len(recipients_data)} recipient(s).",
    )
    db.add_all([event_created, event_sent])
    await db.commit()

    # Reload with relationships
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
    db: AsyncSession = Depends(get_db)
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
    db: AsyncSession = Depends(get_db)
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
    db: AsyncSession = Depends(get_db)
):
    query = select(Envelope).where(Envelope.id == id, Envelope.account_id == current_user.account_id)
    envelope = (await db.execute(query)).scalar_one_or_none()
    if not envelope or not envelope.certificate_pdf_path or not os.path.exists(envelope.certificate_pdf_path):
        raise HTTPException(status_code=404, detail="Certificate of Completion not generated yet.")
        
    filename = f"{envelope.title.replace(' ', '_')}_Certificate.pdf"
    return FileResponse(envelope.certificate_pdf_path, media_type="application/pdf", filename=filename)
