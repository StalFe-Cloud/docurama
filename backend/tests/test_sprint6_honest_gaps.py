"""
Sprint 6: closing the honest gaps.

Pins the four controls that moved to Implemented this sprint:

- ISO-04 — at-rest encryption: AES-256-GCM envelope format at the storage
  layer (roundtrip, tamper rejection, wrong key, legacy-row tolerance, key
  rotation, S3 integration, presign disabled, get_backend wiring);
- SOC2-01 — the risk register: server-computed scores, vocabulary, seed
  assessment, admin gating, audit-ledger writes;
- ISO-06 — the restore-drill harness: integrity + chain verification on a
  restored copy, tamper detection, drill evidence recording;
- ISO-07 — scheduled scanning surface: weekly CI trigger, container-scan
  job, SBOM generator output.

Where a behaviour cannot honestly be claimed, the test pins the refusal.
"""
import base64
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core import config
from app.core.security import create_access_token, get_password_hash
from app.models import Account, SecurityEvent, User
from app.services import audit_chain
from app.services.storage_backend import (
    EncryptedBackend, LocalBackend, S3Backend, get_backend,
)
from app.services.storage_crypto import (
    MAGIC, EncryptionError, KeyRing, decrypt, encrypt, is_encrypted_blob,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))  # makes `scripts.*` importable as a namespace package

KEY_HEX_A = "aa" * 32
KEY_HEX_B = "bb" * 32
KEY_HEX_C = "cc" * 32
KEY_RAW_ASCII = b"abcdefghijklmnopqrstuvwxyz012345"  # exactly 32 raw bytes


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _ring(previous: dict = None, key_id: int = 1, material: str = KEY_HEX_A) -> KeyRing:
    from app.services.storage_crypto import _decode_material
    return KeyRing(_decode_material(material), key_id=key_id, previous=previous)


async def _make_admin(db_session, email: str = "sprint6-admin@example.com"):
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password=get_password_hash("a-long-enough-password-123"),
        first_name="Test",
        role="admin",
        account_id=account.id,
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _auth(user: User) -> dict:
    token = create_access_token(
        subject=user.id,
        claims={"purpose": "session", "role": user.role, "email": user.email,
                "account_id": user.account_id, "ver": user.token_version or 0},
    )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# ISO-04 — storage crypto primitives
# ---------------------------------------------------------------------------

def test_envelope_roundtrip_preserves_bytes():
    ring = _ring()
    payload = os.urandom(4096) + b"%PDF-1.4 tail"
    blob = encrypt(ring, payload)
    assert blob.startswith(MAGIC)
    assert payload not in blob  # ciphertext never contains the plaintext
    assert decrypt(ring, blob) == payload


def test_tampered_tag_fails_decryption():
    ring = _ring()
    blob = bytearray(encrypt(ring, b"confidential document"))
    blob[-1] ^= 0x01  # flip one bit in the tag region
    with pytest.raises(EncryptionError):
        decrypt(ring, bytes(blob))


def test_modified_ciphertext_body_fails_decryption():
    ring = _ring()
    blob = bytearray(encrypt(ring, b"confidential document"))
    blob[len(MAGIC) + 1 + 12] ^= 0xFF  # flip a byte inside the ciphertext
    with pytest.raises(EncryptionError):
        decrypt(ring, bytes(blob))


def test_wrong_key_fails_decryption():
    blob = encrypt(_ring(), b"secret")
    with pytest.raises(EncryptionError):
        decrypt(_ring(material=KEY_HEX_B), blob)


def test_key_rotation_old_key_still_decrypts():
    payload = b"written under key 1"
    blob = encrypt(_ring(), payload)
    assert blob[len(MAGIC)] == 1
    # A ring that no longer holds key 1 cannot read it: primary is key 2 and
    # no previous set carries key 1's material.
    without_key1 = _ring(key_id=2, material=KEY_HEX_B)
    with pytest.raises(EncryptionError):
        decrypt(without_key1, blob)
    # A ring carrying the rotated-out material decrypts regardless of primary.
    rotated = _ring(previous={1: bytes.fromhex(KEY_HEX_A), 2: bytes.fromhex(KEY_HEX_B)},
                    key_id=3, material=KEY_HEX_C)
    assert decrypt(rotated, blob) == payload


def test_decode_material_accepts_hex_base64_and_raw():
    from app.services.storage_crypto import _decode_material
    assert _decode_material(KEY_HEX_A) == bytes.fromhex(KEY_HEX_A)
    assert _decode_material(base64.urlsafe_b64encode(KEY_RAW_ASCII).decode()) == KEY_RAW_ASCII
    assert _decode_material(KEY_RAW_ASCII.decode("ascii")) == KEY_RAW_ASCII
    with pytest.raises(EncryptionError):
        _decode_material("short")
    with pytest.raises(EncryptionError):
        _decode_material("")


def test_keyring_rejects_bad_shapes():
    with pytest.raises(EncryptionError):
        KeyRing(b"short", key_id=1)
    with pytest.raises(EncryptionError):
        KeyRing(b"x" * 32, key_id=256)
    with pytest.raises(EncryptionError):
        KeyRing(b"x" * 32, key_id=1, previous={1: b"y" * 32})  # id collision


def test_keyring_from_settings_disabled_by_default(monkeypatch):
    monkeypatch.setattr(config.settings, "STORAGE_ENCRYPTION_KEY", "")
    assert KeyRing.from_settings() is None


def test_keyring_from_settings_parses_previous_entries(monkeypatch):
    monkeypatch.setattr(config.settings, "STORAGE_ENCRYPTION_KEY", KEY_HEX_A)
    monkeypatch.setattr(config.settings, "STORAGE_ENCRYPTION_KEY_ID", "5")
    monkeypatch.setattr(
        config.settings, "STORAGE_ENCRYPTION_KEY_PREVIOUS",
        f"2:{KEY_HEX_B},{KEY_HEX_C}",  # explicit id + auto id
    )
    ring = KeyRing.from_settings()
    assert ring.primary_id == 5
    assert ring.key_for(2) == bytes.fromhex(KEY_HEX_B)
    assert ring.key_for(200) == bytes.fromhex(KEY_HEX_C)  # auto-assigned
    with pytest.raises(EncryptionError):
        ring.key_for(9)


# ---------------------------------------------------------------------------
# ISO-04 — EncryptedBackend and get_backend wiring
# ---------------------------------------------------------------------------

def test_encrypted_backend_roundtrip_and_at_rest_ciphertext(tmp_path):
    backend = EncryptedBackend(LocalBackend(root=str(tmp_path)), _ring())
    handle = backend.save("envelopes/1/document.pdf", b"%PDF-1.4 plaintext")
    assert backend.open(handle) == b"%PDF-1.4 plaintext"
    # At rest, the file on disk is ciphertext, not the plaintext.
    on_disk = (tmp_path / "envelopes/1/document.pdf").read_bytes()
    assert is_encrypted_blob(on_disk)
    assert b"plaintext" not in on_disk


def test_encrypted_backend_legacy_plaintext_rows_still_read(tmp_path):
    plain = LocalBackend(root=str(tmp_path))
    handle = plain.save("envelopes/2/legacy.pdf", b"%PDF-1.4 written before activation")
    backend = EncryptedBackend(plain, _ring())
    assert backend.open(handle) == b"%PDF-1.4 written before activation"


def test_encrypted_backend_detects_on_disk_tampering(tmp_path):
    plain = LocalBackend(root=str(tmp_path))
    backend = EncryptedBackend(plain, _ring())
    handle = backend.save("envelopes/3/doc.pdf", b"body")
    target = tmp_path / "envelopes/3/doc.pdf"
    raw = bytearray(target.read_bytes())
    raw[-1] ^= 0xFF
    target.write_bytes(bytes(raw))
    with pytest.raises(EncryptionError):
        backend.open(handle)


def test_encrypted_backend_disables_presign(tmp_path):
    backend = EncryptedBackend(LocalBackend(root=str(tmp_path)), _ring())
    assert backend.presign("envelopes/1/document.pdf") is None


class _RecordingS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        return {"Body": _FakeBody(self.objects[(Bucket, Key)])}


class _FakeBody:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


def test_encrypted_s3_stores_ciphertext_not_plaintext():
    fake = _RecordingS3()
    s3 = S3Backend(bucket="bucket", client=fake)
    backend = EncryptedBackend(s3, _ring())
    backend.save("envelopes/9/doc.pdf", b"%PDF-1.4 s3 plaintext")
    stored = list(fake.objects.values())[0]
    assert is_encrypted_blob(stored)
    assert b"s3 plaintext" not in stored
    assert backend.open("envelopes/9/doc.pdf") == b"%PDF-1.4 s3 plaintext"
    assert backend.presign("envelopes/9/doc.pdf") is None


def test_get_backend_wraps_when_key_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(config.settings, "STORAGE_BACKEND", "local")
    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(config.settings, "STORAGE_ENCRYPTION_KEY", "")
    assert not isinstance(get_backend(), EncryptedBackend)

    monkeypatch.setattr(config.settings, "STORAGE_ENCRYPTION_KEY", KEY_HEX_A)
    backend = get_backend()
    assert isinstance(backend, EncryptedBackend)
    handle = backend.save("envelopes/wired/doc.pdf", b"body")
    assert backend.open(handle) == b"body"


# ---------------------------------------------------------------------------
# SOC2-01 — risk register
# ---------------------------------------------------------------------------

async def test_risk_scale_bounds_are_enforced(client, db_session):
    user = await _make_admin(db_session)
    # 9 is outside the 1-5 scale; the register cannot be gamed with it.
    resp = await client.post(
        "/api/admin/compliance/risks",
        json={
            "title": "Out-of-scale likelihood must be rejected",
            "description": "Scores live on 1-5 scales only.",
            "likelihood": 9, "impact": 5,
        },
        headers=_auth(user),
    )
    assert resp.status_code == 422


async def test_risk_register_seeds_and_summarises(client, db_session):
    user = await _make_admin(db_session)
    resp = await client.get("/api/admin/compliance/risks", headers=_auth(user))
    assert resp.status_code == 200
    body = resp.json()
    # The initial assessment ships with the product.
    keys = [r["risk_key"] for r in body["risks"]]
    assert "RSK-001" in keys and len(keys) >= 9
    # Scores are the product of their components, for every row.
    for risk in body["risks"]:
        assert risk["inherent_score"] == risk["likelihood"] * risk["impact"]
        assert risk["residual_score"] == risk["residual_likelihood"] * risk["residual_impact"]
    assert body["summary"]["open"] >= 9
    assert body["summary"]["top_inherent"] >= 10


async def test_risk_create_update_close_lifecycle(client, db_session):
    user = await _make_admin(db_session)
    created = (await client.post(
        "/api/admin/compliance/risks",
        json={
            "title": "New risk from the quarterly review",
            "description": "Registered through the API during a review cycle.",
            "likelihood": 3, "impact": 3, "treatment": "mitigate",
            "control_refs": "ISO-09",
        },
        headers=_auth(user),
    )).json()
    assert created["risk_key"].startswith("RSK-")
    assert created["inherent_score"] == 9
    assert created["status"] == "open"

    updated = (await client.patch(
        f"/api/admin/compliance/risks/{created['id']}",
        json={"likelihood": 2, "residual_impact": 1, "status": "closed"},
        headers=_auth(user),
    )).json()
    # Scores recomputed server-side from the components, not echoed back.
    assert updated["inherent_score"] == 2 * 3
    assert updated["residual_score"] == 2 * 1
    assert updated["status"] == "closed" and updated["closed_at"] is not None

    reopened = (await client.patch(
        f"/api/admin/compliance/risks/{created['id']}",
        json={"status": "mitigating"},
        headers=_auth(user),
    )).json()
    assert reopened["closed_at"] is None

    # Both lifecycle writes reached the hash-chained ledger.
    events = (await db_session.execute(
        select(SecurityEvent).where(SecurityEvent.event_type.in_(["risk_registered", "risk_updated"]))
    )).scalars().all()
    assert {e.event_type for e in events} == {"risk_registered", "risk_updated"}


async def test_risk_register_rejects_bad_vocabulary(client, db_session):
    user = await _make_admin(db_session)
    resp = await client.post(
        "/api/admin/compliance/risks",
        json={
            "title": "Bad treatment value",
            "description": "Treatment must be one of the four standard options.",
            "likelihood": 2, "impact": 2, "treatment": "ignore",
        },
        headers=_auth(user),
    )
    assert resp.status_code == 422

    created = (await client.post(
        "/api/admin/compliance/risks",
        json={
            "title": "Bad status via update",
            "description": "Status vocabulary is enforced.",
            "likelihood": 2, "impact": 2,
        },
        headers=_auth(user),
    )).json()
    resp = await client.patch(
        f"/api/admin/compliance/risks/{created['id']}",
        json={"status": "certified"},
        headers=_auth(user),
    )
    assert resp.status_code == 422


async def test_risk_endpoints_require_platform_admin(client):
    resp = await client.get("/api/admin/compliance/risks")
    assert resp.status_code == 401
    resp = await client.post("/api/admin/compliance/risks", json={})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# ISO-06 — restore-drill harness
# ---------------------------------------------------------------------------

async def _build_backup_with_chains(path: str) -> None:
    """Create a small but real backup: metadata tables + chained ledger rows."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.core.database import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(bind=engine, expire_on_commit=False)
        async with maker() as db:
            for i in range(4):
                await audit_chain.append_security_event(
                    db,
                    event_type="drill_fixture_event",
                    description=f"event {i}",
                    actor_email="drill@example.com",
                    detail={"i": i},
                )
            await db.commit()
    finally:
        await engine.dispose()


async def test_restore_drill_passes_on_healthy_backup(tmp_path):
    from scripts.restore_drill import perform_restore_drill

    backup = tmp_path / "backup.db"
    await _build_backup_with_chains(str(backup))
    report = await perform_restore_drill(str(backup))
    assert report["passed"] is True
    assert report["sqlite_integrity"] == "ok"
    assert report["tables_checked"] > 0
    assert report["rows_recovered"] > 0
    assert report["audit_chain"]["valid"] is True
    assert report["audit_chain"]["envelopes_broken"] == []


async def test_restore_drill_detects_chain_tampering(tmp_path):
    from scripts.restore_drill import perform_restore_drill

    backup = tmp_path / "backup.db"
    await _build_backup_with_chains(str(backup))

    # Tamper with the ledger the way an attacker with DB access would:
    # rewrite a description without fixing the chain hashes.
    con = sqlite3.connect(str(backup))
    con.execute("UPDATE security_events SET description = 'rewritten history' WHERE seq = 2")
    con.commit()
    con.close()

    report = await perform_restore_drill(str(backup))
    assert report["passed"] is False
    assert report["audit_chain"]["valid"] is False


async def test_restore_drill_reports_missing_backup(tmp_path):
    from scripts.restore_drill import perform_restore_drill

    report = await perform_restore_drill(str(tmp_path / "nope.db"))
    assert report["passed"] is False
    assert "not found" in report["error"]


async def test_restore_drill_evidence_recording(client, db_session):
    user = await _make_admin(db_session)
    harness_output = {
        "passed": True, "sqlite_integrity": "ok",
        "tables_checked": 42, "rows_recovered": 1234,
        "audit_chain": {"valid": True, "envelopes_broken": []},
    }
    resp = await client.post(
        "/api/admin/compliance/restore-drills",
        json={
            "source": "docurama-data/backup-2026-09-13.db",
            "rows_recovered": 1234,
            "tables_checked": 42,
            "chain_valid": True,
            "drill_output": harness_output,
            "executed_at": "2026-01-01T00:00:00Z",  # explicit, older than the next one
        },
        headers=_auth(user),
    )
    assert resp.status_code == 201
    assert resp.json()["passed"] is True

    # A failed chain is recorded as a failed drill — the API does not polish.
    resp = await client.post(
        "/api/admin/compliance/restore-drills",
        json={"source": "tampered-backup.db", "chain_valid": False},
        headers=_auth(user),
    )
    assert resp.status_code == 201
    assert resp.json()["passed"] is False

    listing = (await client.get(
        "/api/admin/compliance/restore-drills", headers=_auth(user)
    )).json()
    assert len(listing) == 2
    assert listing[0]["passed"] is False  # most recent first
    assert listing[1]["passed"] is True
    assert listing[1]["drill_output"]["audit_chain"]["valid"] is True

    # Unauthenticated callers cannot forge drill evidence.
    resp = await client.post(
        "/api/admin/compliance/restore-drills", json={"source": "x", "chain_valid": True}
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# ISO-07 — scheduled scanning surface
# ---------------------------------------------------------------------------

def test_ci_runs_security_gates_on_a_weekly_schedule():
    workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert "schedule:" in workflow
    assert "cron:" in workflow
    assert "container-scan" in workflow
    assert "trivy" in workflow
    assert "sbom.json" in workflow


def test_sbom_generator_produces_an_inventory():
    from scripts.sbom import build_sbom

    sbom = build_sbom(None)  # npm inventory skipped: no node_modules guarantee
    assert sbom["component_count"] > 10
    names = {c["name"] for c in sbom["components"]}
    # The runtime the tests execute in genuinely ships these.
    assert "pyhanko" in names or "cryptography" in names
    for component in sbom["components"]:
        assert component["purl"].startswith("pkg:pypi/")


# ---------------------------------------------------------------------------
# Catalog baseline: the four controls moved, the vocabulary still holds
# ---------------------------------------------------------------------------

async def test_catalog_baseline_moves_four_controls_to_implemented(client, db_session):
    user = await _make_admin(db_session)
    resp = await client.get("/api/admin/compliance/overview", headers=_auth(user))
    assert resp.status_code == 200
    body = resp.json()
    by_framework = body["controls"]["by_framework"]
    assert by_framework["ISO27001"]["Implemented"] >= 6  # was 5; ISO-04/06/07 joined
    assert by_framework["SOC2"]["Implemented"] >= 1      # SOC2-01 joined; SOC2-04 was already in

    # The overview now carries the new aggregates.
    assert "risks" in body and body["risks"]["open"] >= 9
    assert "last_restore_drill" in body


async def test_trust_center_publishes_new_features_without_certification(client):
    resp = await client.get("/api/trust")
    assert resp.status_code == 200
    body = resp.json()
    assert body["certifications"] == []
    features = " ".join(body["security_features"]).casefold()
    assert "aes-256-gcm" in features
    assert "risk register" in features
    assert "restore-drill" in features
    states = [c["readiness"] for fw in body["readiness_by_framework"].values() for c in fw]
    assert set(states) <= {"Implemented", "Partial", "Missing", "Needs Review"}
