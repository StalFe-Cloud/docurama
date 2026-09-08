"""
Encryption for credentials that must be recoverable.

Some secrets cannot be hashed. An API key is only ever compared, so it is stored as a
digest and never recovered. An SMTP password has to be presented to the mail server on
every send, so it must come back out again.

Those are held encrypted with Fernet (AES-128-CBC plus an HMAC tag) under a key derived
from DOCURAMA_SECRET_KEY. The consequence is deliberate and documented: rotating
SECRET_KEY invalidates every stored credential and they have to be entered again. The
alternative, a second key to manage, is worse for a single-tenant deployment.

Encryption at rest is not a substitute for access control. It protects a database dump,
a backup or a replica; it does not protect against an attacker who can already read the
application's configuration.
"""
import base64
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

# Distinguishes this derivation from any other use of SECRET_KEY, so the same master
# secret cannot produce the same key for two different purposes.
_HKDF_INFO = b"docurama.stored-credential.v1"

_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key_material = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=_HKDF_INFO,
        ).derive(settings.SECRET_KEY.encode("utf-8"))
        _fernet = Fernet(base64.urlsafe_b64encode(key_material))
    return _fernet


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a credential for storage. An empty value stays empty rather than becoming ciphertext."""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> Optional[str]:
    """
    Recover a stored credential.

    Returns None when it cannot be decrypted, which in practice means SECRET_KEY was
    rotated. Callers treat that as "not configured" and report it, rather than
    presenting a corrupt password to a mail server and reading the resulting refusal
    as a delivery failure.
    """
    if not ciphertext:
        return None
    try:
        return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return None


def reset_cache() -> None:
    """Drop the derived key. Used by tests that change SECRET_KEY."""
    global _fernet
    _fernet = None
