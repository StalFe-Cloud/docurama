"""
Upload validation: content-type checks that actually look at the bytes.

A client-declared filename or MIME type proves nothing about a payload. The
gap this module closes: an envelope "PDF" that was never a PDF could be stored
and later fail at signing time, far from the place the mistake was made. The
ingest path now checks the file's magic bytes and rejects impostors with a
415 before a single byte reaches storage.
"""
from typing import IO

PDF_MAGIC = b"%PDF-"
HEAD_WINDOW = 1024


def read_head(fileobj: IO, size: int = HEAD_WINDOW) -> bytes:
    """Read the first bytes of an upload and rewind, so callers can proceed."""
    head = fileobj.read(size)
    try:
        fileobj.seek(0)
    except (OSError, ValueError):
        # Non-seekable streams cannot be rewound here; the ingest paths all use
        # SpooledUploadFile, which is seekable.
        pass
    return head or b""


def is_pdf(head: bytes) -> bool:
    return head.startswith(PDF_MAGIC)


def validate_pdf_upload(fileobj: IO) -> None:
    """Raise ValueError when the payload is not a PDF by its leading bytes."""
    if not is_pdf(read_head(fileobj)):
        raise ValueError("Upload rejected: payload is not a PDF (magic bytes missing).")
