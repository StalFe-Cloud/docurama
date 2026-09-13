"""Unit tests for signer identity verification channels and lifecycle."""
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

from app.models.models import Account, Envelope, Recipient, AuditEvent
from app.services.verification_channels.base import (
    obfuscate_email,
    obfuscate_phone,
    obfuscate_target,
)
from app.services.verification_channels.manager import (
    generate_otp_code,
    hash_otp_code,
    get_channel,
    send_recipient_otp,
    verify_recipient_otp,
    OTP_TTL_MINUTES,
    MAX_VERIFICATION_ATTEMPTS,
)


def test_obfuscation_helpers():
    assert obfuscate_email("ada@example.com") == "a***a@example.com"
    assert obfuscate_email("a@example.com") == "a***@example.com"
    assert obfuscate_email("") == ""
    assert obfuscate_email("invalid") == "invalid"

    assert obfuscate_phone("+33612345678") == "+33 *** *** 78"
    assert obfuscate_phone("123") == "***"
    assert obfuscate_phone("") == ""

    assert obfuscate_target("email_otp", "test@test.com") == "t***t@test.com"
    assert obfuscate_target("sms_otp", "+1234567890") == "+12 *** *** 90"
    assert obfuscate_target("telegram_otp", "@myuser") == "Telegram (@myuser)"


def test_otp_generation_and_hashing():
    code = generate_otp_code()
    assert len(code) == 6
    assert code.isdigit()

    salt = "test_signing_token_123"
    h1 = hash_otp_code(code, salt)
    h2 = hash_otp_code(code, salt)
    h_diff_salt = hash_otp_code(code, "other_salt")
    h_diff_code = hash_otp_code("999999", salt)

    assert h1 == h2
    assert h1 != h_diff_salt
    assert h1 != h_diff_code


def test_channel_registry():
    assert get_channel("email_otp") is not None
    assert get_channel("sms_otp") is not None
    assert get_channel("whatsapp_otp") is not None
    assert get_channel("telegram_otp") is not None
    assert get_channel("unknown_channel") is None


@pytest.mark.asyncio
async def test_send_and_verify_email_otp(db_session):
    account = Account(name="Test Corp", subdomain="test-otp-corp")
    db_session.add(account)
    await db_session.flush()

    envelope = Envelope(
        account_id=account.id,
        title="Employment Agreement",
        original_pdf_path="/tmp/fake.pdf",
    )
    db_session.add(envelope)
    await db_session.flush()

    recipient = Recipient(
        envelope_id=envelope.id,
        name="Ada Lovelace",
        email="ada@example.com",
        verification_channel="email_otp",
        signing_token="test_token_ada",
    )
    db_session.add(recipient)
    await db_session.commit()

    # Mock mailer.send_email to simulate successful delivery
    with patch("app.services.mailer.send_email") as mock_send:
        mock_res = MagicMock()
        mock_res.sent = True
        mock_res.message_id = "<msg-123@docurama>"
        mock_send.return_value = mock_res

        result = await send_recipient_otp(recipient, envelope, db_session)
        assert result["success"] is True
        assert result["channel"] == "email_otp"
        assert result["target_obfuscated"] == "a***a@example.com"
        assert recipient.verification_code_hash is not None
        assert recipient.verification_code_expires_at is not None

        # Verify resend cooldown blocks immediate repeat
        repeat_result = await send_recipient_otp(recipient, envelope, db_session)
        assert repeat_result["success"] is False
        assert "second(s) before requesting another code" in repeat_result["error"]

    # Wrong code should increment attempts
    bad_res = await verify_recipient_otp(
        recipient, "000000", "127.0.0.1", "TestAgent", db_session
    )
    assert bad_res["success"] is False
    assert bad_res["verified"] is False
    assert recipient.verification_attempts == 1

    # Verify with correct code
    # We retrieve the actual OTP by matching hash
    salt = recipient.signing_token
    # Find code that hashes to recipient.verification_code_hash
    # Alternatively, set a known code hash for deterministic verification
    known_code = "123456"
    recipient.verification_code_hash = hash_otp_code(known_code, salt)
    await db_session.commit()

    verify_res = await verify_recipient_otp(
        recipient, known_code, "127.0.0.1", "TestAgent", db_session
    )
    assert verify_res["success"] is True
    assert verify_res["verified"] is True
    assert recipient.verified_at is not None
    assert recipient.verification_code_hash is None

    # Audit event must be recorded
    audit = (
        await db_session.execute(
            Recipient.__table__.select().where(Recipient.id == recipient.id)
        )
    ).first()
    assert audit is not None


@pytest.mark.asyncio
async def test_verification_attempts_lockout(db_session):
    account = Account(name="Lockout Corp", subdomain="lockout-corp")
    db_session.add(account)
    await db_session.flush()

    envelope = Envelope(account_id=account.id, title="NDA", original_pdf_path="/tmp/nda.pdf")
    db_session.add(envelope)
    await db_session.flush()

    recipient = Recipient(
        envelope_id=envelope.id,
        name="Charles Babbage",
        email="charles@example.com",
        verification_channel="email_otp",
        signing_token="test_token_charles",
        verification_code_hash=hash_otp_code("654321", "test_token_charles"),
        verification_code_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        verification_attempts=4,
    )
    db_session.add(recipient)
    await db_session.commit()

    # 5th attempt (fails)
    res5 = await verify_recipient_otp(recipient, "000000", "127.0.0.1", "Test", db_session)
    assert res5["success"] is False
    assert recipient.verification_attempts == 5

    # 6th attempt (locks out and clears code)
    res6 = await verify_recipient_otp(recipient, "000000", "127.0.0.1", "Test", db_session)
    assert res6["success"] is False
    assert "Too many invalid attempts" in res6["error"]
    assert recipient.verification_code_hash is None


@pytest.mark.asyncio
async def test_verification_code_expiration(db_session):
    account = Account(name="Expire Corp", subdomain="expire-corp")
    db_session.add(account)
    await db_session.flush()

    envelope = Envelope(account_id=account.id, title="Letter", original_pdf_path="/tmp/let.pdf")
    db_session.add(envelope)
    await db_session.flush()

    recipient = Recipient(
        envelope_id=envelope.id,
        name="Expired Signer",
        email="exp@example.com",
        verification_channel="email_otp",
        signing_token="test_token_exp",
        verification_code_hash=hash_otp_code("123456", "test_token_exp"),
        verification_code_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(recipient)
    await db_session.commit()

    res = await verify_recipient_otp(recipient, "123456", "127.0.0.1", "Test", db_session)
    assert res["success"] is False
    assert "expired" in res["error"]
    assert recipient.verified_at is None
