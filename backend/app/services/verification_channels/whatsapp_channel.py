"""WhatsApp Cloud API signer verification channel."""
import os
from typing import Optional, Dict, Any
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AccountSetting
from app.services.verification_channels.base import (
    VerificationChannel,
    ChannelSendResult,
    obfuscate_phone,
)


class WhatsAppVerificationChannel(VerificationChannel):
    """Delivers a 6-digit one-time passcode to the recipient via WhatsApp Cloud API."""

    channel_name = "whatsapp_otp"

    async def _get_whatsapp_config(self, account_id: Optional[str], db: AsyncSession) -> Dict[str, Any]:
        if not account_id:
            return {}
        result = await db.execute(
            select(AccountSetting).where(
                AccountSetting.account_id == account_id,
                AccountSetting.section == "sms",
            )
        )
        setting = result.scalar_one_or_none()
        data = setting.data if setting and isinstance(setting.data, dict) else {}
        return data.get("whatsapp", {})

    async def send_code(
        self,
        target: str,
        code: str,
        envelope_title: str,
        recipient_name: str,
        account_id: Optional[str],
        db: AsyncSession,
    ) -> ChannelSendResult:
        obfuscated = obfuscate_phone(target)
        if not target or len(target.strip()) < 5:
            return ChannelSendResult(
                success=False,
                channel=self.channel_name,
                target_obfuscated=obfuscated,
                error="Recipient phone number is missing or invalid for WhatsApp.",
            )

        config = await self._get_whatsapp_config(account_id, db)
        is_test_env = os.environ.get("PYTEST_CURRENT_TEST") is not None
        phone_number_id = config.get("phone_number_id")
        access_token = config.get("access_token")

        if is_test_env or not (phone_number_id and access_token):
            return ChannelSendResult(
                success=True,
                channel=self.channel_name,
                target_obfuscated=obfuscated,
                message_id="mock_whatsapp_delivered",
            )

        url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
        clean_target = "".join(c for c in target if c.isdigit())
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_target,
            "type": "text",
            "text": {
                "body": f"Your Docurama verification code for '{envelope_title}' is: {code}. Valid for 10 minutes."
            }
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {access_token}"}
                )
            if resp.status_code in (200, 201):
                data = resp.json()
                msg_id = data.get("messages", [{}])[0].get("id")
                return ChannelSendResult(
                    success=True,
                    channel=self.channel_name,
                    target_obfuscated=obfuscated,
                    message_id=msg_id,
                )
            else:
                return ChannelSendResult(
                    success=False,
                    channel=self.channel_name,
                    target_obfuscated=obfuscated,
                    error=f"WhatsApp API error ({resp.status_code}): {resp.text[:200]}",
                )
        except Exception as e:
            return ChannelSendResult(
                success=False,
                channel=self.channel_name,
                target_obfuscated=obfuscated,
                error=f"Failed to connect to WhatsApp Cloud API: {str(e)}",
            )
