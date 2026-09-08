"""
Automatic reminder sweep.

Recipient.reminders_sent_count / last_reminded_at and Template.reminder_interval_days /
max_reminders were modelled from the start but nothing ever consumed them, so automatic
reminders never existed. This task closes that gap.

Two workers run in the container, so the sweep takes a Postgres advisory lock and only
the holder does the work. As with manual reminders, a recipient's counter advances only
when a message is actually delivered.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import AuditEvent, Envelope, Recipient
from app.services import mailer, smtp_config

# Arbitrary but stable identifier for the sweep's advisory lock.
_ADVISORY_LOCK_KEY = 0x0D0C0A17

# Envelope states in which a signature is still outstanding.
_PENDING_ENVELOPE_STATUSES = ("sent", "delivered")
_PENDING_RECIPIENT_STATUSES = ("waiting", "sent", "opened")


async def _try_acquire_lock(session) -> bool:
    """Non-blocking advisory lock so only one worker sweeps."""
    result = await session.execute(
        text("SELECT pg_try_advisory_lock(:key)"), {"key": _ADVISORY_LOCK_KEY}
    )
    return bool(result.scalar())


async def _release_lock(session) -> None:
    await session.execute(
        text("SELECT pg_advisory_unlock(:key)"), {"key": _ADVISORY_LOCK_KEY}
    )


def _is_due(recipient: Recipient, now: datetime, interval_days: int, max_reminders: int) -> bool:
    sent_count = recipient.reminders_sent_count or 0
    if sent_count >= max_reminders:
        return False

    # Anchor the first reminder on when the recipient was created, and later ones on
    # the last delivered reminder.
    anchor = recipient.last_reminded_at or recipient.created_at
    if anchor is None:
        return False
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    return now - anchor >= timedelta(days=interval_days)


async def sweep_once() -> int:
    """
    Send one round of due reminders. Returns the number delivered.
    Safe to call when SMTP is unconfigured: nothing is sent and nothing is recorded.
    """
    interval_days = settings.REMINDER_INTERVAL_DAYS
    max_reminders = settings.REMINDER_MAX_COUNT
    now = datetime.now(timezone.utc)
    delivered = 0

    async with AsyncSessionLocal() as session:
        if not await _try_acquire_lock(session):
            return 0
        try:
            envelopes = (
                await session.execute(
                    select(Envelope)
                    .where(Envelope.status.in_(_PENDING_ENVELOPE_STATUSES))
                    .options(selectinload(Envelope.recipients))
                )
            ).scalars().all()

            for envelope in envelopes:
                due = [
                    r for r in envelope.recipients
                    if r.role == "signer"
                    and r.status in _PENDING_RECIPIENT_STATUSES
                    and _is_due(r, now, interval_days, max_reminders)
                ]
                if not due:
                    continue

                # Respect sequential routing: only chase whoever is actually next.
                outstanding = [
                    r for r in envelope.recipients
                    if r.role == "signer" and r.status not in ("signed", "declined", "delegated")
                ]
                if outstanding:
                    next_order = min((r.routing_order or 1) for r in outstanding)
                    due = [r for r in due if (r.routing_order or 1) == next_order]

                # Per account: one tenant having no mail server must not stop another's
                # reminders going out.
                smtp = await smtp_config.resolve(session, envelope.account_id)
                if not mailer.is_configured(smtp):
                    continue

                batch = mailer.BatchResult()
                for recipient in due:
                    signing_url = f"{settings.APP_URL}/s/{recipient.signing_token}"
                    reminder_number = (recipient.reminders_sent_count or 0) + 1
                    subject, html, body = mailer.signing_reminder(
                        recipient.name, envelope.title, signing_url, reminder_number
                    )
                    result = mailer.send_email(smtp, recipient.email, recipient.name, subject, html, body)
                    batch.results.append(result)
                    if result.sent:
                        recipient.reminders_sent_count = reminder_number
                        recipient.last_reminded_at = now
                        delivered += 1

                if batch.results:
                    session.add(AuditEvent(
                        envelope_id=envelope.id,
                        event_type="reminder_sent" if batch.any_sent else "reminder_failed",
                        actor_name="Docurama Reminder Service",
                        actor_email=settings.SYSTEM_ACTOR_EMAIL,
                        description=f"Automatic reminder: {batch.summary()}",
                    ))

            await session.commit()
        finally:
            await _release_lock(session)

    return delivered


async def reminder_loop() -> None:
    """Background loop started from the application lifespan."""
    interval_seconds = max(60, settings.REMINDER_SWEEP_INTERVAL_MINUTES * 60)
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            sent = await sweep_once()
            if sent:
                print(f"[Reminders] delivered {sent} reminder(s)")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a sweep failure must not kill the loop
            print(f"[Reminders] sweep failed: {e}")
