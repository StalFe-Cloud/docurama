"""
Document preview rendering for the visual builder.

These endpoints were previously unauthenticated, so anyone on the internet could
write PDFs into the storage volume and render pages back out. They now require a
session, validate the upload by content rather than filename, cap its size, and
expire orphaned previews. The storage rules themselves live in services/preview_store.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File

from app.api.auth import get_current_user
from app.core.config import settings
from app.models import User
from app.services.pdf_service import get_pdf_pages_info, render_pdf_page_png
from app.services.preview_store import (
    MAX_UPLOAD_BYTES,
    looks_like_pdf,
    new_doc_id,
    preview_path,
    purge_expired_previews,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def _resolve(doc_id: str, account_id: str) -> str:
    try:
        return preview_path(settings.STORAGE_DIR, doc_id, account_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found.")


@router.post("/preview")
async def create_document_preview(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    Accept a PDF upload and return page count, aspect ratios, and render URLs.
    Used by the Visual Document Studio to render real PDF pages.
    """
    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)
    purge_expired_previews(storage_dir)

    if not current_user.account_id:
        raise HTTPException(status_code=400, detail="No active workspace; previews are per workspace.")

    doc_id = new_doc_id()
    pdf_path = preview_path(storage_dir, doc_id, current_user.account_id)
    os.makedirs(os.path.dirname(pdf_path), exist_ok=True)

    # Stream to disk with a hard cap, checking the magic bytes on the first chunk.
    written = 0
    first_chunk = True
    try:
        with open(pdf_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                if first_chunk:
                    if not looks_like_pdf(chunk):
                        raise HTTPException(
                            status_code=400,
                            detail="Only PDF documents are supported.",
                        )
                    first_chunk = False
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Document exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                buffer.write(chunk)

        if written == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    except HTTPException:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise
    except Exception:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        raise HTTPException(status_code=400, detail="The document could not be stored.")

    try:
        pages_info = get_pdf_pages_info(pdf_path)
    except Exception:
        os.remove(pdf_path)
        raise HTTPException(status_code=400, detail="The document could not be read as a PDF.")

    pages = [
        {
            "page_number": p["page_number"],
            "width": p["width"],
            "height": p["height"],
            "aspect_ratio": p["aspect_ratio"],
            "url": f"/api/documents/{doc_id}/pages/{p['page_number']}",
        }
        for p in pages_info
    ]

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "page_count": len(pages),
        "pages": pages,
    }


@router.get("/{doc_id}/pages/{page_number}")
async def get_document_page_image(
    doc_id: str,
    page_number: int,
    dpi: int = 150,
    current_user: User = Depends(get_current_user),
):
    """Render a page of an uploaded preview as a PNG."""
    if not current_user.account_id:
        raise HTTPException(status_code=400, detail="No active workspace.")
    pdf_path = _resolve(doc_id, current_user.account_id)
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Document not found.")

    # Bound the render cost; the parameter is caller-supplied.
    dpi = max(72, min(dpi, 300))

    png_bytes = render_pdf_page_png(pdf_path, page_number, dpi=dpi)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            # Preview renders are per-session working files, never shared caches.
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f"inline; filename=page_{page_number}.png",
        },
    )
