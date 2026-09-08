"""
Webhook delivery.

Two problems this addresses. Delivery used to run inline in the signing request with
three retries at a ten second timeout per endpoint, so a slow or dead subscriber could
add thirty seconds or more to a signature submission. And the destination URL was
whatever the account configured, with no restriction, which turns the platform into an
SSRF proxy onto the Docker network and the host's link-local metadata endpoint.

Delivery now runs detached from the request, and destinations are validated.
"""
import asyncio
import hashlib
import hmac
import ipaddress
import json
import socket
import time
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.models import Webhook, WebhookDelivery

MAX_ATTEMPTS = 3
REQUEST_TIMEOUT_SECONDS = 10.0


def _is_blocked_ip(ip: str) -> bool:
    """Reject anything that is not a public unicast address."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local      # includes 169.254.169.254 cloud metadata
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_webhook_url(url: str) -> Tuple[bool, Optional[str]]:
    """
    Check that a webhook destination is a public https endpoint.

    Resolution happens here as well as at request time; this closes the obvious
    hostname cases, though a determined DNS rebind is only fully solved by pinning
    the resolved address into the connection.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "The webhook URL could not be parsed."

    if parsed.scheme not in ("http", "https"):
        return False, "Webhook URLs must use http or https."
    if not parsed.hostname:
        return False, "The webhook URL has no host."

    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        return False, f"The webhook host '{parsed.hostname}' could not be resolved."

    for info in infos:
        ip = info[4][0]
        if _is_blocked_ip(ip):
            return False, (
                f"The webhook host '{parsed.hostname}' resolves to a private or reserved "
                f"address ({ip}), which is not an allowed destination."
            )

    return True, None


class WebhookDispatcher:
    """
    Asynchronous webhook event dispatcher.
    Delivers event notifications with HMAC-SHA256 signatures.
    """

    @classmethod
    def generate_signature(cls, secret: str, payload_bytes: bytes) -> str:
        return "sha256=" + hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()

    @classmethod
    async def _deliver(cls, webhook_id: str, url: str, secret: str, event_type: str, payload: dict) -> None:
        """Deliver one event on its own session, detached from the request that raised it."""
        payload_bytes = json.dumps(payload).encode("utf-8")
        ts = payload.get("timestamp", int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Docurama-Webhooks/1.0",
            "X-Docurama-Event": event_type,
            "X-Docurama-Signature": cls.generate_signature(secret, payload_bytes),
            "X-Docurama-Timestamp": str(ts),
        }

        status_code: Optional[int] = None
        resp_body: Optional[str] = None
        is_success = False
        attempt = 0

        allowed, reason = validate_webhook_url(url)
        if not allowed:
            resp_body = reason
            attempt = 1
        else:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=False) as client:
                for attempt in range(1, MAX_ATTEMPTS + 1):
                    try:
                        resp = await client.post(url, content=payload_bytes, headers=headers)
                        status_code = resp.status_code
                        resp_body = resp.text[:1000]
                        if 200 <= status_code < 300:
                            is_success = True
                            break
                    except Exception as ex:
                        resp_body = str(ex)[:500]
                    if attempt < MAX_ATTEMPTS:
                        # Back off so a struggling subscriber is not hammered.
                        await asyncio.sleep(2 ** (attempt - 1))

        async with AsyncSessionLocal() as session:
            session.add(WebhookDelivery(
                webhook_id=webhook_id,
                event_type=event_type,
                payload=payload,
                response_status=status_code,
                response_body=resp_body,
                attempts=attempt,
                is_success=is_success,
            ))
            await session.commit()

    @classmethod
    async def dispatch_event(cls, db: AsyncSession, account_id: str, event_type: str, data: dict) -> None:
        """
        Queue an event for every subscribed webhook.

        Returns as soon as the subscriptions are read; delivery proceeds in the
        background so signing requests are not held open by subscriber latency.
        """
        if not account_id:
            return

        webhooks: List[Webhook] = (await db.execute(
            select(Webhook).where(
                Webhook.account_id == account_id,
                Webhook.is_active == True,  # noqa: E712 - SQL expression
            )
        )).scalars().all()

        if not webhooks:
            return

        payload = {
            "event": event_type,
            "timestamp": int(time.time()),
            "data": data,
        }

        for wh in webhooks:
            if wh.events and event_type not in wh.events and "*" not in wh.events:
                continue
            # Detached task: the delivery outcome is recorded on its own session.
            asyncio.create_task(
                cls._deliver(wh.id, wh.url, wh.secret_token, event_type, payload)
            )
