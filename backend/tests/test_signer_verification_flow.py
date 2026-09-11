"""Integration and endpoint tests for signer verification channels and security gating."""
import io
import pytest
from unittest.mock import patch, MagicMock

from app.models import Account, Envelope, Recipient
from app.services.verification_channels.manager import hash_otp_code


@pytest.fixture
async def verified_and_unverified_signers(db_session, tmp_path):
    account = Account(name="Secure Sign Corp", subdomain="secure-sign-corp")
    db_session.add(account)
    await db_session.flush()

    pdf_file = tmp_path / "dummy.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 mock content for signer verification")

    envelope = Envelope(
        account_id=account.id,
        title="Secured Agreement",
        original_pdf_path=str(pdf_file),
    )
    db_session.add(envelope)
    await db_session.flush()

    # Recipient 1: requires email_otp, not yet verified
    signer_unverified = Recipient(
        envelope_id=envelope.id,
        name="Grace Hopper",
        email="grace@navy.mil",
        role="signer",
        verification_channel="email_otp",
        signing_token="token_unverified_grace",
        status="sent",
    )

    # Recipient 2: channel is none (direct access)
    signer_none = Recipient(
        envelope_id=envelope.id,
        name="Alan Turing",
        email="alan@cambridge.ac.uk",
        role="signer",
        verification_channel="none",
        signing_token="token_none_alan",
        status="sent",
    )

    db_session.add_all([signer_unverified, signer_none])
    await db_session.commit()
    return account, envelope, signer_unverified, signer_none


@pytest.mark.asyncio
async def test_signing_session_reports_verification_requirement(client, verified_and_unverified_signers):
    _, _, unverified, none_signer = verified_and_unverified_signers

    # Unverified signer session
    resp1 = await client.get(f"/api/signing/{unverified.signing_token}")
    assert resp1.status_code == 200, resp1.text
    data1 = resp1.json()
    assert data1["requires_verification"] is True
    assert data1["is_verified"] is False
    assert data1["verification_channel"] == "email_otp"
    assert data1["target_obfuscated"] == "g***e@navy.mil"

    # None channel signer session
    resp2 = await client.get(f"/api/signing/{none_signer.signing_token}")
    assert resp2.status_code == 200, resp2.text
    data2 = resp2.json()
    assert data2["requires_verification"] is False
    assert data2["is_verified"] is True


@pytest.mark.asyncio
async def test_unverified_signer_blocked_from_content_and_submission(client, verified_and_unverified_signers):
    _, _, unverified, _ = verified_and_unverified_signers

    # PDF access blocked
    pdf_resp = await client.get(f"/api/signing/{unverified.signing_token}/pdf")
    assert pdf_resp.status_code == 403
    assert "verification required" in pdf_resp.text.lower()

    # Pages list blocked
    pages_resp = await client.get(f"/api/signing/{unverified.signing_token}/pages")
    assert pages_resp.status_code == 403

    # Submission blocked
    submit_resp = await client.post(
        f"/api/signing/{unverified.signing_token}/submit",
        json={"signatures": []}
    )
    assert submit_resp.status_code == 403


@pytest.mark.asyncio
async def test_complete_verification_flow(client, db_session, verified_and_unverified_signers):
    _, envelope, unverified, _ = verified_and_unverified_signers

    with patch("app.services.mailer.send_email") as mock_send:
        mock_res = MagicMock()
        mock_res.sent = True
        mock_res.message_id = "<otp-msg@docurama>"
        mock_send.return_value = mock_res

        # 1. Request verification code
        send_resp = await client.post(f"/api/signing/{unverified.signing_token}/verification/send")
        assert send_resp.status_code == 200, send_resp.text
        send_data = send_resp.json()
        assert send_data["success"] is True
        assert send_data["channel"] == "email_otp"
        assert send_data["target_obfuscated"] == "g***e@navy.mil"

        # 2. Resend within cooldown is rejected
        cooldown_resp = await client.post(f"/api/signing/{unverified.signing_token}/verification/send")
        assert cooldown_resp.status_code == 400
        assert "before requesting another code" in cooldown_resp.text

        # 3. Wrong code rejected
        wrong_resp = await client.post(
            f"/api/signing/{unverified.signing_token}/verification/verify",
            json={"code": "000000"}
        )
        assert wrong_resp.status_code == 400
        assert "Invalid verification code" in wrong_resp.text

        # 4. Set deterministic code for verification
        valid_code = "876543"
        await db_session.refresh(unverified)
        unverified.verification_code_hash = hash_otp_code(valid_code, unverified.signing_token)
        await db_session.commit()

        # 5. Correct code verifies successfully
        verify_resp = await client.post(
            f"/api/signing/{unverified.signing_token}/verification/verify",
            json={"code": valid_code}
        )
        assert verify_resp.status_code == 200, verify_resp.text
        verify_data = verify_resp.json()
        assert verify_data["success"] is True
        assert verify_data["verified"] is True

    # 6. Re-fetching session now shows verified
    session_resp = await client.get(f"/api/signing/{unverified.signing_token}")
    assert session_resp.status_code == 200
    assert session_resp.json()["is_verified"] is True

    # 7. Document PDF access now unlocked
    pdf_resp = await client.get(f"/api/signing/{unverified.signing_token}/pdf")
    assert pdf_resp.status_code == 200


@pytest.mark.asyncio
async def test_envelope_creation_validates_sms_phone(client, db_session):
    from app.core.security import get_password_hash
    from app.models import User, AccountMembership

    account = Account(name="SMS Co")
    db_session.add(account)
    await db_session.flush()

    admin = User(
        account_id=account.id,
        email="smsadmin@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=admin.id, account_id=account.id, role="admin"))
    await db_session.commit()

    await client.post("/api/auth/login", json={"email": "smsadmin@example.com", "password": "a-long-password-1234"})

    # Envelope creation with SMS channel missing phone should fail 400
    pdf_content = b"%PDF-1.4 minimal test pdf"
    files = {"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")}
    data = {
        "title": "SMS Contract",
        "recipients_json": '[{"name":"Signer","email":"s@example.com","verification_channel":"sms_otp"}]',
        "fields_json": "[]",
    }
    resp = await client.post("/api/envelopes", data=data, files=files)
    assert resp.status_code == 400
    assert "Phone number is required" in resp.text

