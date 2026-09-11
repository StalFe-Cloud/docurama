"""Manager, registry, and lifecycle for signer verification channels."""
import hashlib
import hmac
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Recipient, Envelope, AuditEvent
from app.services.verification_channels.base import (
    VerificationChannel,
    obfuscate_target,
)
from app.services.verification_channels.email_channel import EmailVerificationChannel
from app.services.verification_channels.sms_channel import SmsVerificationChannel
from app.services.verification_channels.whatsapp_channel import WhatsAppVerificationChannel
from app.services.verification_channels.telegram_channel import TelegramVerificationChannel


OTP_TTL_MINUTES = 10
RESEND_COOLDOWN_SECONDS = 30
MAX_VERIFICATION_ATTEMPTS = 5

_CHANNELS: Dict[str, VerificationChannel] = {
    "email_otp": EmailVerificationChannel(),
    "sms_otp": SmsVerificationChannel(),
    "whatsapp_otp": WhatsAppVerificationChannel(),
    "telegram_otp": TelegramVerificationChannel(),
}


def get_channel(channel_name: str) -> Optional[VerificationChannel]:
    """Retrieve the verification channel handler by name."""
    return _CHANNELS.get(channel_name)


def generate_otp_code() -> str:
    """Generate a 6-digit cryptographically secure numerical passcode."""
    return f"{secrets.randbelow(900000) + 100000:06d}"


def hash_otp_code(code: str, salt: str) -> str:
    """Hash an OTP code with a salt using SHA-256."""
    payload = f"{salt}:{code.strip()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def get_recipient_target(recipient: Recipient) -> str:
    """Determine the contact target based on the recipient's verification channel."""
    channel = recipient.verification_channel or "none"
    if channel == "email_otp":
        return recipient.email
    if channel in ("sms_otp", "whatsapp_otp"):
        return recipient.phone or ""
    if channel == "telegram_otp":
        return recipient.phone or recipient.email or ""
    return recipient.email


async def send_recipient_otp(
    recipient: Recipient,
    envelope: Envelope,
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Generate and dispatch a one-time verification passcode to the recipient.
    Enforces cooldown and updates expiration state.
    """
    channel_name = recipient.verification_channel or "none"
    if channel_name == "none":
        return {
            "success": True,
            "channel": "none",
            "target_obfuscated": "",
            "message": "No verification required for this recipient.",
        }

    channel = get_channel(channel_name)
    if not channel:
        return {
            "success": False,
            "channel": channel_name,
            "target_obfuscated": "",
            "error": f"Unsupported verification channel '{channel_name}'.",
        }

    now = datetime.now(timezone.utc)

    # Enforce 30-second resend cooldown
    if recipient.verification_code_expires_at is not None:
        remaining_seconds = (recipient.verification_code_expires_at - now).total_seconds()
        elapsed_seconds = (OTP_TTL_MINUTES * 60) - remaining_seconds
        if 0 <= elapsed_seconds < RESEND_COOLDOWN_SECONDS:
            wait_time = int(RESEND_COOLDOWN_SECONDS - elapsed_seconds)
            target = get_recipient_target(recipient)
            return {
                "success": False,
                "channel": channel_name,
                "target_obfuscated": obfuscate_target(channel_name, target),
                "error": f"Please wait {wait_time} second(s) before requesting another code.",
            }

    target = get_recipient_target(recipient)
    if not target:
        contact_type = "phone number" if channel_name in ("sms_otp", "whatsapp_otp") else "email"
        return {
            "success": False,
            "channel": channel_name,
            "target_obfuscated": "",
            "error": f"Recipient {contact_type} is not configured.",
        }

    otp_code = generate_otp_code()
    salt = recipient.signing_token or str(recipient.id)
    code_hash = hash_otp_code(otp_code, salt)

    send_result = await channel.send_code(
        target=target,
        code=otp_code,
        envelope_title=envelope.title,
        recipient_name=recipient.name,
        account_id=envelope.account_id,
        db=db,
    )

    if not send_result.success:
        return {
            "success": False,
            "channel": channel_name,
            "target_obfuscated": send_result.target_obfuscated,
            "error": send_result.error or "Failed to deliver verification code.",
        }

    recipient.verification_code_hash = code_hash
    recipient.verification_code_expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)
    recipient.verification_attempts = 0
    await db.commit()

    return {
        "success": True,
        "channel": channel_name,
        "target_obfuscated": send_result.target_obfuscated,
        "message": f"Verification code sent via {channel_name.replace('_', ' ').title()}.",
    }


async def verify_recipient_otp(
    recipient: Recipient,
    submitted_code: str,
    request_ip: Optional[str],
    user_agent: Optional[str],
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Verify a submitted one-time passcode against the stored hash.
    Enforces maximum attempts and records an evidentiary audit event on success.
    """
    if recipient.verified_at is not None:
        return {
            "success": True,
            "verified": True,
            "message": "Signer identity already verified.",
        }

    channel_name = recipient.verification_channel or "none"
    if channel_name == "none":
        return {
            "success": True,
            "verified": True,
            "message": "No verification required.",
        }

    now = datetime.now(timezone.utc)

    if not recipient.verification_code_hash or not recipient.verification_code_expires_at:
        return {
            "success": False,
            "verified": False,
            "error": "No verification code has been requested. Please request a code first.",
        }

    expires_at = recipient.verification_code_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if now > expires_at:
        return {
            "success": False,
            "verified": False,
            "error": "Verification code has expired. Please request a new one.",
        }

    recipient.verification_attempts = (recipient.verification_attempts or 0) + 1

    if recipient.verification_attempts > MAX_VERIFICATION_ATTEMPTS:
        recipient.verification_code_hash = None
        recipient.verification_code_expires_at = None
        await db.commit()
        return {
            "success": False,
            "verified": False,
            "error": "Too many invalid attempts. The code has been revoked. Please request a fresh code.",
        }

    salt = recipient.signing_token or str(recipient.id)
    expected_hash = hash_otp_code(submitted_code, salt)

    if not hmac.compare_digest(recipient.verification_code_hash, expected_hash):
        await db.commit()
        attempts_left = max(0, MAX_VERIFICATION_ATTEMPTS - recipient.verification_attempts)
        return {
            "success": False,
            "verified": False,
            "error": f"Invalid verification code. {attempts_left} attempt(s) remaining.",
        }

    # Code matches! Mark verified and record evidentiary audit event
    recipient.verified_at = now
    recipient.verification_code_hash = None
    recipient.verification_code_expires_at = None

    target = get_recipient_target(recipient)
    obfuscated_target = obfuscate_target(channel_name, target)

    audit = AuditEvent(
        envelope_id=recipient.envelope_id,
        event_type="signer_verified",
        actor_name=recipient.name,
        actor_email=recipient.email,
        ip_address=request_ip or "127.0.0.1",
        user_agent=user_agent or "Browser",
        description=(
            f"Signer completed 2FA identity challenge via "
            f"{channel_name.replace('_', ' ').title()} ({obfuscated_target})."
        ),
    )
    db.add(audit)
    await db.commit()

    return {
        "success": True,
        "verified": True,
        "message": "Identity verified successfully.",
    }
