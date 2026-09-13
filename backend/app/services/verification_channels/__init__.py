"""Signer verification channels package."""
from app.services.verification_channels.base import (
    VerificationChannel,
    ChannelSendResult,
    obfuscate_email,
    obfuscate_phone,
    obfuscate_target,
)
from app.services.verification_channels.manager import (
    get_channel,
    generate_otp_code,
    hash_otp_code,
    send_recipient_otp,
    verify_recipient_otp,
)

__all__ = [
    "VerificationChannel",
    "ChannelSendResult",
    "obfuscate_email",
    "obfuscate_phone",
    "obfuscate_target",
    "get_channel",
    "generate_otp_code",
    "hash_otp_code",
    "send_recipient_otp",
    "verify_recipient_otp",
]
