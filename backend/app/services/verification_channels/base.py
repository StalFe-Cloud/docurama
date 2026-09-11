"""Base abstractions and target obfuscation for signer verification channels."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class ChannelSendResult:
    """Outcome of attempting to send a verification passcode via a channel."""
    success: bool
    channel: str
    target_obfuscated: str
    error: Optional[str] = None
    message_id: Optional[str] = None


def obfuscate_email(email: str) -> str:
    """
    Obfuscate an email for secure UI display.
    Example: ada@example.com -> a***@example.com
    """
    if not email or "@" not in email:
        return email or ""
    local, domain = email.split("@", 1)
    if len(local) <= 1:
        obfuscated_local = f"{local}***"
    else:
        obfuscated_local = f"{local[0]}***{local[-1]}"
    return f"{obfuscated_local}@{domain}"


def obfuscate_phone(phone: str) -> str:
    """
    Obfuscate a phone number for secure UI display.
    Example: +33612345678 -> +33 *** *** 78
    """
    if not phone:
        return ""
    clean = "".join(c for c in phone if c.isalnum() or c == "+")
    if len(clean) <= 4:
        return "***"
    prefix = clean[:3]
    suffix = clean[-2:]
    return f"{prefix} *** *** {suffix}"


def obfuscate_target(channel: str, target: Optional[str]) -> str:
    """Route target obfuscation by channel type."""
    if not target:
        return ""
    if channel == "email_otp":
        return obfuscate_email(target)
    if channel in ("sms_otp", "whatsapp_otp"):
        return obfuscate_phone(target)
    if channel == "telegram_otp":
        return f"Telegram ({target})"
    return target


class VerificationChannel(ABC):
    """Abstract interface implemented by every signer verification provider."""

    channel_name: str = "none"

    @abstractmethod
    async def send_code(
        self,
        target: str,
        code: str,
        envelope_title: str,
        recipient_name: str,
        account_id: Optional[str],
        db: AsyncSession,
    ) -> ChannelSendResult:
        """
        Send a one-time verification passcode to the recipient.
        Must report accurately whether delivery was confirmed or failed.
        """
        raise NotImplementedError
