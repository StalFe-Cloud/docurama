import hmac
import hashlib
import json
import time
from datetime import datetime, timezone
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Webhook, WebhookDelivery

class WebhookDispatcher:
    """
    Asynchronous Webhook Event Dispatcher for Docurama.
    Delivers event notifications to configured endpoints with HMAC-SHA256 signatures.
    """

    @classmethod
    def generate_signature(cls, secret: str, payload_bytes: bytes) -> str:
        return "sha256=" + hmac.new(secret.encode('utf-8'), payload_bytes, hashlib.sha256).hexdigest()

    @classmethod
    async def dispatch_event(cls, db: AsyncSession, account_id: str, event_type: str, data: dict):
        if not account_id:
            return

        stmt = select(Webhook).where(
            Webhook.account_id == account_id,
            Webhook.is_active == True
        )
        res = await db.execute(stmt)
        webhooks = res.scalars().all()

        if not webhooks:
            return

        ts = int(time.time())
        envelope_payload = {
            "event": event_type,
            "timestamp": ts,
            "data": data
        }
        payload_bytes = json.dumps(envelope_payload).encode('utf-8')

        async with httpx.AsyncClient(timeout=10.0) as client:
            for wh in webhooks:
                # Check if webhook is subscribed to this event
                if wh.events and event_type not in wh.events and "*" not in wh.events:
                    continue

                sig = cls.generate_signature(wh.secret_token, payload_bytes)
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "Docurama-Webhooks/1.0",
                    "X-Docurama-Event": event_type,
                    "X-Docurama-Signature": sig,
                    "X-Docurama-Timestamp": str(ts)
                }

                status_code = None
                resp_body = None
                is_success = False

                for attempt in range(1, 4):
                    try:
                        resp = await client.post(wh.url, content=payload_bytes, headers=headers)
                        status_code = resp.status_code
                        resp_body = resp.text[:1000]
                        if 200 <= status_code < 300:
                            is_success = True
                            break
                    except Exception as ex:
                        resp_body = str(ex)[:500]

                # Record delivery
                delivery = WebhookDelivery(
                    webhook_id=wh.id,
                    event_type=event_type,
                    payload=envelope_payload,
                    response_status=status_code,
                    response_body=resp_body,
                    attempts=attempt,
                    is_success=is_success
                )
                db.add(delivery)

        await db.commit()
