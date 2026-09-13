"""
Regression tests for the P0 launch-blocker security fixes.

Covers:
- P0-1  MFA challenge tokens are rejected as session credentials.
- P0-2  The signing session no longer discloses co-signers' signing tokens.
- P0-5  SPA path resolution cannot escape the frontend dist root.
- P0-10 Signers cannot write fields assigned to another recipient; signature
        image payloads are size-capped.
- P0-8  Completion flow end-to-end (the highest-value previously untested path).
"""
import base64
import os

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.models import Account, Envelope, Field, Recipient, User


async def _make_user(db_session: AsyncSession, email: str, role: str = "admin") -> User:
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password="not-a-real-hash",
        first_name="Test",
        role=role,
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.commit()
    return user


# ---------------------------------------------------------------------------
# P0-1 — token purpose enforcement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mfa_challenge_token_rejected_as_session(client, db_session):
    user = await _make_user(db_session, "mfa-victim@example.com")

    challenge = create_access_token(
        subject=user.id,
        claims={"purpose": "mfa_challenge", "email": user.email},
    )
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {challenge}"}
    )
    assert resp.status_code == 401, "challenge token must not authenticate"


@pytest.mark.asyncio
async def test_session_and_legacy_tokens_still_authenticate(client, db_session):
    user = await _make_user(db_session, "mfa-holder@example.com")

    stamped = create_access_token(
        subject=user.id,
        claims={"purpose": "session", "email": user.email},
    )
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {stamped}"}
    )
    assert resp.status_code == 200, resp.text

    # Tokens minted before the purpose claim existed must keep working.
    legacy = create_access_token(subject=user.id, claims={"email": user.email})
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {legacy}"}
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# P0-5 — SPA path resolution containment
# ---------------------------------------------------------------------------

def test_spa_path_resolution_blocks_traversal(tmp_path):
    from app.main import _resolve_spa_path

    (tmp_path / "index.html").write_text("<html></html>")
    sub = tmp_path / "assets"
    sub.mkdir()
    (sub / "app.js").write_text("//js")

    assert _resolve_spa_path(str(tmp_path), "index.html") == os.path.realpath(
        tmp_path / "index.html"
    )
    assert _resolve_spa_path(str(tmp_path), "assets/app.js") == os.path.realpath(
        sub / "app.js"
    )
    # Absolute path discards the base in os.path.join — must be refused.
    assert _resolve_spa_path(str(tmp_path), "/etc/passwd") is None
    # Parent traversal must be refused.
    assert _resolve_spa_path(str(tmp_path), "../outside.txt") is None
    assert _resolve_spa_path(str(tmp_path), "assets/../../outside.txt") is None
    # The dist root itself is not a file response.
    assert _resolve_spa_path(str(tmp_path), "") is None
    assert _resolve_spa_path(str(tmp_path), ".") is None


# ---------------------------------------------------------------------------
# P0-2 — co-signer token disclosure
# ---------------------------------------------------------------------------

async def _two_signer_envelope(db_session: AsyncSession, tmp_path):
    account = Account(name="Token Leak Co")
    db_session.add(account)
    await db_session.flush()

    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 minimal")
    envelope = Envelope(
        account_id=account.id,
        title="Two Signers",
        original_pdf_path=str(pdf),
    )
    db_session.add(envelope)
    await db_session.flush()

    r1 = Recipient(
        envelope_id=envelope.id, name="Alpha One", email="alpha@example.com",
        role="signer", signing_token="tok_alpha_secret", status="sent",
        routing_order=1,
    )
    r2 = Recipient(
        envelope_id=envelope.id, name="Beta Two", email="beta@example.com",
        role="signer", signing_token="tok_beta_secret", status="sent",
        routing_order=2,
    )
    db_session.add_all([r1, r2])
    await db_session.flush()

    f1 = Field(
        envelope_id=envelope.id, recipient_id=r1.id, field_type="text",
        page_number=1, x=10, y=10, width=100, height=30, value=None, label="Alpha field",
    )
    f2 = Field(
        envelope_id=envelope.id, recipient_id=r2.id, field_type="text",
        page_number=1, x=10, y=60, width=100, height=30, value=None, label="Beta field",
    )
    db_session.add_all([f1, f2])
    await db_session.commit()
    return envelope, r1, r2, f1, f2


@pytest.mark.asyncio
async def test_signing_session_hides_co_signer_tokens(client, db_session, tmp_path):
    _, r1, _, _, _ = await _two_signer_envelope(db_session, tmp_path)

    resp = await client.get(f"/api/signing/{r1.signing_token}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # The caller's own token is still present in their own recipient object.
    assert data["recipient"]["signing_token"] == r1.signing_token
    # No co-signer entry may carry a signing token.
    for other in data["all_recipients"]:
        assert "signing_token" not in other, (
            "co-signer signing_token leaked through all_recipients"
        )


@pytest.mark.asyncio
async def test_envelope_detail_hides_tokens_from_members(client, db_session, tmp_path):
    envelope, _, _, _, _ = await _two_signer_envelope(db_session, tmp_path)
    member = await _make_user(db_session, "member-view@example.com", role="member")

    # The member shares the envelope's account: point them at it.
    member.account_id = envelope.account_id
    db_session.add(member)
    await db_session.commit()

    resp = await client.get(
        f"/api/envelopes/{envelope.id}",
        headers={"Authorization": f"Bearer {create_access_token(subject=member.id, claims={'purpose': 'session'})}"},
    )
    assert resp.status_code == 200, resp.text
    for r in resp.json()["recipients"]:
        assert r["signing_token"] == "", "member harvested a signing token"


# ---------------------------------------------------------------------------
# P0-10 — cross-recipient field writes and payload cap
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_signer_cannot_write_other_recipients_field(client, db_session, tmp_path):
    _, r1, _, f1, f2 = await _two_signer_envelope(db_session, tmp_path)

    resp = await client.post(
        f"/api/signing/{r1.signing_token}/submit",
        json={
            "signatures": [
                {"field_id": f2.id, "value": "forged-by-alpha"},
                {"field_id": f1.id, "value": "legitimate-alpha"},
            ],
            "signature_type": "draw",
        },
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(f1)
    await db_session.refresh(f2)
    assert f1.value == "legitimate-alpha"
    assert f2.value is None, "signer wrote into another signer's field"


@pytest.mark.asyncio
async def test_signature_data_url_size_cap(client, db_session, tmp_path):
    _, r1, _, _, _ = await _two_signer_envelope(db_session, tmp_path)

    big = "data:image/png;base64," + base64.b64encode(b"x" * (2_000_001)).decode()
    resp = await client.post(
        f"/api/signing/{r1.signing_token}/submit",
        json={"signatures": [], "signature_data_url": big, "signature_type": "draw"},
    )
    assert resp.status_code == 413, "oversized signature payloads must be rejected"


# ---------------------------------------------------------------------------
# P0-8 — completion flow end-to-end
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_envelope_completes_after_final_signature(client, db_session, tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path / "storage"))

    account = Account(name="Completion Co")
    db_session.add(account)
    await db_session.flush()

    # A real, valid single-page PDF so the overlay/certificate pipeline runs.
    import fitz

    pdf = tmp_path / "contract.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Test agreement")
    doc.save(str(pdf))
    doc.close()

    envelope = Envelope(
        account_id=account.id,
        title="E2E Completion",
        original_pdf_path=str(pdf),
    )
    db_session.add(envelope)
    await db_session.flush()

    signer = Recipient(
        envelope_id=envelope.id, name="Solo Signer", email="solo@example.com",
        role="signer", signing_token="tok_e2e_solo", status="sent",
    )
    db_session.add(signer)
    await db_session.flush()
    sig_field = Field(
        envelope_id=envelope.id, recipient_id=signer.id, field_type="signature",
        page_number=1, x=72, y=400, width=150, height=50, label="Signature",
    )
    db_session.add(sig_field)
    await db_session.commit()

    resp = await client.post(
        f"/api/signing/{signer.signing_token}/submit",
        json={
            "signatures": [{"field_id": sig_field.id, "value": "Solo Signer"}],
            "signature_type": "draw",
        },
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(envelope)
    assert envelope.status == "completed"
    assert envelope.completed_at is not None
    # Honest seal reporting: without a signing certificate the run records
    # "unsealed" rather than pretending to be sealed.
    assert envelope.seal_status in ("sealed", "unsealed")
    assert envelope.sha256_signed
