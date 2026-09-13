"""
Background compliance workers.

Two loops run when COMPLIANCE_JOBS_ENABLED is on (started from the app's
lifespan, mirroring the reminder sweep's pattern):

- the DSAR loop, which drives queued export/erasure requests to a terminal
  state;
- the retention loop, which applies retention policies in bounded batches.

Both loops swallow nothing silently: exceptions are logged and the loop keeps
going, because a crashed compliance worker is worse than a noisy one. Every
state change the loops cause is already written to the security ledger by the
service functions they call.
"""
import asyncio
import logging

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services import dsar as dsar_service
from app.services import retention as retention_service

logger = logging.getLogger(__name__)


async def dsar_loop():
    while True:
        try:
            async with AsyncSessionLocal() as db:
                processed = await dsar_service.process_next_queued(db)
                if processed is not None:
                    logger.info("DSAR request %s reached state=%s", processed.id, processed.state)
                    continue  # more may be queued; poll immediately
        except Exception:  # noqa: BLE001 — the worker must survive transient DB errors
            logger.exception("DSAR loop iteration failed")
        await asyncio.sleep(settings.DSAR_POLL_SECONDS)


async def retention_loop():
    while True:
        try:
            async with AsyncSessionLocal() as db:
                summary = await retention_service.retention_sweep_once(db)
                if summary["deleted"] or summary["anonymized"]:
                    logger.info("Retention sweep applied: %s", summary)
                await retention_service.purge_expired_security_events(db)
        except Exception:  # noqa: BLE001
            logger.exception("Retention loop iteration failed")
        await asyncio.sleep(settings.RETENTION_SWEEP_SECONDS)
