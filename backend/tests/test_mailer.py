"""
Email delivery tests.

The defect these cover: the platform wrote audit events stating that invitations and
reminders had been sent while no mail code existed. Those events reach the evidentiary
certificate, so the invariant is that a "sent" claim requires a confirmed delivery.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services import mailer
from app.services.reminder_sweeper import _is_due


# ---------------------------------------------------------------------------
# Send results
# ---------------------------------------------------------------------------

def _usable_profile(**overrides):
    """A resolved mail profile, of the shape services/smtp_config produces."""
    from app.services.smtp_config import SmtpConfig

    defaults = dict(
        host="smtp.example.com", port=587, username="", password="",
        from_email="no-reply@example.com", from_name="Docurama",
        use_tls=True, use_ssl=False, timeout=20, source="account",
    )
    defaults.update(overrides)
    return SmtpConfig(**defaults)


def test_unconfigured_smtp_reports_not_sent():
    """With no profile the mailer must report failure, not silently succeed."""
    result = mailer.send_email(None, "signer@example.com", "Signer", "s", "<p>h</p>", "t")

    assert result.sent is False
    assert "No mail server is configured" in result.error
    assert result.message_id is None


def test_malformed_address_is_rejected_without_sending():
    config = _usable_profile()

    for bad in ["", "   ", "not-an-email", "missing@domain", "@example.com"]:
        result = mailer.send_email(config, bad, "Nobody", "s", "<p>h</p>", "t")
        assert result.sent is False
        assert result.message_id is None


def test_send_failure_is_captured_not_raised(monkeypatch):
    """A dead mail server must not propagate an exception into the request path."""
    def boom(config):
        raise ConnectionRefusedError("connection refused")

    monkeypatch.setattr(mailer, "_connect", boom)

    result = mailer.send_email(
        _usable_profile(), "signer@example.com", "Signer", "s", "<p>h</p>", "t"
    )

    assert result.sent is False
    assert "ConnectionRefusedError" in result.error


def test_successful_send_reports_message_id(monkeypatch):
    sent_messages = []

    class FakeServer:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def send_message(self, msg):
            sent_messages.append(msg)

    monkeypatch.setattr(mailer, "_connect", lambda config: FakeServer())

    result = mailer.send_email(
        _usable_profile(), "signer@example.com", "Signer", "Subject", "<p>h</p>", "t"
    )

    assert result.sent is True
    assert result.message_id
    assert len(sent_messages) == 1
    assert sent_messages[0]["Subject"] == "Subject"


# ---------------------------------------------------------------------------
# Batch semantics: what the audit trail is allowed to claim
# ---------------------------------------------------------------------------

def test_batch_with_no_delivery_is_not_reported_as_sent():
    batch = mailer.BatchResult(results=[
        mailer.SendResult("a@example.com", False, error="connection refused"),
        mailer.SendResult("b@example.com", False, error="connection refused"),
    ])

    assert batch.any_sent is False
    assert batch.all_sent is False
    assert batch.sent_count == 0
    assert "failed" in batch.summary().lower()


def test_partial_delivery_is_described_as_partial():
    batch = mailer.BatchResult(results=[
        mailer.SendResult("a@example.com", True, message_id="<1@x>"),
        mailer.SendResult("b@example.com", False, error="mailbox full"),
    ])

    assert batch.any_sent is True
    assert batch.all_sent is False
    assert batch.summary() == "Delivered to 1 of 2 recipient(s)."


def test_full_delivery_is_described_as_complete():
    batch = mailer.BatchResult(results=[
        mailer.SendResult("a@example.com", True, message_id="<1@x>"),
        mailer.SendResult("b@example.com", True, message_id="<2@x>"),
    ])

    assert batch.all_sent is True
    assert batch.summary() == "Delivered to 2 recipient(s)."


def test_empty_batch_claims_nothing():
    batch = mailer.BatchResult()
    assert batch.any_sent is False
    assert batch.all_sent is False
    assert batch.summary() == "No recipients to notify."


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def test_completion_notice_does_not_claim_a_seal_that_was_not_applied():
    _subject, html, text = mailer.completion_notice(
        "Signer", "Master Services Agreement", "https://example.com/verify?code=X", sealed=False
    )

    assert "not applied" in html
    assert "not applied" in text
    assert "sealed and timestamped" not in text


def test_completion_notice_states_the_seal_when_applied():
    _subject, html, text = mailer.completion_notice(
        "Signer", "Master Services Agreement", "https://example.com/verify?code=X", sealed=True
    )

    assert "sealed and timestamped" in html
    assert "sealed and timestamped" in text


def test_invitation_carries_the_personal_signing_link():
    subject, html, text = mailer.signing_invitation(
        "Signer", "NDA", "https://example.com/s/tok123", "Sender"
    )

    assert "NDA" in subject
    assert "https://example.com/s/tok123" in html
    assert "https://example.com/s/tok123" in text


# ---------------------------------------------------------------------------
# Automatic reminder scheduling
# ---------------------------------------------------------------------------

class FakeRecipient:
    def __init__(self, sent_count, last_reminded_at=None, created_at=None):
        self.reminders_sent_count = sent_count
        self.last_reminded_at = last_reminded_at
        self.created_at = created_at


def test_reminder_not_due_before_the_interval_elapses():
    now = datetime.now(timezone.utc)
    r = FakeRecipient(0, created_at=now - timedelta(days=1))

    assert _is_due(r, now, interval_days=3, max_reminders=3) is False


def test_reminder_due_once_the_interval_elapses():
    now = datetime.now(timezone.utc)
    r = FakeRecipient(0, created_at=now - timedelta(days=4))

    assert _is_due(r, now, interval_days=3, max_reminders=3) is True


def test_reminder_budget_is_respected():
    now = datetime.now(timezone.utc)
    r = FakeRecipient(3, last_reminded_at=now - timedelta(days=30))

    assert _is_due(r, now, interval_days=3, max_reminders=3) is False


def test_reminder_interval_measured_from_last_delivery():
    now = datetime.now(timezone.utc)
    r = FakeRecipient(1, last_reminded_at=now - timedelta(days=1), created_at=now - timedelta(days=90))

    # The stale created_at must not make an already-reminded recipient due again.
    assert _is_due(r, now, interval_days=3, max_reminders=3) is False


def test_naive_timestamps_are_treated_as_utc():
    """Rows written before timezone awareness must not crash the sweep."""
    now = datetime.now(timezone.utc)
    naive = (now - timedelta(days=10)).replace(tzinfo=None)
    r = FakeRecipient(0, created_at=naive)

    assert _is_due(r, now, interval_days=3, max_reminders=3) is True


def test_recipient_without_any_anchor_is_not_due():
    now = datetime.now(timezone.utc)
    r = FakeRecipient(0)

    assert _is_due(r, now, interval_days=3, max_reminders=3) is False


def test_sweep_skips_accounts_without_a_mail_server():
    """
    The sweep resolves a profile per account, so one company lacking a mail server must
    not stop another's reminders. Mirrors the guard in sweep_once, which needs a database
    to exercise directly.
    """
    from app.services import reminder_sweeper

    assert reminder_sweeper.mailer.is_configured(None) is False
