"""
API key minting and verification.

Keys are stored as hashes only, so a leaked database row cannot be replayed. The
plaintext is returned once at creation and never again.

Format: dcr_<prefix>_<secret>. The prefix is stored in clear so a key can be
identified in the UI and looked up in one indexed query without scanning every
hash in the table.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

KEY_NAMESPACE = "dcr"
PREFIX_BYTES = 4      # 8 hex characters
SECRET_BYTES = 32
VALID_SCOPES = ["read", "write"]
DEFAULT_SCOPES = ["read"]


def generate_api_key() -> Tuple[str, str, str]:
    """
    Mint a key. Returns (plaintext, prefix, hashed).
    The caller stores prefix and hash, and shows the plaintext exactly once.
    """
    prefix = secrets.token_hex(PREFIX_BYTES)
    secret = secrets.token_urlsafe(SECRET_BYTES)
    plaintext = f"{KEY_NAMESPACE}_{prefix}_{secret}"
    return plaintext, prefix, hash_api_key(plaintext)


def hash_api_key(plaintext: str) -> str:
    """SHA-256 of the whole key. Keys carry full entropy, so no salt or KDF is needed."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def verify_api_key(plaintext: str, hashed: str) -> bool:
    """Constant-time comparison so a mismatch cannot be timed."""
    return hmac.compare_digest(hash_api_key(plaintext), hashed)


def parse_prefix(plaintext: str) -> Optional[str]:
    """
    Extract the lookup prefix from a presented key, or None when it is not
    shaped like one of ours.
    """
    if not plaintext:
        return None
    # The secret is token_urlsafe, which may itself contain "_", so only the first
    # two separators are structural.
    parts = plaintext.split("_", 2)
    if len(parts) != 3:
        return None
    namespace, prefix, secret = parts
    if namespace != KEY_NAMESPACE or not secret:
        return None
    if len(prefix) != PREFIX_BYTES * 2:
        return None
    try:
        int(prefix, 16)
    except ValueError:
        return None
    return prefix


def normalise_scopes(scopes: Optional[List[str]]) -> List[str]:
    """Keep only recognised scopes, preserving order and dropping duplicates."""
    if not scopes:
        return list(DEFAULT_SCOPES)
    seen = []
    for scope in scopes:
        s = (scope or "").strip().lower()
        if s in VALID_SCOPES and s not in seen:
            seen.append(s)
    return seen or list(DEFAULT_SCOPES)


def expiry_from_days(days: Optional[int]) -> Optional[datetime]:
    """Translate a requested lifetime into an absolute expiry. None means no expiry."""
    if not days or days <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(days=days)


def is_usable(is_active: bool, revoked_at, expires_at) -> bool:
    """A key is usable only while active, not revoked, and not past its expiry."""
    if not is_active or revoked_at is not None:
        return False
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) <= expires_at
