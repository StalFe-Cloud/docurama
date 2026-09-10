"""
Storage rules for saved signature and initials stamps.

Same discipline as builder previews in preview_store: ids this service mints, a
content check rather than a filename check, and a size cap. These are user-supplied
images that end up composited onto legal documents, so nothing here trusts the client.
"""
import base64
import os
import re
from typing import Optional, Tuple

# A signature stamp is a small transparent image, not a scan of a page.
MAX_STAMP_BYTES = 2 * 1024 * 1024

VALID_KINDS = ("signature", "initials")

# Magic bytes for the formats a browser canvas or a scanner produces.
_MAGIC = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
}

# stamp_<32 hex>.<ext>, as minted below.
STAMP_ID_RE = re.compile(r"^stamp_[0-9a-f]{32}$")

_DATA_URL_RE = re.compile(r"^data:image/(png|jpe?g);base64,(.+)$", re.IGNORECASE | re.DOTALL)


def is_valid_kind(kind: str) -> bool:
    return kind in VALID_KINDS


def new_stamp_id() -> str:
    import uuid
    return f"stamp_{uuid.uuid4().hex}"


def detect_content_type(data: bytes) -> Optional[str]:
    """Identify the image by its leading bytes, or None when it is not one we accept."""
    for magic, content_type in _MAGIC.items():
        if data.startswith(magic):
            return content_type
    return None


def decode_data_url(data_url: str) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Decode a canvas data URL into bytes.

    Returns (data, error). The declared mime type in the URL is not trusted; the
    content type is established from the decoded bytes by the caller.
    """
    if not data_url:
        return None, "No image data was supplied."

    match = _DATA_URL_RE.match(data_url.strip())
    if not match:
        return None, "Expected a PNG or JPEG data URL."

    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except Exception:
        return None, "The image data could not be decoded."

    if not raw:
        return None, "The image is empty."
    if len(raw) > MAX_STAMP_BYTES:
        return None, f"The image exceeds the {MAX_STAMP_BYTES // (1024 * 1024)} MB limit."

    return raw, None


def validate_image(data: bytes) -> Tuple[Optional[str], Optional[str]]:
    """Return (content_type, error) for raw image bytes."""
    if not data:
        return None, "The image is empty."
    if len(data) > MAX_STAMP_BYTES:
        return None, f"The image exceeds the {MAX_STAMP_BYTES // (1024 * 1024)} MB limit."

    content_type = detect_content_type(data)
    if not content_type:
        return None, "Only PNG and JPEG images are accepted."
    return content_type, None


def stamp_path(storage_dir: str, stamp_id: str, content_type: str) -> str:
    """Resolve a stamp path, refusing any id this service did not mint."""
    if not STAMP_ID_RE.match(stamp_id or ""):
        raise ValueError(f"Invalid stamp id: {stamp_id!r}")
    extension = "png" if content_type == "image/png" else "jpg"
    return os.path.join(storage_dir, "stamps", f"{stamp_id}.{extension}")


def ensure_stamp_dir(storage_dir: str) -> str:
    target = os.path.join(storage_dir, "stamps")
    os.makedirs(target, exist_ok=True)
    return target
