"""
Storage rules for builder preview uploads.

Kept separate from the API layer so the validation rules can be exercised without
standing up the web framework, and so the filesystem policy lives in one place.
"""
import os
import re
import time

# Previews are working files for the builder, not envelope records.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
PREVIEW_TTL_SECONDS = 24 * 60 * 60

# Content check. A filename extension is not evidence of what a file contains.
PDF_MAGIC = b"%PDF-"

# doc_<32 hex>, as minted by new_doc_id(). Anything else cannot reach the filesystem.
DOC_ID_RE = re.compile(r"^doc_[0-9a-f]{32}$")


def new_doc_id() -> str:
    import uuid
    return f"doc_{uuid.uuid4().hex}"


def is_valid_doc_id(doc_id: str) -> bool:
    return bool(doc_id) and DOC_ID_RE.match(doc_id) is not None


def preview_path(storage_dir: str, doc_id: str) -> str:
    """Resolve a preview path, refusing any id this service did not mint."""
    if not is_valid_doc_id(doc_id):
        raise ValueError(f"Invalid document id: {doc_id!r}")
    return os.path.join(storage_dir, f"{doc_id}.pdf")


def looks_like_pdf(first_chunk: bytes) -> bool:
    return bool(first_chunk) and first_chunk.startswith(PDF_MAGIC)


def purge_expired_previews(storage_dir: str, ttl_seconds: int = PREVIEW_TTL_SECONDS) -> int:
    """
    Drop preview files older than the TTL so uploads cannot accumulate forever.
    Returns the number removed.
    """
    cutoff = time.time() - ttl_seconds
    removed = 0
    try:
        entries = os.listdir(storage_dir)
    except OSError:
        return 0

    for name in entries:
        if not name.startswith("doc_") or not name.endswith(".pdf"):
            continue
        path = os.path.join(storage_dir, name)
        try:
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            continue
    return removed
