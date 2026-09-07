import os
import shutil
import uuid
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models import User, Template
from app.schemas import TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])

@router.get("", response_model=List[TemplateOut])
async def list_templates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = (
        select(Template)
        .where(Template.account_id == current_user.account_id)
        .order_by(Template.created_at.desc())
    )
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=TemplateOut)
async def create_template(
    title: str = Form(...),
    description: Optional[str] = Form(""),
    fields_json: Optional[str] = Form("[]"),
    roles_json: Optional[str] = Form("[]"),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)
    
    pdf_path = None
    if file:
        template_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1] or ".pdf"
        pdf_path = os.path.join(storage_dir, f"template_{template_id}{ext}")
        with open(pdf_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

    fields_data = json.loads(fields_json) if fields_json else []
    roles_data = json.loads(roles_json) if roles_json else [{"name": "Signer 1", "role": "signer"}]

    template = Template(
        account_id=current_user.account_id,
        title=title,
        description=description,
        pdf_path=pdf_path,
        fields_data=fields_data,
        roles_data=roles_data,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template

@router.get("/{id}", response_model=TemplateOut)
async def get_template(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Template).where(Template.id == id, Template.account_id == current_user.account_id)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    return template

@router.delete("/{id}")
async def delete_template(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Template).where(Template.id == id, Template.account_id == current_user.account_id)
    template = (await db.execute(query)).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    await db.delete(template)
    await db.commit()
    return {"message": "Template deleted successfully"}
