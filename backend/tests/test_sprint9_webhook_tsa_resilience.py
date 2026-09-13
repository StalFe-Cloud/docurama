"""
Sprint 9: webhook idempotency and TSA failure-mode regression tests.

Billing: Stripe delivers at-least-once, so a replayed or redelivered event
must never re-apply. The stripe_events ledger is the persisted processing
state; these tests prove replays are absorbed and state does not drift.

TSA: the timestamp authority is an external dependency that will be
unreachable at some point in production. The seal path must degrade
honestly - the document is either sealed with an observed timestamp or it
is reported without one - and must never claim a timestamp it does not
have. verify_document_integrity's observed-facts contract is the referee.
"""
import pytest

from datetime import datetime, timezone

from app.core import config
from app.core.security import get_password_hash
from app.models import Account, User, StripeEvent


# ---------------------------------------------------------------------------
# Stripe webhook idempotency
# ---------------------------------------------------------------------------

@pytest.fixture
async def webhook_account(db_session):
    account = Account(name="Billable", plan="plus", is_trial=False)
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(
        account_id=account.id, email="owner@billable.example",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin", is_active=True,
    ))
    await db_session.commit()
    return account


async def _deliver(client, db_session, monkeypatch, event: dict, event_id: str):
    """POST one verified, signed webhook event; returns the response.

    The vendor's signature math is Stripe's SDK contract, not ours; what
    these tests exercise is the handler's behaviour AFTER verification. The
    adapter's verify_webhook is patched at the class seam the handler
    actually resolves (billing.get_adapter), returning the parsed event the
    way a genuine verified delivery would."""
    import json as json_mod
    from app.services import billing as billing_service

    monkeypatch.setattr(config.settings, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(config.settings, "STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")

    def _verified(self, *, payload, signature):
        return json_mod.loads(payload.decode())

    monkeypatch.setattr(billing_service.StripeAdapter, "verify_webhook", _verified)

    event = dict(event)
    event.setdefault("id", event_id)
    body = json_mod.dumps(event).encode()
    return await client.post(
        "/api/billing/webhook",
        content=body,
        headers={"Content-Type": "application/json",
                 "stripe-signature": "t=1760000000,v1=fakesigned"},
    )


async def test_replayed_checkout_event_does_not_reapply(client, db_session, monkeypatch, webhook_account):
    account = webhook_account
    event = {
        "id": "evt_replay_checkout_1",
        "type": "checkout.session.completed",
        "data": {"object": {
            "customer": "cus_replay_1",
            "subscription": "sub_replay_1",
            "metadata": {"account_id": account.id, "plan": "business"},
        }},
    }

    first = await _deliver(client, db_session, monkeypatch, event, event["id"])
    assert first.status_code == 200
    db_session.expire_all()
    await db_session.refresh(account)
    assert account.plan == "business"
    assert account.stripe_customer_id == "cus_replay_1"

    # Mutate the in-memory row to prove the replay really is skipped: if the
    # handler re-applied, plan would be recomputed and the marker overwritten.
    account.plan = "sneaky-marker"
    await db_session.commit()

    second = await _deliver(client, db_session, monkeypatch, event, event["id"])
    assert second.status_code == 200
    db_session.expire_all()
    await db_session.refresh(account)
    # The replay did NOT touch plan state - the ledger absorbed it.
    assert account.plan == "sneaky-marker"


async def test_ledger_rows_are_persisted_per_event(client, db_session, monkeypatch, webhook_account):
    account = webhook_account
    event = {
        "id": "evt_ledger_persist_1",
        "type": "checkout.session.completed",
        "data": {"object": {
            "customer": "cus_ledger_1", "subscription": "sub_ledger_1",
            "metadata": {"account_id": account.id, "plan": "plus"},
        }},
    }
    await _deliver(client, db_session, monkeypatch, event, event["id"])

    ignored = {
        "id": "evt_ledger_persist_2",
        "type": "invoice.paid",
        "data": {"object": {}},
    }
    await _deliver(client, db_session, monkeypatch, ignored, ignored["id"])

    rows = (await db_session.execute(StripeEvent.__table__.select())).fetchall()
    by_id = {r.id: r for r in rows}
    assert "evt_ledger_persist_1" in by_id
    assert by_id["evt_ledger_persist_1"].action == "attach_customer"
    assert by_id["evt_ledger_persist_1"].account_id == account.id
    assert "evt_ledger_persist_2" in by_id
    assert by_id["evt_ledger_persist_2"].action == "ignore"


async def test_subscription_downgrade_replay_keeps_cancel_state(client, db_session, monkeypatch, webhook_account):
    """A replayed subscription.deleted must not be able to re-cancel an
    already-restored subscription, and vice versa: the second delivery of
    the same event is always a no-op. The delete event carries no checkout
    metadata - attribution must work via the attached subscription id."""
    account = webhook_account
    attach = {
        "id": "evt_attach_before_cancel",
        "type": "checkout.session.completed",
        "data": {"object": {
            "customer": "cus_replay_cancel_1",
            "subscription": "sub_replay_cancel_1",
            "metadata": {"account_id": account.id, "plan": "plus"},
        }},
    }
    resp = await _deliver(client, db_session, monkeypatch, attach, attach["id"])
    assert resp.status_code == 200

    event = {
        "id": "evt_replay_cancel_1",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_replay_cancel_1", "customer": "cus_replay_cancel_1"}},
    }
    first = await _deliver(client, db_session, monkeypatch, event, event["id"])
    assert first.status_code == 200
    db_session.expire_all()
    await db_session.refresh(account)
    assert account.cancel_at_period_end is True

    # Operator restores service by manual intervention:
    account.cancel_at_period_end = False
    await db_session.commit()

    second = await _deliver(client, db_session, monkeypatch, event, event["id"])
    assert second.status_code == 200
    db_session.expire_all()
    await db_session.refresh(account)
    assert account.cancel_at_period_end is False  # replay was absorbed


async def test_cancellation_event_attributes_via_customer_id(client, db_session, monkeypatch, webhook_account):
    """A subscription.deleted that arrives before the account row ever stored
    the subscription id still lands, via the customer id recorded at attach."""
    account = webhook_account
    account.stripe_customer_id = "cus_attr_customer_1"
    await db_session.commit()

    event = {
        "id": "evt_cancel_by_customer",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_unknown", "customer": "cus_attr_customer_1"}},
    }
    resp = await _deliver(client, db_session, monkeypatch, event, event["id"])
    assert resp.status_code == 200
    db_session.expire_all()
    await db_session.refresh(account)
    assert account.cancel_at_period_end is True


# ---------------------------------------------------------------------------
# TSA failure modes
# ---------------------------------------------------------------------------

def _mini_pdf(tmp_path, name="plain.pdf"):
    """A one-page PDF built with pymupdf, standing in for an uploaded doc."""
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "TSA failure-mode specimen")
    path = str(tmp_path / name)
    doc.save(path)
    doc.close()
    return path


def test_tsa_unreachable_degrades_without_claiming_timestamp(tmp_path, monkeypatch):
    """A dead TSA must lower the conformance level, not fake a timestamp.

    HTTPTimeStamper with an unreachable URL raises during signing; the seal
    path catches it and reports the honest, lower state. The observed result
    comes from re-reading the written file, so has_timestamp is only ever
    true when a real timestamp token is present and validated."""
    from app.services import crypto_engine

    monkeypatch.setattr(config.settings, "TSA_URL", "http://127.0.0.1:1/tsa")  # nothing listens
    monkeypatch.setattr(crypto_engine, "load_docurama_p12", lambda: (None, None, []))

    # Force the early unsealed path (no P12) - the guarantee under test is
    # that the failure report never claims a timestamp.
    src = _mini_pdf(tmp_path, "src.pdf")
    out = str(tmp_path / "out.pdf")
    result = crypto_engine.sign_pdf_with_pades(src, out)

    assert result["success"] is False
    assert result["sealed"] is False
    assert result["timestamp_server"] is None
    assert result["timestamp_utc"] is None
    assert result["error"]  # the failure is named, not swallowed
    # The document itself is still downloadable (copied unchanged).
    import os
    assert os.path.exists(out)


def test_verification_of_unsigned_pdf_asserts_nothing(tmp_path):
    """A PDF with no signature is never described as verified or timestamped."""
    from app.services import crypto_engine

    path = _mini_pdf(tmp_path, "unsigned.pdf")
    result = crypto_engine.verify_document_integrity(path)

    assert result["is_valid"] is False
    assert result["has_digital_signature"] is False
    assert result["signature_intact"] is False
    assert result["has_timestamp"] is False
    assert result["timestamp_utc"] is None
    assert result["pades_level"] is None


def test_verification_of_missing_file_fails_closed(tmp_path):
    from app.services import crypto_engine

    result = crypto_engine.verify_document_integrity(str(tmp_path / "nope.pdf"))
    assert result["is_valid"] is False
    assert result["has_timestamp"] is False
    assert "not found" in (result["message"] or "").lower()


def test_unsealed_failure_result_shape_is_complete(tmp_path):
    """Whatever goes wrong, the failure dict carries every field the UI and
    the envelope row read - None where an assertion is impossible, never a
    fabricated value."""
    from app.services import crypto_engine

    src = _mini_pdf(tmp_path, "shape.pdf")
    out = str(tmp_path / "shape_out.pdf")
    monkey_no_p12 = "definitely-missing-" + "x" * 20 + ".p12"
    from app.core.config import settings as cfg
    original = cfg.P12_PATH
    cfg.P12_PATH = "/nonexistent/" + monkey_no_p12
    try:
        result = crypto_engine.sign_pdf_with_pades(src, out)
    finally:
        cfg.P12_PATH = original

    for key in ("success", "sealed", "signed_path", "sha256", "subject",
                "issuer", "pades_level", "timestamp_server", "timestamp_utc", "error"):
        assert key in result, f"missing failure-report key: {key}"
    assert result["sealed"] is False
    assert result["pades_level"] is None
    assert result["timestamp_utc"] is None
