"""
Tamper-evident audit hash chains.

Two ledgers are chained:

- ``SecurityEvent`` — the platform-wide ledger (authentication, administrative,
  privacy and operational events), chained globally by monotonic ``seq``.
- ``AuditEvent`` — the per-envelope trail, chained within each envelope.

Chaining is enforced by a SQLAlchemy ``before_flush`` listener on the session
class, so EVERY new row of either ledger is committed to the chain no matter
which code path created it — envelope creation, signing completion, the
reminder sweeper, verification channels, or anything added later. A row that
arrives at flush time without a hash gets chained; a row that already carries
one (from ``append_security_event``) is left untouched.

Every row's ``event_hash`` is ``sha256(canonical_json(payload))`` where the
payload commits to the previous row's hash, the row's own content and its
sequence position. Removing a middle row, rewriting any field, or reordering
rows breaks every subsequent link, which ``verify_chain`` reports with the
first broken sequence number.

``AuditChainSeal`` rows snapshot a chain's tip at sealing time so a later
verification can also detect rewrites of history against what was previously
observed.

Terminology guardrail: this is tamper *evidence*, not a certification. The
verify endpoint reports exactly what it recomputed — valid or the first broken
link — and nothing more.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import event as sa_event, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AuditChainSeal, AuditEvent, SecurityEvent

logger = logging.getLogger(__name__)

GENESIS_HASH = "0" * 64

# Advisory-lock key guarding concurrent seq allocation on PostgreSQL.
_CHAIN_LOCK_KEY = 0x5E1D0  # arbitrary but stable


def _iso(dt: Optional[datetime]) -> str:
    """Deterministic ISO-8601 rendering regardless of storage tz-awareness."""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_event_hash(prev_hash: str, payload: dict) -> str:
    material = {"prev_hash": prev_hash, **payload}
    return hashlib.sha256(_canonical(material).encode("utf-8")).hexdigest()


def _security_payload(ev: SecurityEvent) -> dict:
    return {
        "seq": ev.seq,
        "account_id": ev.account_id or "",
        "actor_user_id": ev.actor_user_id or "",
        "actor_email": ev.actor_email or "",
        "event_type": ev.event_type,
        "severity": ev.severity,
        "ip_address": ev.ip_address or "",
        "user_agent": (ev.user_agent or "")[:500],
        "description": ev.description,
        "detail": ev.detail if isinstance(ev.detail, dict) else {},
        "created_at": _iso(ev.created_at),
    }


def _envelope_payload(ev: AuditEvent) -> dict:
    return {
        "seq": ev.seq,
        "envelope_id": ev.envelope_id,
        "event_type": ev.event_type,
        "actor_name": ev.actor_name or "",
        "actor_email": ev.actor_email or "",
        "ip_address": ev.ip_address or "",
        "description": ev.description,
        "hash_state": ev.hash_state or "",
        "created_at": _iso(ev.created_at),
    }


# ---------------------------------------------------------------------------
# Synchronous chain mechanics (used by the flush listener)
# ---------------------------------------------------------------------------

def _sync_next_seq(session: Session, model, *filters) -> int:
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _CHAIN_LOCK_KEY})
    q = select(func.max(model.seq))
    if filters:
        q = q.where(*filters)
    return int(session.execute(q).scalar() or 0) + 1


def _sync_last_hash(session: Session, model, seq: int, *filters) -> str:
    q = select(model.event_hash).where(model.seq == seq)
    if filters:
        q = q.where(*filters)
    row = session.execute(q).scalar_one_or_none()
    return row if row else GENESIS_HASH


def _materialize_defaults(obj) -> None:
    """Apply ORM column defaults before hashing.

    The flush listener runs before column defaults fire, so a row constructed
    without actor_name/severity would hash one payload and store another. The
    defaults are materialised here — exactly what the ORM will persist — so
    the stored hash verifies against the stored row.
    """
    if isinstance(obj, SecurityEvent):
        if obj.severity is None:
            obj.severity = "info"
        if obj.detail is None:
            obj.detail = {}
    else:  # AuditEvent
        if obj.actor_name is None:
            obj.actor_name = "System"


def _before_flush(session, flush_context, instances) -> None:
    """Chain every pending ledger row before it hits the database.

    Rows pending in the same flush are chained as a batch: the listener walks
    each scope (global for SecurityEvent, per-envelope for AuditEvent),
    continues the sequence from the last committed row, and links each new row
    to its predecessor — committed or pending.
    """
    if not settings.AUDIT_CHAIN_ENABLED:
        return
    try:
        pending_sec = [o for o in session.new
                       if isinstance(o, SecurityEvent) and not o.event_hash]
        if pending_sec:
            for obj in pending_sec:
                _materialize_defaults(obj)
            start = _sync_next_seq(session, SecurityEvent)
            tip = _sync_last_hash(session, SecurityEvent, start - 1) if start > 1 else GENESIS_HASH
            for offset, obj in enumerate(pending_sec):
                obj.seq = start + offset
                obj.prev_hash = tip
                if not obj.created_at:
                    obj.created_at = datetime.now(timezone.utc)
                obj.event_hash = compute_event_hash(obj.prev_hash, _security_payload(obj))
                tip = obj.event_hash

        pending_env = [o for o in session.new
                       if isinstance(o, AuditEvent) and not o.event_hash]
        if pending_env:
            for obj in pending_env:
                _materialize_defaults(obj)
            by_envelope: dict[str, list] = {}
            for obj in pending_env:
                by_envelope.setdefault(obj.envelope_id, []).append(obj)
            for envelope_id, rows in by_envelope.items():
                scope = (AuditEvent.envelope_id == envelope_id,)
                start = _sync_next_seq(session, AuditEvent, *scope)
                tip = _sync_last_hash(session, AuditEvent, start - 1, *scope) if start > 1 else GENESIS_HASH
                for offset, obj in enumerate(rows):
                    obj.seq = start + offset
                    obj.prev_hash = tip
                    if not obj.created_at:
                        obj.created_at = datetime.now(timezone.utc)
                    obj.event_hash = compute_event_hash(obj.prev_hash, _envelope_payload(obj))
                    tip = obj.event_hash
    except Exception:  # noqa: BLE001 — never write an unchained ledger row
        # A chain failure means the row would be written WITHOUT its link, i.e.
        # an unchained row inside an otherwise chained ledger. That is worse
        # than surfacing the error, so the exception propagates: callers see the
        # failure instead of getting a silently weakened audit trail.
        logger.exception("audit-chain before_flush failed")
        raise


_CHAIN_LISTENER_REGISTERED = False


if not _CHAIN_LISTENER_REGISTERED:
    sa_event.listens_for(Session, "before_flush")(_before_flush)
    _CHAIN_LISTENER_REGISTERED = True


# ---------------------------------------------------------------------------
# Async helpers (explicit appends from services/endpoints)
# ---------------------------------------------------------------------------

async def append_security_event(
    db: AsyncSession,
    *,
    event_type: str,
    description: str,
    severity: str = "info",
    account_id: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    detail: Optional[dict] = None,
    created_at: Optional[datetime] = None,
) -> SecurityEvent:
    """Append one hash-linked row to the platform security ledger.

    The caller owns the commit, matching the codebase's endpoint conventions.
    Hashing happens at flush time via the listener, so the returned object's
    ``event_hash`` may still be ``None`` until then.
    """
    event = SecurityEvent(
        account_id=account_id,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        event_type=event_type,
        severity=severity,
        ip_address=ip_address,
        user_agent=user_agent,
        description=description,
        detail=detail or {},
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(event)
    return event


async def safe_append(db: AsyncSession, **kwargs) -> Optional[SecurityEvent]:
    """Best-effort ledger append for user-facing request paths.

    Authentication and similar hot paths must not fail because the ledger
    hiccuped: a failed audit write is logged and swallowed rather than
    breaking sign-in. Administrative compliance endpoints use the strict
    ``append_security_event`` instead.
    """
    try:
        return await append_security_event(db, **kwargs)
    except Exception:  # noqa: BLE001 — the ledger must never take auth down
        logger.warning(
            "security-ledger append failed for event_type=%s", kwargs.get("event_type"),
            exc_info=True,
        )
        return None


async def chain_envelope_event(db: AsyncSession, event: AuditEvent) -> AuditEvent:
    """Retained for compatibility: rows are chained at flush automatically."""
    return event


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

async def verify_security_chain(db: AsyncSession, limit: Optional[int] = None) -> dict:
    """Recompute the global security ledger chain and report honestly."""
    return await _verify(db, SecurityEvent, _security_payload, limit=limit)


async def verify_envelope_chain(db: AsyncSession, envelope_id: str) -> dict:
    return await _verify(
        db, AuditEvent, _envelope_payload,
        filters=[AuditEvent.envelope_id == envelope_id],
    )


async def _verify(db, model, payload_fn, filters=None, limit=None) -> dict:
    q = select(model).order_by(model.seq.asc())
    if filters:
        q = q.where(*filters)
    if limit:
        q = q.limit(limit)
    rows = (await db.execute(q)).scalars().all()

    prev = GENESIS_HASH
    checked = 0
    for row in rows:
        if row.seq != checked + 1 or row.prev_hash != prev:
            return {
                "valid": False,
                "checked": checked,
                "first_broken_seq": row.seq,
                "reason": "sequence gap or broken prev_hash link",
                "expected_prev": prev,
                "actual_prev": row.prev_hash,
            }
        expected = compute_event_hash(row.prev_hash, payload_fn(row))
        if expected != row.event_hash:
            return {
                "valid": False,
                "checked": checked,
                "first_broken_seq": row.seq,
                "reason": "event_hash mismatch (content mutated or forged)",
                "expected_hash": expected,
                "actual_hash": row.event_hash,
            }
        prev = row.event_hash
        checked += 1

    return {"valid": True, "checked": checked, "tip_hash": prev, "first_broken_seq": None}


async def seal_security_chain(db: AsyncSession, sealed_by: str = "system") -> AuditChainSeal:
    """Snapshot the security ledger tip. Callers commit."""
    from sqlalchemy.ext.asyncio import AsyncSession as _AS  # noqa: F401 — typing aid only
    tip = (
        await db.execute(select(SecurityEvent).order_by(SecurityEvent.seq.desc()).limit(1))
    ).scalar_one_or_none()
    count = (
        await db.execute(select(func.count(SecurityEvent.seq)))
    ).scalar()

    seal = AuditChainSeal(
        scope="security_events",
        last_seq=int(tip.seq) if tip else 0,
        last_event_hash=tip.event_hash if tip else GENESIS_HASH,
        event_count=int(count or 0),
        sealed_by=sealed_by,
    )
    db.add(seal)
    return seal


async def verify_seals(db: AsyncSession) -> dict:
    """Check every seal still matches the live chain (append-only check)."""
    seals = (
        await db.execute(
            select(AuditChainSeal).where(AuditChainSeal.scope == "security_events")
            .order_by(AuditChainSeal.sealed_at.asc())
        )
    ).scalars().all()
    results = []
    for seal in seals:
        tip = (
            await db.execute(
                select(SecurityEvent).where(SecurityEvent.seq == seal.last_seq)
            )
        ).scalar_one_or_none()
        count = (
            await db.execute(
                select(func.count(SecurityEvent.seq)).where(SecurityEvent.seq <= seal.last_seq)
            )
        ).scalar()
        results.append({
            "seal_id": seal.id,
            "sealed_at": _iso(seal.sealed_at),
            "sealed_by": seal.sealed_by,
            "last_seq": seal.last_seq,
            "matches": bool(tip and tip.event_hash == seal.last_event_hash and count == seal.event_count),
        })
    return {"seals": results, "all_valid": all(r["matches"] for r in results)}
