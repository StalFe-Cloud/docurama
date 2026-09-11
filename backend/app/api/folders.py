from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, TemplateFolder
from app.schemas.schemas import FolderCreate, FolderOut

router = APIRouter()

@router.get("", response_model=List[FolderOut])
async def list_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TemplateFolder).where(
        TemplateFolder.account_id == current_user.account_id
    ).order_by(TemplateFolder.name.asc())
    res = await db.execute(stmt)
    return res.scalars().all()

@router.post("", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    req: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    name = req.name.strip()
    existing = await db.execute(
        select(TemplateFolder).where(
            TemplateFolder.account_id == current_user.account_id,
            TemplateFolder.name == name
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A folder with this name already exists."
        )
    folder = TemplateFolder(
        account_id=current_user.account_id,
        name=name,
        color=req.color or "#4f46e5",
        parent_id=req.parent_id
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder

@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TemplateFolder).where(
        TemplateFolder.id == folder_id,
        TemplateFolder.account_id == current_user.account_id
    )
    res = await db.execute(stmt)
    folder = res.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    await db.delete(folder)
    await db.commit()
