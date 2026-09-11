"""
Per-account storage layout.

Every new document artifact is written under
<STORAGE_DIR>/accounts/<account_id>/ so a tenant's files live together and a
future storage backend can map the layout directly. Paths are stored in the
database exactly as written, so rows created before this layout keep reading
their flat paths with no migration.
"""
import os

from app.services.preview_store import is_valid_account_id


def account_root(storage_dir: str, account_id: str) -> str:
    if not is_valid_account_id(account_id):
        raise ValueError(f"Invalid account id: {account_id!r}")
    return os.path.join(storage_dir, "accounts", account_id)


def artifact_path(storage_dir: str, account_id: str, filename: str) -> str:
    if not filename or os.path.basename(filename) != filename:
        raise ValueError(f"Artifact filename must be a bare name: {filename!r}")
    return os.path.join(account_root(storage_dir, account_id), filename)


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path
