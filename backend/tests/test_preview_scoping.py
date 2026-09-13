"""
Account scoping for builder previews.

A preview used to be stored flat in the storage directory and rendered to any
authenticated user who knew the 128-bit doc id, which made entropy the only
access control. These tests pin the per-account layout and the render scoping.
"""
import pytest

from app.services.preview_store import new_doc_id, preview_path, preview_root


async def test_cross_account_preview_render_is_404(client, db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path))
    from app.api import documents as documents_api
    monkeypatch.setattr(documents_api.settings, "STORAGE_DIR", str(tmp_path))

    account = Account(name="A")
    other = Account(name="B")
    db_session.add_all([account, other])
    await db_session.flush()
    alice = User(account_id=account.id, email="alice@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    mallory = User(account_id=other.id, email="mallory@example.com",
                   hashed_password=get_password_hash("a-long-password-1234"),
                   role="admin", is_active=True)
    db_session.add_all([alice, mallory])
    await db_session.flush()
    db_session.add_all([
        AccountMembership(user_id=alice.id, account_id=account.id, role="owner"),
        AccountMembership(user_id=mallory.id, account_id=other.id, role="owner"),
    ])
    await db_session.commit()

    # Mallory cannot render a preview Alice stored, even with the exact doc id.
    doc_id = new_doc_id()
    path = preview_path(str(tmp_path), doc_id, account.id)
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"%PDF-1.4 placeholder")

    login = await client.post("/api/auth/login",
                              json={"email": "mallory@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.get(f"/api/documents/{doc_id}/pages/1")
    assert resp.status_code == 404
