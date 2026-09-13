import asyncio
import os
import shutil
import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.api.tenant import require_tenant_binding
from app.api.quotas import require_paid_write
from app.models import User, Template, Envelope, Recipient, Field, AuditEvent
from app.schemas import TemplateOut, AutoDetectResponse, DetectedField
from app.services.field_detector import FieldDetector
from app.services.preview_store import MAX_UPLOAD_BYTES, looks_like_pdf
from app.services.crypto_engine import calculate_file_sha256
from app.services.storage_layout import best_effort_artifact_path, ensure_dir
from app.services.tenant_resolver import TenantContext

router = APIRouter(prefix="/templates", tags=["templates"])

class PublicStartRequest(BaseModel):
    name: str
    email: EmailStr

@router.get("", response_model=List[TemplateOut])
async def list_templates(
    folder_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = select(Template).where(Template.account_id == current_user.account_id)
    if folder_id:
        query = query.where(Template.folder_id == folder_id)
    query = query.order_by(Template.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    title: str = Form(...),
    description: Optional[str] = Form(""),
    folder_id: Optional[str] = Form(None),
    tags_json: Optional[str] = Form("[]"),
    is_public_shared: Optional[bool] = Form(False),
    public_slug: Optional[str] = Form(None),
    reminder_interval_days: Optional[int] = Form(3),
    max_reminders: Optional[int] = Form(3),
    fields_json: Optional[str] = Form("[]"),
    roles_json: Optional[str] = Form("[]"),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_paid_write),
    db: AsyncSession = Depends(get_db)
):
    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)
    
    pdf_path = None
    if file:
        template_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1] or ".pdf"
        pdf_path = best_effort_artifact_path(settings.STORAGE_DIR, current_user.account_id,
                                             f"template_{template_id}{ext}")
        ensure_dir(os.path.dirname(pdf_path))
        with open(pdf_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

    fields_data = json.loads(fields_json) if fields_json else []
    roles_data = json.loads(roles_json) if roles_json else [{"name": "Signer 1", "role": "signer"}]
    tags = json.loads(tags_json) if tags_json else []
    
    slug = public_slug or f"tpl_{uuid.uuid4().hex[:10]}"

    template = Template(
        account_id=current_user.account_id,
        folder_id=folder_id if folder_id else None,
        title=title,
        description=description,
        pdf_path=pdf_path,
        fields_data=fields_data,
        roles_data=roles_data,
        tags=tags,
        is_public_shared=bool(is_public_shared),
        public_slug=slug,
        reminder_interval_days=reminder_interval_days or 3,
        max_reminders=max_reminders or 3,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template

@router.post("/auto-detect", response_model=AutoDetectResponse)
async def auto_detect_fields(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Analyzes an uploaded PDF and auto-detects signature lines, dates, and form widgets.

    Requires a session, and validates the upload by content rather than by filename,
    on the same terms as the document preview endpoint.
    """
    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)

    temp_path = os.path.join(storage_dir, f"temp_detect_{uuid.uuid4().hex}.pdf")
    try:
        written = 0
        first_chunk = True
        with open(temp_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                if first_chunk:
                    if not looks_like_pdf(chunk):
                        raise HTTPException(status_code=400, detail="Only PDF documents are supported.")
                    first_chunk = False
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Document exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."
                    )
                buffer.write(chunk)

        if written == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")

        # Runs fitz over the upload; off the event loop.
        detected = await asyncio.to_thread(FieldDetector.detect_fields, temp_path)
        return AutoDetectResponse(
            total_detected=len(detected),
            fields=[DetectedField(**f) for f in detected]
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@router.get("/public/{slug}")
async def get_public_template(
    slug: str,
    db: AsyncSession = Depends(get_db)
):
    query = select(Template).where(Template.public_slug == slug)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template or not template.is_public_shared:
        raise HTTPException(status_code=404, detail="Public form template not found or sharing disabled.")
    
    return {
        "id": template.id,
        "title": template.title,
        "description": template.description,
        "public_slug": template.public_slug,
        "fields_count": len(template.fields_data or []),
        "roles": template.roles_data or []
    }

@router.post("/public/{slug}/start")
async def start_public_template(
    slug: str,
    req: PublicStartRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Instantiates an envelope from a public form link (/d/:slug) and returns the signer token.
    """
    query = select(Template).where(Template.public_slug == slug)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template or not template.is_public_shared or not template.pdf_path:
        raise HTTPException(status_code=404, detail="Public form not available.")

    envelope_id = str(uuid.uuid4())
    new_pdf_path = best_effort_artifact_path(settings.STORAGE_DIR, template.account_id,
                                             f"{envelope_id}_original.pdf")
    ensure_dir(os.path.dirname(new_pdf_path))
    shutil.copyfile(template.pdf_path, new_pdf_path)
    sha256_orig = calculate_file_sha256(new_pdf_path)

    ver_code = f"DCR-{uuid.uuid4().hex[:12].upper()}"

    envelope = Envelope(
        id=envelope_id,
        account_id=template.account_id,
        title=f"{template.title} - {req.name}",
        status="sent",
        original_pdf_path=new_pdf_path,
        sha256_original=sha256_orig,
        verification_code=ver_code,
    )
    db.add(envelope)

    signing_token = f"dcr_sig_{uuid.uuid4().hex}"
    recipient = Recipient(
        envelope_id=envelope_id,
        name=req.name,
        email=req.email,
        role="signer",
        routing_order=1,
        status="sent",
        signing_token=signing_token,
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=settings.SIGNING_TOKEN_EXPIRE_DAYS)
    )
    db.add(recipient)
    await db.flush()

    for f_data in (template.fields_data or []):
        f = Field(
            envelope_id=envelope_id,
            recipient_id=recipient.id,
            field_type=f_data.get("field_type", "signature"),
            page_number=f_data.get("page_number", 1),
            x=f_data.get("x", 10.0),
            y=f_data.get("y", 10.0),
            width=f_data.get("width", 150.0),
            height=f_data.get("height", 50.0),
            required=f_data.get("required", True),
            label=f_data.get("label", ""),
            placeholder=f_data.get("placeholder", ""),
            options=f_data.get("options", [])
        )
        db.add(f)

    audit = AuditEvent(
        envelope_id=envelope_id,
        event_type="created",
        actor_name=req.name,
        actor_email=req.email,
        description=f"Form initiated via public sharing link /d/{slug}.",
        hash_state=sha256_orig
    )
    db.add(audit)
    await db.commit()

    return {
        "signing_token": signing_token,
        "signing_url": f"/sign/{signing_token}",
        "envelope_id": envelope_id
    }

@router.get("/{id}", response_model=TemplateOut)
async def get_template(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = select(Template).where(Template.id == id, Template.account_id == current_user.account_id)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    return template

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _tenant: TenantContext = Depends(require_tenant_binding)
):
    query = select(Template).where(Template.id == id, Template.account_id == current_user.account_id)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    await db.delete(template)
    await db.commit()
