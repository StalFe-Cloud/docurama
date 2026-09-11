"""
Document artifacts belong to the account that owns them. New writes land under
storage/accounts/<account_id>/; legacy rows keep their stored flat paths.
"""
import os

import pytest

from app.services.storage_layout import account_root, artifact_path, ensure_dir


def test_account_root_is_namespaced():
    root = account_root("/data", "0b5a9a4e-1111-4222-8333-444455556666")
    assert root == os.path.join("/data", "accounts",
                                "0b5a9a4e-1111-4222-8333-444455556666")


def test_rejects_invalid_account_ids():
    with pytest.raises(ValueError):
        account_root("/data", "../escape")
    with pytest.raises(ValueError):
        account_root("/data", "")


def test_artifact_path_joins_safely():
    path = artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                         "env_original.pdf")
    assert path.endswith(os.path.join("accounts",
                                      "0b5a9a4e-1111-4222-8333-444455556666",
                                      "env_original.pdf"))


def test_artifact_path_rejects_separators():
    with pytest.raises(ValueError):
        artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                      "sub/dir/file.pdf")
    with pytest.raises(ValueError):
        artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666", "..\\x.pdf")


def test_ensure_dir_creates_and_is_idempotent(tmp_path):
    target = os.path.join(str(tmp_path), "accounts", "x")
    first = ensure_dir(target)
    second = ensure_dir(target)
    assert os.path.isdir(first)
    assert first == second == target


async def test_template_upload_lands_in_account_dir(client, db_session, tmp_path,
                                                    monkeypatch):
    from app.core import config
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path))

    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="uploader@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "uploader@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    from app.services.pdf_service import get_pdf_pages_info  # noqa: F401
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    resp = await client.post(
        "/api/templates",
        data={"title": "Layout Probe"},
        files={"file": ("probe.pdf", minimal_pdf, "application/pdf")},
    )
    # The template creation endpoint answers 201 Created.
    assert resp.status_code == 201, resp.text

    account_dir = tmp_path / "accounts" / account.id
    assert account_dir.is_dir()
    files = list(account_dir.iterdir())
    assert files, "no artifact written under the account directory"


def test_best_effort_path_falls_back_to_flat_for_none_account():
    from app.services.storage_layout import best_effort_artifact_path

    path = best_effort_artifact_path("/data", None, "env_original.pdf")
    assert path == os.path.join("/data", "env_original.pdf")


def test_best_effort_path_namespaces_valid_accounts():
    from app.services.storage_layout import best_effort_artifact_path

    path = best_effort_artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                                     "env_original.pdf")
    assert os.path.join("accounts", "0b5a9a4e-1111-4222-8333-444455556666") in path
