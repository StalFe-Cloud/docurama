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

# Previews are private to the account that uploaded them. A 128-bit id is a lot of
# entropy, but entropy is not an access control.
ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PREVIEW_DIR_NAME = "previews"


def is_valid_account_id(account_id: str) -> bool:
    return bool(account_id) and ACCOUNT_ID_RE.match(account_id) is not None


def new_doc_id() -> str:
    import uuid
    return f"doc_{uuid.uuid4().hex}"


def is_valid_doc_id(doc_id: str) -> bool:
    return bool(doc_id) and DOC_ID_RE.match(doc_id) is not None


def preview_root(storage_dir: str, account_id: str) -> str:
    if not is_valid_account_id(account_id):
        raise ValueError(f"Invalid account id: {account_id!r}")
    return os.path.join(storage_dir, PREVIEW_DIR_NAME, account_id)


def preview_path(storage_dir: str, doc_id: str, account_id: str) -> str:
    """Resolve a preview path, refusing ids this service did not mint."""
    root = preview_root(storage_dir, account_id)
    if not is_valid_doc_id(doc_id):
        raise ValueError(f"Invalid document id: {doc_id!r}")
    return os.path.join(root, f"{doc_id}.pdf")


def looks_like_pdf(first_chunk: bytes) -> bool:
    return bool(first_chunk) and first_chunk.startswith(PDF_MAGIC)


def purge_expired_previews(storage_dir: str, ttl_seconds: int = PREVIEW_TTL_SECONDS) -> int:
    """
    Drop preview files older than the TTL so uploads cannot accumulate forever.
    Walks the current per-account layout and the legacy flat layout. Returns the
    number removed.
    """
    cutoff = time.time() - ttl_seconds
    removed = 0
    roots = [storage_dir, os.path.join(storage_dir, PREVIEW_DIR_NAME)]
    for root in roots:
        try:
            accounts = os.listdir(root)
        except OSError:
            continue
        for entry in accounts:
            path = os.path.join(root, entry)
            if os.path.isfile(path):
                candidates = [path]
            else:
                try:
                    candidates = [os.path.join(path, n) for n in os.listdir(path)]
                except OSError:
                    continue
            for file_path in candidates:
                name = os.path.basename(file_path)
                if not name.startswith("doc_") or not name.endswith(".pdf"):
                    continue
                try:
                    if os.path.getmtime(file_path) < cutoff:
                        os.remove(file_path)
                        removed += 1
                except OSError:
                    continue
    return removed
