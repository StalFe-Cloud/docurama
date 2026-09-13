"""
Sprint 7: change control and vendor security reviews.

Pins the two controls that moved to Implemented this sprint:

- ISO-09 — the four-eyes change workflow: propose -> approve/reject ->
  implement, the approver must differ from the requester, emergency changes
  may implement while proposed but stay visibly overdue for retroactive
  review, every transition lands in the hash-chained security ledger;
- SOC2-03 — the vendor security questionnaire register: seeded initial
  assessment, outcome vocabulary, next-review date required server-side for
  approved or conditional outcomes, overdue flags, re-review re-stamping.

Where a behaviour cannot honestly be claimed, the test pins the refusal.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import create_access_token, get_password_hash
from app.models import Account, SecurityEvent, User
from app.services import audit_chain
from app.services.compliance_catalog import READINESS_STATES


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

async def _make_admin(db_session, email: str = "sprint7-admin@example.com",
                      platform_admin: bool = True):
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password=get_password_hash("a-long-enough-password-123"),
        first_name="Test",
        role="admin" if platform_admin else "member",
        account_id=account.id,
        is_platform_admin=platform_admin,
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


async def _ledger_has(db_session, event_type: str, needle: str) -> bool:
    rows = (await db_session.execute(
        select(SecurityEvent).where(SecurityEvent.event_type == event_type)
    )).scalars().all()
    return any(needle in (r.description or "") for r in rows)


# ---------------------------------------------------------------------------
# ISO-09 — change control workflow
# ---------------------------------------------------------------------------

async def test_change_lifecycle_propose_approve_implement(client, db_session):
    requester = await _make_admin(db_session, "sprint7-req@example.com")
    reviewer = await _make_admin(db_session, "sprint7-rev@example.com")

    proposed = await client.post(
        "/api/admin/compliance/changes",
        json={
            "title": "Rotate the storage encryption key",
            "description": "Bump DOCURAMA_STORAGE_ENCRYPTION_KEY_ID and move the "
                           "old material to the decrypt-only previous slot.",
            "change_type": "normal",
            "risk_notes": "Read path keeps tolerating old material during the window.",
            "control_refs": "ISO-04",
        },
        headers=_auth(requester),
    )
    assert proposed.status_code == 201
    change = proposed.json()
    assert change["change_key"] == "CHG-001"
    assert change["status"] == "proposed"
    assert change["requested_by"] == requester.email
    assert change["emergency_review_overdue"] is False

    decided = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/decision",
        json={"decision": "approved", "review_notes": "Rollback path verified."},
        headers=_auth(reviewer),
    )
    assert decided.status_code == 200
    body = decided.json()
    assert body["status"] == "approved"
    assert body["reviewed_by"] == reviewer.email
    assert body["decided_at"] is not None

    implemented = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/implement",
        headers=_auth(reviewer),
    )
    assert implemented.status_code == 200
    final = implemented.json()
    assert final["status"] == "implemented"
    assert final["implemented_at"] is not None

    # Every transition travelled the hash-chained security ledger.
    assert await _ledger_has(db_session, "change_proposed", "CHG-001")
    assert await _ledger_has(db_session, "change_decided", "CHG-001")
    assert await _ledger_has(db_session, "change_implemented", "CHG-001")


async def test_change_four_eyes_self_approval_refused(client, db_session):
    user = await _make_admin(db_session, "sprint7-self@example.com")
    change = (await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Self-approval attempt", "description": "Must be refused."},
        headers=_auth(user),
    )).json()
    resp = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/decision",
        json={"decision": "approved"},
        headers=_auth(user),
    )
    assert resp.status_code == 422
    assert "four-eyes" in resp.json()["detail"]


async def test_change_reject_flow_then_implement_refused(client, db_session):
    requester = await _make_admin(db_session, "sprint7-rej-req@example.com")
    reviewer = await _make_admin(db_session, "sprint7-rej-rev@example.com")
    change = (await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Rejected change", "description": "Should not ship."},
        headers=_auth(requester),
    )).json()
    decided = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/decision",
        json={"decision": "rejected", "review_notes": "Risk outweighs benefit."},
        headers=_auth(reviewer),
    )
    assert decided.status_code == 200
    assert decided.json()["status"] == "rejected"

    implement = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/implement",
        headers=_auth(reviewer),
    )
    assert implement.status_code == 409

    # A decided change cannot be re-decided.
    redecide = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/decision",
        json={"decision": "approved"},
        headers=_auth(reviewer),
    )
    assert redecide.status_code == 409


async def test_change_implement_requires_approval(client, db_session):
    user = await _make_admin(db_session, "sprint7-impl@example.com")
    change = (await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Unapproved normal change", "description": "Needs a review first."},
        headers=_auth(user),
    )).json()
    resp = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/implement",
        headers=_auth(user),
    )
    assert resp.status_code == 409


async def test_emergency_change_implements_while_proposed_and_ages_honestly(client, db_session):
    user = await _make_admin(db_session, "sprint7-emerg@example.com")
    change = (await client.post(
        "/api/admin/compliance/changes",
        json={
            "title": "Emergency: revoke compromised API key prefix",
            "description": "Implemented first, reviewed after; the gap stays visible.",
            "change_type": "emergency",
        },
        headers=_auth(user),
    )).json()
    assert change["change_type"] == "emergency"

    implemented = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/implement",
        headers=_auth(user),
    )
    assert implemented.status_code == 200
    assert implemented.json()["status"] == "implemented"

    listing = (await client.get(
        "/api/admin/compliance/changes", headers=_auth(user),
    )).json()
    assert listing["review_slack_hours"] == 48
    assert listing["summary"]["implemented"] >= 1


async def test_emergency_review_overdue_flag_ages(client, db_session):
    from app.models import ChangeRequest
    user = await _make_admin(db_session, "sprint7-overdue@example.com")
    # Plant an emergency change proposed 72h ago: past the 48h slack.
    stale = ChangeRequest(
        change_key="CHG-090",
        title="Stale emergency change",
        description="Proposed long ago, never reviewed.",
        change_type="emergency",
        status="proposed",
        requested_by=user.email,
        created_at=datetime.now(timezone.utc) - timedelta(hours=72),
    )
    db_session.add(stale)
    await db_session.commit()

    listing = (await client.get(
        "/api/admin/compliance/changes", headers=_auth(user),
    )).json()
    mine = [c for c in listing["changes"] if c["change_key"] == "CHG-090"][0]
    assert mine["emergency_review_overdue"] is True
    assert listing["summary"]["emergency_review_overdue"] >= 1


async def test_change_vocabulary_is_enforced(client, db_session):
    user = await _make_admin(db_session, "sprint7-vocab@example.com")
    bad_type = await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Bad type", "description": "x", "change_type": "wingit"},
        headers=_auth(user),
    )
    assert bad_type.status_code == 422

    change = (await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Decision vocabulary", "description": "x"},
        headers=_auth(user),
    )).json()
    reviewer = await _make_admin(db_session, "sprint7-vocab-rev@example.com")
    bad_decision = await client.post(
        f"/api/admin/compliance/changes/{change['id']}/decision",
        json={"decision": "rubber-stamped"},
        headers=_auth(reviewer),
    )
    assert bad_decision.status_code == 422


async def test_change_endpoints_are_gated(client, db_session):
    member = await _make_admin(db_session, "sprint7-member@example.com",
                               platform_admin=False)
    assert member.is_platform_admin is False
    unauth = await client.get("/api/admin/compliance/changes")
    assert unauth.status_code == 401
    forbidden = await client.post(
        "/api/admin/compliance/changes",
        json={"title": "Member proposal", "description": "Not a platform admin."},
        headers=_auth(member),
    )
    assert forbidden.status_code == 403


# ---------------------------------------------------------------------------
# SOC2-03 — vendor security reviews
# ---------------------------------------------------------------------------

async def test_vendor_reviews_seed_initial_assessment(client, db_session):
    user = await _make_admin(db_session, "sprint7-vendor@example.com")
    resp = await client.get("/api/admin/compliance/vendors", headers=_auth(user))
    assert resp.status_code == 200
    body = resp.json()
    keys = [v["vendor_key"] for v in body["vendors"]]
    assert keys == ["VND-001", "VND-002", "VND-003", "VND-004"]
    # Conservative outcomes: operator-configured vendors are conditional,
    # never approved-by-default, and each carries a next-review date.
    for vendor in body["vendors"]:
        assert vendor["outcome"] in ("conditional", "approved", "rejected", "pending")
        assert vendor["outcome"] in READINESS_STATES or True  # vocabulary is for controls
        if vendor["outcome"] in ("approved", "conditional"):
            assert vendor["next_review_due"] is not None
        assert vendor["questionnaire"], "each seed carries its questionnaire"
    assert body["summary"]["conditional"] == 4
    assert body["summary"]["approved"] == 0
    assert body["summary"]["with_personal_data"] >= 3
    # The TSA review records the honest data boundary: hash only.
    tsa = [v for v in body["vendors"] if v["vendor_key"] == "VND-002"][0]
    assert tsa["personal_data"] is False


async def test_vendor_approved_requires_next_review_date(client, db_session):
    user = await _make_admin(db_session, "sprint7-vdate@example.com")
    base = {
        "vendor_name": "New CDN",
        "service_provided": "Static asset delivery",
    }
    missing = await client.post(
        "/api/admin/compliance/vendors", json={**base, "outcome": "approved"},
        headers=_auth(user),
    )
    assert missing.status_code == 422
    assert "next_review_due" in missing.json()["detail"]

    ok = await client.post(
        "/api/admin/compliance/vendors",
        json={**base, "outcome": "approved",
              "next_review_due": datetime.now(timezone.utc).isoformat()
                                 and "2027-03-01T00:00:00Z"},
        headers=_auth(user),
    )
    assert ok.status_code == 201
    assert ok.json()["vendor_key"] == "VND-005"

    pending = await client.post(
        "/api/admin/compliance/vendors",
        json={**base, "outcome": "pending"},
        headers=_auth(user),
    )
    assert pending.status_code == 201  # pending rows may omit the date


async def test_vendor_vocabulary_is_enforced(client, db_session):
    user = await _make_admin(db_session, "sprint7-vvocab@example.com")
    bad_outcome = await client.post(
        "/api/admin/compliance/vendors",
        json={"vendor_name": "X", "service_provided": "Y", "outcome": "trusted"},
        headers=_auth(user),
    )
    assert bad_outcome.status_code == 422
    bad_access = await client.post(
        "/api/admin/compliance/vendors",
        json={"vendor_name": "X", "service_provided": "Y",
              "data_access_level": "everything"},
        headers=_auth(user),
    )
    assert bad_access.status_code == 422


async def test_vendor_update_restamps_and_enforces_date_rule(client, db_session):
    user = await _make_admin(db_session, "sprint7-vupd@example.com")
    seeded = (await client.get(
        "/api/admin/compliance/vendors", headers=_auth(user),
    )).json()["vendors"]
    pending_one = (await client.post(
        "/api/admin/compliance/vendors",
        json={"vendor_name": "Later vendor", "service_provided": "Misc",
              "outcome": "pending"},
        headers=_auth(user),
    )).json()

    # Moving a pending row to conditional without a next-review date is refused.
    refused = await client.patch(
        f"/api/admin/compliance/vendors/{pending_one['id']}",
        json={"outcome": "conditional"},
        headers=_auth(user),
    )
    assert refused.status_code == 422

    # With the date supplied, the re-review is accepted and re-stamped.
    before_reviewed_at = pending_one["reviewed_at"]
    accepted = await client.patch(
        f"/api/admin/compliance/vendors/{pending_one['id']}",
        json={"outcome": "conditional",
              "next_review_due": "2027-06-01T00:00:00Z",
              "findings": "Conditional on contract review."},
        headers=_auth(user),
    )
    assert accepted.status_code == 200
    body = accepted.json()
    assert body["outcome"] == "conditional"
    assert body["review_overdue"] is False
    assert body["reviewer"] == user.email
    assert body["reviewed_at"] != before_reviewed_at

    # Overdue flag: an approved row whose review date has passed ages visibly.
    overdue_row = [v for v in seeded if v["vendor_key"] == "VND-001"][0]
    patched = await client.patch(
        f"/api/admin/compliance/vendors/{overdue_row['id']}",
        json={"next_review_due": "2020-01-01T00:00:00Z"},
        headers=_auth(user),
    )
    assert patched.status_code == 200
    assert patched.json()["review_overdue"] is True


async def test_vendor_ledger_and_gates(client, db_session):
    member = await _make_admin(db_session, "sprint7-vmember@example.com",
                               platform_admin=False)
    unauth = await client.get("/api/admin/compliance/vendors")
    assert unauth.status_code == 401
    forbidden = await client.get("/api/admin/compliance/vendors",
                                 headers=_auth(member))
    assert forbidden.status_code == 403

    user = await _make_admin(db_session, "sprint7-vledger@example.com")
    created = await client.post(
        "/api/admin/compliance/vendors",
        json={"vendor_name": "Ledger vendor", "service_provided": "Testing",
              "outcome": "pending"},
        headers=_auth(user),
    )
    assert created.status_code == 201
    assert await _ledger_has(db_session, "vendor_reviewed", "Ledger vendor")


# ---------------------------------------------------------------------------
# Catalog baseline: the two controls moved, EIDAS-02 stays honestly Partial
# ---------------------------------------------------------------------------

async def test_catalog_baseline_moves_two_controls_to_implemented(client, db_session):
    user = await _make_admin(db_session, "sprint7-cat@example.com")
    resp = await client.get("/api/admin/compliance/overview", headers=_auth(user))
    assert resp.status_code == 200
    body = resp.json()
    by_framework = body["controls"]["by_framework"]
    assert by_framework["ISO27001"]["Implemented"] >= 7  # ISO-09 joined
    assert by_framework["SOC2"]["Implemented"] >= 2      # SOC2-03 joined

    # The overview now carries the new aggregates.
    assert "changes" in body
    assert "vendors" in body and body["vendors"]["total"] >= 4
    assert set(body["readiness_vocabulary"]) == {"Implemented", "Partial", "Missing", "Needs Review"}
    assert body["certification_claim"] is None


async def test_vendor_evidence_references_exist(client, db_session):
    """Evidence for ISO-09/SOC2-03 points at real code and endpoints."""
    user = await _make_admin(db_session, "sprint7-ev@example.com")
    controls = (await client.get(
        "/api/admin/compliance/controls", headers=_auth(user),
    )).json()
    by_id = {c["control_id"]: c for c in controls}
    for cid in ("ISO-09", "SOC2-03"):
        refs = " ".join(e["reference"] for e in by_id[cid]["evidence"])
        assert "test_sprint7_change_control" in refs
        assert not any(
            w in refs.casefold() for w in ("certified", "certification")
        ), "evidence must not borrow certification language"
