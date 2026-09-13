"""
At-rest encryption for stored documents (Sprint 6).

The ISO-04 catalog entry used to say files are plaintext on the storage
backend. This module closes that gap with an authenticated-encryption
envelope format applied at the storage layer, so every backend (local disk,
S3, anything added later) inherits it without code changes:

    blob := MAGIC(5) | key_id(1) | nonce(12) | AESGCM(key, nonce, plaintext)

- AES-256-GCM: confidentiality AND integrity. A flipped bit anywhere after
  the header fails the tag check on read, so silent corruption of stored
  documents is detected instead of served.
- Per-object random 96-bit nonces: GCM never reused under one key.
- Key rotation: the 1-byte key id travels in the header, so old material can
  be moved to the decrypt-only previous set and new writes go out under the
  new key without a migration pass.
- Legacy tolerance: blobs without the magic header are read through as-is,
  so switching encryption on mid-life never bricks rows written before
  activation; they are re-encrypted on their next save.

The key material comes from configuration (DOCURAMA_STORAGE_ENCRYPTION_KEY,
hex/base64/32 raw bytes). No key configured means encryption is off - that
state is visible in the catalog, not hidden behind a fake claim.
"""
import base64
import binascii
import os
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"DCRM1"  # envelope format version 1
_NONCE_LEN = 12
_TAG_LEN = 16
_KEY_LEN = 32
_HEADER_LEN = len(MAGIC) + 1 + _NONCE_LEN
_MIN_BLOB_LEN = _HEADER_LEN + _TAG_LEN

_PREVIOUS_KEY_ID_BASE = 200  # auto-ids for entries configured without an id


class EncryptionError(Exception):
    """Raised for key material problems, malformed blobs and tag failures."""


def _decode_material(raw: str) -> bytes:
    """Accept hex, base64 or 32 raw bytes for a key; require exactly 32."""
    raw = (raw or "").strip()
    if not raw:
        raise EncryptionError("empty key material")
    # hex (64 chars)
    if len(raw) == 2 * _KEY_LEN:
        try:
            decoded = binascii.unhexlify(raw)
            if len(decoded) == _KEY_LEN:
                return decoded
        except (binascii.Error, ValueError):
            pass
    # base64
    try:
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        if len(decoded) == _KEY_LEN:
            return decoded
    except (binascii.Error, ValueError):
        pass
    # raw bytes
    if len(raw.encode("utf-8")) == _KEY_LEN:
        return raw.encode("utf-8")
    raise EncryptionError(
        "key material must decode to exactly 32 bytes (hex, base64 or raw)"
    )


class KeyRing:
    """The primary write key plus any number of decrypt-only previous keys."""

    def __init__(self, primary_key: bytes, key_id: int = 1, previous: dict = None):
        if len(primary_key) != _KEY_LEN:
            raise EncryptionError("primary key must be exactly 32 bytes")
        if not (0 <= int(key_id) <= 255):
            raise EncryptionError("key id must fit in one byte (0-255)")
        self._keys = {int(key_id): primary_key}
        for prev_id, material in (previous or {}).items():
            if not (0 <= int(prev_id) <= 255):
                raise EncryptionError("previous key id must fit in one byte")
            if int(prev_id) == int(key_id):
                raise EncryptionError("previous key id collides with the primary id")
            if len(material) != _KEY_LEN:
                raise EncryptionError("previous key material must be exactly 32 bytes")
            self._keys[int(prev_id)] = material
        self._primary_id = int(key_id)

    @property
    def primary_id(self) -> int:
        return self._primary_id

    def key_for(self, key_id: int) -> bytes:
        try:
            return self._keys[int(key_id)]
        except KeyError:
            raise EncryptionError(f"no key material for key id {key_id}")

    @classmethod
    def from_settings(cls) -> "Optional[KeyRing]":
        """Build the ring from application settings; None when disabled."""
        from app.core.config import settings

        raw = (getattr(settings, "STORAGE_ENCRYPTION_KEY", "") or "").strip()
        if not raw:
            return None
        key_id = int(getattr(settings, "STORAGE_ENCRYPTION_KEY_ID", 1) or 1)
        previous = {}
        auto_id = _PREVIOUS_KEY_ID_BASE
        for entry in (getattr(settings, "STORAGE_ENCRYPTION_KEY_PREVIOUS", "") or "").split(","):
            entry = entry.strip()
            if not entry:
                continue
            if ":" in entry:
                id_part, material = entry.split(":", 1)
                if id_part.strip().isdigit():
                    prev_id = int(id_part.strip())
                else:
                    prev_id, auto_id = auto_id, auto_id + 1
            else:
                prev_id, material = auto_id, entry
                auto_id += 1
            previous[prev_id] = _decode_material(material)
        return cls(_decode_material(raw), key_id=key_id, previous=previous)


def encrypt(ring: KeyRing, plaintext: bytes) -> bytes:
    """Envelope-encrypt bytes under the ring's primary key."""
    nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(ring.key_for(ring.primary_id)).encrypt(nonce, plaintext, None)
    return MAGIC + bytes([ring.primary_id]) + nonce + ciphertext


def decrypt(ring: KeyRing, blob: bytes) -> bytes:
    """Authenticate-and-decrypt an envelope blob."""
    if not isinstance(blob, (bytes, bytearray)) or len(blob) < _MIN_BLOB_LEN:
        raise EncryptionError("blob is too short to be an encrypted document")
    blob = bytes(blob)
    if not blob.startswith(MAGIC):
        raise EncryptionError("blob does not carry the envelope magic header")
    key_id = blob[len(MAGIC)]
    try:
        key = ring.key_for(key_id)
    except EncryptionError:
        raise EncryptionError(
            f"document was written under key id {key_id}, which is not configured "
            "(rotated out or misconfigured operator key)"
        )
    nonce = blob[len(MAGIC) + 1:_HEADER_LEN]
    ciphertext = blob[_HEADER_LEN:]
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise EncryptionError(
            "authentication tag check failed - the stored bytes were modified "
            "or corrupted after write"
        )


def is_encrypted_blob(blob: bytes) -> bool:
    """True when the bytes carry the envelope header (no key needed to tell)."""
    return isinstance(blob, (bytes, bytearray)) and bytes(blob[:len(MAGIC)]) == MAGIC
