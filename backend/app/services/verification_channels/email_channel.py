"""Email OTP signer verification channel."""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import mailer, smtp_config
from app.services.verification_channels.base import (
    VerificationChannel,
    ChannelSendResult,
    obfuscate_email,
)


class EmailVerificationChannel(VerificationChannel):
    """Delivers a 6-digit one-time passcode to the recipient's email address."""

    channel_name = "email_otp"

    async def send_code(
        self,
        target: str,
        code: str,
        envelope_title: str,
        recipient_name: str,
        account_id: Optional[str],
        db: AsyncSession,
    ) -> ChannelSendResult:
        obfuscated = obfuscate_email(target)
        if not target:
            return ChannelSendResult(
                success=False,
                channel=self.channel_name,
                target_obfuscated=obfuscated,
                error="Recipient email address is missing.",
            )

        smtp = await smtp_config.resolve(db, account_id)
        subject, html, text = mailer.signer_otp(recipient_name, envelope_title, code)
        result = mailer.send_email(smtp, target, recipient_name, subject, html, text)

        if not result.sent:
            return ChannelSendResult(
                success=False,
                channel=self.channel_name,
                target_obfuscated=obfuscated,
                error=result.error or "Failed to send verification email.",
            )

        return ChannelSendResult(
            success=True,
            channel=self.channel_name,
            target_obfuscated=obfuscated,
            message_id=result.message_id,
        )
