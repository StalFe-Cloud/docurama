"""
Password reset by email.

Tokens are stored as hashes and are single use. The plaintext exists only in the
email, so a leaked database row cannot be turned into a reset link, following the
same rule as API keys.

The request endpoint answers identically whether or not the address exists. A
differing response, or a differing response time, tells an attacker which addresses
are registered.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

# Long enough to survive a slow mail queue and a distracted user, short enough that a
# link left in an inbox does not stay live for days.
TOKEN_TTL_MINUTES = 60
TOKEN_BYTES = 32

MIN_PASSWORD_LENGTH = 12


def generate_token() -> Tuple[str, str]:
    """Return (plaintext, hashed). Only the hash is ever stored."""
    plaintext = secrets.token_urlsafe(TOKEN_BYTES)
    return plaintext, hash_token(plaintext)


def hash_token(plaintext: str) -> str:
    """SHA-256. The token carries full entropy, so no salt or KDF is required."""
    return hashlib.sha256((plaintext or "").encode("utf-8")).hexdigest()


def tokens_match(plaintext: str, hashed: str) -> bool:
    return hmac.compare_digest(hash_token(plaintext), hashed or "")


def expiry_from_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)


def is_redeemable(expires_at: Optional[datetime], used_at: Optional[datetime]) -> bool:
    """
    A token is redeemable only while unused and unexpired.

    Both conditions matter independently: expiry bounds how long a link left in an
    inbox stays dangerous, and single use stops the same link being replayed by
    anyone who later reads that inbox.
    """
    if used_at is not None:
        return False
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) <= expires_at


def validate_new_password(password: str, current_password: Optional[str] = None) -> Optional[str]:
    """
    Return a rejection reason, or None when acceptable.

    Kept here so the reset flow and the change-password endpoint cannot drift apart
    on what counts as an acceptable password.
    """
    password = password or ""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Choose a password of at least {MIN_PASSWORD_LENGTH} characters."
    if current_password is not None and password == current_password:
        return "The new password must differ from the current one."
    return None


def reset_url(app_url: str, token: str) -> str:
    return f"{app_url.rstrip('/')}/reset-password?token={token}"
