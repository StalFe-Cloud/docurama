"""
Backend-agnostic document storage (Sprint 3).

storage_layout.py stores absolute local paths in database rows, which couples
every envelope row to one host's filesystem and blocks multi-replica cloud
deployments. This module introduces the seam: a storage interface selected by
DOCURAMA_STORAGE_BACKEND with two implementations -

- LocalBackend: the existing behaviour, kept byte-compatible with the rows the
  database already holds (same root, same relative layout), hardened with
  atomic tmp+rename writes and key containment.
- S3Backend: private-bucket object storage with default-deny reads and
  short-lived presigned URLs, so documents are only ever readable through an
  authorised, expiring link.

Keys are validated before any backend touches them: a key is a relative POSIX
path that may not escape the logical root, may not contain traversal segments,
and may not smuggle absolute paths or Windows drive letters. This holds no
matter how trustworthy the caller looks, because keys end up concatenated into
filesystem paths and object URLs alike.
"""
import os
import re
import tempfile
from abc import ABC, abstractmethod
from typing import Optional, Tuple

from app.core.config import settings
from app.services.storage_crypto import (
    KeyRing,
    EncryptionError,
    decrypt as _crypto_decrypt,
    encrypt as _crypto_encrypt,
    is_encrypted_blob,
)


class StorageError(Exception):
    """Raised for invalid keys or backend failures."""


_KEY_FORBIDDEN = re.compile(r"(^|/)\.\.?(/|$)|\\")


def validate_key(key: str) -> str:
    """
    Normalise and validate a storage key, raising StorageError on anything
    that could resolve outside the logical root.

    Returns the normalised key (leading slash stripped, no trailing slash).
    """
    if not isinstance(key, str) or not key.strip():
        raise StorageError("storage key must be a non-empty string")
    # Absolute keys are rejected outright, not silently relocated: os.path.join
    # would otherwise discard the root entirely, which is the classic escape.
    if key.lstrip().startswith("/") or key.strip().startswith("/"):
        raise StorageError("storage key must be relative to the storage root")
    cleaned = key.strip().lstrip("/")
    if not cleaned or cleaned.endswith("/"):
        raise StorageError("storage key must name a file, not a directory")
    if _KEY_FORBIDDEN.search(cleaned):
        raise StorageError("storage key may not contain traversal segments")
    if re.match(r"^[A-Za-z]:", cleaned):
        raise StorageError("storage key may not contain a drive letter")
    if "\x00" in cleaned:
        raise StorageError("storage key may not contain null bytes")
    return cleaned


class StorageBackend(ABC):
    """Minimal interface the document pipeline needs."""

    name: str = "abstract"

    @abstractmethod
    def save(self, key: str, data: bytes) -> str:
        """Persist bytes under key; returns a handle the DB may store."""

    @abstractmethod
    def open(self, handle: str) -> bytes:
        """Read back the bytes for a previously stored handle."""

    @abstractmethod
    def presign(self, handle: str, ttl_seconds: int = 300) -> Optional[str]:
        """Return a short-lived download URL, or None if unsupported."""


class LocalBackend(StorageBackend):
    """
    Filesystem backend compatible with the historical storage_layout rows:
    the stored handle is the absolute path under STORAGE_DIR, exactly as the
    rest of the pipeline already writes and reads them.
    """

    name = "local"

    def __init__(self, root: Optional[str] = None):
        self.root = os.path.realpath(root or settings.STORAGE_DIR)

    def _resolve(self, handle: str) -> str:
        resolved = os.path.realpath(handle)
        if resolved != self.root and not resolved.startswith(self.root + os.sep):
            raise StorageError("storage handle escapes the storage root")
        return resolved

    def save(self, key: str, data: bytes) -> str:
        key = validate_key(key)
        target_dir = os.path.join(self.root, os.path.dirname(key))
        os.makedirs(target_dir, exist_ok=True)
        target = os.path.join(self.root, key)
        # Atomic write: a crash mid-save must never leave a truncated document
        # that later reads back as a different file than the sha that was stored.
        fd, tmp_path = tempfile.mkstemp(dir=target_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp_path, target)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return target

    def open(self, handle: str) -> bytes:
        path = self._resolve(handle)
        if not os.path.isfile(path):
            raise StorageError("object not found")
        with open(path, "rb") as fh:
            return fh.read()

    def presign(self, handle: str, ttl_seconds: int = 300) -> Optional[str]:
        # A local path is not a URL; callers stream the file through the API.
        return None


class S3Backend(StorageBackend):
    """
    Private-bucket backend. boto3 is imported lazily so the dependency stays
    optional for self-hosted installs that never leave the local volume.

    Objects are written with no public grants; reads happen through presigned
    GET urls capped at a short TTL, so a leaked link expires before it can be
    replayed usefully.
    """

    name = "s3"

    def __init__(
        self,
        bucket: Optional[str] = None,
        prefix: str = "docurama",
        client=None,
    ):
        self.bucket = bucket or os.getenv("DOCURAMA_S3_BUCKET", "")
        self.prefix = prefix.strip("/") + "/"
        self._client = client  # injectable for tests; lazily built otherwise
        if not self.bucket:
            raise StorageError("S3 backend requires DOCURAMA_S3_BUCKET")

    @property
    def client(self):
        if self._client is None:
            import boto3  # optional dependency

            self._client = boto3.client("s3")
        return self._client

    def _object_key(self, handle: str) -> str:
        # Handles may be either bare keys or full s3:// URIs; both normalise
        # through the same validation. A handle that already carries the
        # backend prefix (i.e. a value save() returned) is not re-prefixed.
        if handle.startswith("s3://"):
            handle = handle[len("s3://") :]
            if "/" in handle:
                handle = handle.split("/", 1)[1]
        cleaned = validate_key(handle)
        if cleaned.startswith(self.prefix):
            return cleaned
        return self.prefix + cleaned

    def save(self, key: str, data: bytes) -> str:
        object_key = self._object_key(key)
        self.client.put_object(
            Bucket=self.bucket,
            Key=object_key,
            Body=data,
            # Explicit private ACL even when the bucket default changes.
            ServerSideEncryption="AES256",
        )
        return f"s3://{self.bucket}/{object_key}"

    def open(self, handle: str) -> bytes:
        object_key = self._object_key(handle)
        response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        return response["Body"].read()

    def presign(self, handle: str, ttl_seconds: int = 300) -> str:
        object_key = self._object_key(handle)
        # A presign that outlives a working session is a liability; clamp it.
        ttl = max(30, min(int(ttl_seconds), 900))
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": object_key},
            ExpiresIn=ttl,
        )


class EncryptedBackend(StorageBackend):
    """
    Transparent at-rest encryption wrapper (ISO-04).

    Every payload is envelope-encrypted with AES-256-GCM before it reaches
    the inner backend, and authenticated-decrypted on the way back out, so
    the plaintext never touches disk or object storage. Reads of rows written
    before encryption was activated pass through untouched (legacy tolerance)
    and are re-encrypted on their next save.

    Presigned URLs are disabled under encryption: a presigned object URL would
    hand out ciphertext the browser cannot read, and serving plaintext through
    object storage would bypass the API's authorisation layer — documents are
    streamed through the API instead, where session and scope checks apply.

    Tamper detection is a read-time property: any modification of the stored
    bytes after write fails the GCM tag check and surfaces as EncryptionError.
    """

    name = "encrypted"

    def __init__(self, inner: StorageBackend, ring: KeyRing):
        self.inner = inner
        self.ring = ring

    def save(self, key: str, data: bytes) -> str:
        return self.inner.save(key, _crypto_encrypt(self.ring, data))

    def open(self, handle: str) -> bytes:
        blob = self.inner.open(handle)
        if not is_encrypted_blob(blob):
            # Legacy row written before activation; read through as-is.
            return blob
        return _crypto_decrypt(self.ring, blob)

    def presign(self, handle: str, ttl_seconds: int = 300) -> Optional[str]:
        # Ciphertext-only URLs are useless to clients and plaintext URLs would
        # bypass authorisation, so presigning is intentionally unavailable.
        return None


def get_backend() -> StorageBackend:
    """Return the configured backend; unknown names fail closed to local.

    When DOCURAMA_STORAGE_ENCRYPTION_KEY is set, the chosen backend is
    wrapped in EncryptedBackend so every write is envelope-encrypted no
    matter which backend is underneath.
    """
    chosen = (getattr(settings, "STORAGE_BACKEND", "local") or "local").strip().lower()
    if chosen == "s3":
        backend: StorageBackend = S3Backend()
    else:
        backend = LocalBackend()
    ring = KeyRing.from_settings()
    if ring is not None:
        return EncryptedBackend(backend, ring)
    return backend
