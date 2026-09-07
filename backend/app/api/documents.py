import os
import uuid
import shutil
from typing import List, Dict, Any
from fastapi import APIRouter, UploadFile, File, HTTPException, Response, Depends
from app.core.config import settings
from app.services.pdf_service import get_pdf_pages_info, render_pdf_page_png

router = APIRouter(prefix="/documents", tags=["documents"])

@router.post("/preview")
async def create_document_preview(file: UploadFile = File(...)):
    """
    Accepts a PDF upload and returns page count, aspect ratios, and render URLs.
    Used by the Visual Document Studio to render the real PDF pages.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF documents are supported.")

    storage_dir = settings.STORAGE_DIR
    os.makedirs(storage_dir, exist_ok=True)
    
    doc_id = f"doc_{uuid.uuid4().hex}"
    pdf_filename = f"{doc_id}.pdf"
    pdf_path = os.path.join(storage_dir, pdf_filename)

    with open(pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages_info = get_pdf_pages_info(pdf_path)
    pages = []
    for p in pages_info:
        p_num = p["page_number"]
        pages.append({
            "page_number": p_num,
            "width": p["width"],
            "height": p["height"],
            "aspect_ratio": p["aspect_ratio"],
            "url": f"/api/documents/{doc_id}/pages/{p_num}"
        })

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "page_count": len(pages),
        "pages": pages
    }

@router.get("/{doc_id}/pages/{page_number}")
async def get_document_page_image(doc_id: str, page_number: int, dpi: int = 150):
    """
    Renders a specific page of an uploaded PDF as a high-resolution PNG image.
    """
    storage_dir = settings.STORAGE_DIR
    pdf_path = os.path.join(storage_dir, f"{doc_id}.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Document not found.")

    png_bytes = render_pdf_page_png(pdf_path, page_number, dpi=dpi)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f"inline; filename=page_{page_number}.png"
        }
    )
