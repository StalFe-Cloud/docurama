"""
Saved signature and initials stamps.

The Profile screen has always offered these, with buttons that reported "Signature
stamp saved" and stored nothing. A stamp is only worth saving if it comes back at
signing time, so these endpoints exist to be read by the signing studio.
"""
import os
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models import User, UserStamp
from app.schemas import StampOut
from app.services import stamp_store

router = APIRouter(prefix="/stamps", tags=["stamps"])


def _to_out(row: UserStamp) -> StampOut:
    return StampOut(
        id=row.id,
        kind=row.kind,
        url=f"{settings.API_V1_STR}/stamps/{row.kind}/image",
        created_at=row.created_at,
    )


async def _existing(db: AsyncSession, user_id: str, kind: str) -> UserStamp:
    return (await db.execute(
        select(UserStamp).where(UserStamp.user_id == user_id, UserStamp.kind == kind)
    )).scalar_one_or_none()


@router.get("", response_model=List[StampOut])
async def list_stamps(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(UserStamp).where(UserStamp.user_id == current_user.id)
    )).scalars().all()
    return [_to_out(r) for r in rows]


@router.post("/{kind}", response_model=StampOut, status_code=status.HTTP_201_CREATED)
async def save_stamp(
    kind: str,
    data_url: str = Form(None),
    file: UploadFile = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save a drawn or uploaded stamp, replacing any previous one of the same kind.

    Accepts either a canvas data URL or a file. In both cases the content type is
    established from the bytes, never from what the client declared.
    """
    if not stamp_store.is_valid_kind(kind):
        raise HTTPException(status_code=404, detail=f"Unknown stamp kind '{kind}'.")

    if data_url:
        raw, error = stamp_store.decode_data_url(data_url)
    elif file is not None:
        # Read one byte past the cap so an oversized upload is detected here
        # instead of being read into memory in full first.
        raw = await file.read(stamp_store.MAX_STAMP_BYTES + 1)
        error = (
            f"The image exceeds the {stamp_store.MAX_STAMP_BYTES // (1024 * 1024)} MB limit."
            if len(raw) > stamp_store.MAX_STAMP_BYTES else None
        )
    else:
        raise HTTPException(status_code=400, detail="Provide a drawn signature or an image file.")

    if error:
        raise HTTPException(status_code=400, detail=error)

    content_type, error = stamp_store.validate_image(raw)
    if error:
        raise HTTPException(status_code=400, detail=error)

    storage_dir = settings.STORAGE_DIR
    stamp_store.ensure_stamp_dir(storage_dir)
    stamp_id = stamp_store.new_stamp_id()
    path = stamp_store.stamp_path(storage_dir, stamp_id, content_type)

    with open(path, "wb") as handle:
        handle.write(raw)

    row = await _existing(db, current_user.id, kind)
    if row:
        # Remove the file the row used to point at, so replacing a stamp does not
        # leave the old image orphaned on the volume forever.
        previous = row.file_path
        row.file_path = path
        row.content_type = content_type
        if previous and previous != path and os.path.exists(previous):
            try:
                os.remove(previous)
            except OSError:
                pass
    else:
        row = UserStamp(
            user_id=current_user.id,
            kind=kind,
            file_path=path,
            content_type=content_type,
        )
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.get("/{kind}/image")
async def get_stamp_image(
    kind: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the stamp itself. Scoped to the signed-in user; stamps are not shared."""
    if not stamp_store.is_valid_kind(kind):
        raise HTTPException(status_code=404, detail=f"Unknown stamp kind '{kind}'.")

    row = await _existing(db, current_user.id, kind)
    if not row or not os.path.exists(row.file_path):
        raise HTTPException(status_code=404, detail="No saved stamp.")

    with open(row.file_path, "rb") as handle:
        data = handle.read()

    return Response(
        content=data,
        media_type=row.content_type or "image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.delete("/{kind}", status_code=status.HTTP_200_OK)
async def delete_stamp(
    kind: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not stamp_store.is_valid_kind(kind):
        raise HTTPException(status_code=404, detail=f"Unknown stamp kind '{kind}'.")

    row = await _existing(db, current_user.id, kind)
    if not row:
        raise HTTPException(status_code=404, detail="No saved stamp.")

    path = row.file_path
    await db.delete(row)
    await db.commit()

    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass

    return {"success": True, "kind": kind, "message": f"Saved {kind} removed."}
