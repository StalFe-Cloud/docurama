"""
Compliance & Trust API (admin surface) and the public trust center.

Admin surface (platform-admin gated):
- Audit integrity: verify chains, seal the security ledger, list seals,
  inspect recent security events.
- DSAR: create/list/cancel/export-requests; run processing; download bundles.
- Consent ledger: record and revoke.
- Retention: platform-default and per-workspace policies; legal holds.
- Incident response: record, contain, resolve, notification timestamps.
- Subprocessors: registry CRUD.
- Controls & evidence: the readiness catalog with the four-state vocabulary.
- Access reviews: record completed reviews.
- Overview: one aggregate for the dashboard.

Public surface (no auth): GET /api/trust - factual feature and subprocessor
publication. It publishes readiness vocabulary, never certification claims;
the certifications array is always empty because no certification exists to
claim, and the response says so.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field as PydField
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.auth import get_current_user
from app.api.legal import _require_platform_admin
from app.core.config import settings
from app.core.database import get_db
from app.models import (
    AccessReview, Account, AuditChainSeal, ChangeRequest, ComplianceControl,
    ConsentRecord, ControlEvidence, DsarRequest, Envelope, LegalHold,
    RestoreDrill, RetentionPolicy, RiskRegisterEntry, SecurityEvent,
    SecurityIncident, Subprocessor, User, VendorReview,
)
from app.services import audit_chain, compliance_catalog, dsar as dsar_service, retention as retention_service

# GDPR Article 33: notification to the supervisory authority within 72 hours
# of becoming aware of a breach. The clock is computed here, once, at insert.
_SEVENTY_TWO_HOURS = timedelta(hours=72)

router = APIRouter(tags=["compliance"], prefix="/admin")
public_router = APIRouter(tags=["trust"])

READINESS_STATES = compliance_catalog.READINESS_STATES


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DsarCreate(BaseModel):
    # Plain string, normalised server-side: EmailStr would reject reserved
    # TLDs (.test, .invalid) that test fixtures and erasure pseudonyms use.
    subject_email: str = PydField(min_length=3, max_length=255)
    kind: str = PydField(pattern="^(export|delete)$")
    account_id: Optional[str] = None


class ConsentCreate(BaseModel):
    subject_email: str = PydField(min_length=3, max_length=255)
    purpose: str = PydField(min_length=1, max_length=100)
    granted: bool = True
    evidence_ref: Optional[str] = None


class RetentionPolicyIn(BaseModel):
    account_id: Optional[str] = None
    resource_type: str = PydField(pattern="^(envelopes|security_events)$")
    retention_days: int = PydField(ge=1, le=36500)
    action: str = PydField(pattern="^(delete|anonymize)$")
    enabled: bool = True


class LegalHoldCreate(BaseModel):
    account_id: str
    name: str = PydField(min_length=1, max_length=255)
    reason: str = PydField(min_length=1)
    scope_envelope_id: Optional[str] = None


class IncidentCreate(BaseModel):
    title: str = PydField(min_length=1, max_length=255)
    description: str = PydField(min_length=1)
    severity: str = PydField(pattern="^(low|medium|high|critical)$")
    account_id: Optional[str] = None
    detected_at: Optional[datetime] = None
    reported_by: Optional[str] = None


class SubprocessorIn(BaseModel):
    name: str = PydField(min_length=1, max_length=255)
    purpose: str = PydField(min_length=1, max_length=500)
    data_location: str = PydField(default="Operator-configured", max_length=255)
    status: str = PydField(pattern="^(active|planned|retired)$", default="active")
    url: Optional[str] = None


class ControlReadinessIn(BaseModel):
    readiness: str
    note: Optional[str] = None


class EvidenceIn(BaseModel):
    kind: str = PydField(pattern="^(test|code|config|runbook|endpoint|gap)$")
    reference: str = PydField(min_length=1, max_length=500)
    note: Optional[str] = None


class AccessReviewIn(BaseModel):
    period_start: datetime
    period_end: datetime
    scope: str = "platform admin + workspace owners"
    findings: Optional[str] = None
    accounts_reviewed: int = 0
    changes_required: int = 0


class RiskCreate(BaseModel):
    title: str = PydField(min_length=3, max_length=255)
    description: str = PydField(min_length=1)
    category: str = PydField(
        pattern="^(security|privacy|availability|vendor|operational|compliance)$",
        default="security",
    )
    likelihood: int = PydField(ge=1, le=5)
    impact: int = PydField(ge=1, le=5)
    treatment: str = PydField(pattern="^(mitigate|accept|transfer|avoid)$", default="mitigate")
    treatment_notes: Optional[str] = None
    residual_likelihood: int = PydField(ge=1, le=5, default=2)
    residual_impact: int = PydField(ge=1, le=5, default=2)
    owner: str = PydField(default="Platform operator", max_length=255)
    control_refs: Optional[str] = PydField(default=None, max_length=500)
    next_review_at: Optional[datetime] = None


class RiskUpdate(BaseModel):
    """All fields optional; scores are always recomputed server-side."""
    title: Optional[str] = PydField(default=None, min_length=3, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = PydField(
        default=None, pattern="^(security|privacy|availability|vendor|operational|compliance)$"
    )
    likelihood: Optional[int] = PydField(default=None, ge=1, le=5)
    impact: Optional[int] = PydField(default=None, ge=1, le=5)
    treatment: Optional[str] = PydField(default=None, pattern="^(mitigate|accept|transfer|avoid)$")
    treatment_notes: Optional[str] = None
    residual_likelihood: Optional[int] = PydField(default=None, ge=1, le=5)
    residual_impact: Optional[int] = PydField(default=None, ge=1, le=5)
    owner: Optional[str] = PydField(default=None, max_length=255)
    # open | mitigating | accepted | closed
    status: Optional[str] = PydField(default=None, pattern="^(open|mitigating|accepted|closed)$")
    control_refs: Optional[str] = PydField(default=None, max_length=500)
    next_review_at: Optional[datetime] = None


class RestoreDrillIn(BaseModel):
    """Evidence record for one executed restore drill.

    The verification itself runs offline in scripts/restore_drill.py; its
    JSON report travels verbatim in drill_output so a reviewer can see what
    the harness actually measured, not just the summary booleans.
    """
    source: str = PydField(min_length=1, max_length=500)
    rows_recovered: int = PydField(ge=0, default=0)
    tables_checked: int = PydField(ge=0, default=0)
    chain_valid: bool
    drill_output: Optional[dict] = None
    performed_by: str = PydField(default="system", max_length=255)
    passed: Optional[bool] = None
    notes: Optional[str] = None
    executed_at: Optional[datetime] = None


class ChangeCreate(BaseModel):
    """A proposed platform change (ISO-09). Review happens via /decision."""
    title: str = PydField(min_length=3, max_length=255)
    description: str = PydField(min_length=1)
    change_type: str = PydField(pattern="^(standard|normal|emergency)$", default="normal")
    risk_notes: Optional[str] = None
    control_refs: Optional[str] = PydField(default=None, max_length=500)


class ChangeDecision(BaseModel):
    """Approve or reject a proposed change. Reviewer must differ from requester."""
    decision: str = PydField(pattern="^(approved|rejected)$")
    review_notes: Optional[str] = None


class VendorCreate(BaseModel):
    """One recorded vendor security review (SOC2-03)."""
    vendor_name: str = PydField(min_length=1, max_length=255)
    service_provided: str = PydField(min_length=1, max_length=500)
    data_access_level: str = PydField(pattern="^(none|limited|full)$", default="limited")
    personal_data: bool = False
    hosting_region: Optional[str] = PydField(default=None, max_length=120)
    reviewed_at: Optional[datetime] = None
    reviewer: str = PydField(default="Platform operator", max_length=255)
    questionnaire: Optional[dict] = None
    outcome: str = PydField(pattern="^(approved|conditional|rejected|pending)$", default="pending")
    findings: Optional[str] = None
    next_review_due: Optional[datetime] = None
    control_refs: Optional[str] = PydField(default=None, max_length=500)


class VendorUpdate(BaseModel):
    """All fields optional; next-review enforcement applies on outcome change."""
    vendor_name: Optional[str] = PydField(default=None, min_length=1, max_length=255)
    service_provided: Optional[str] = PydField(default=None, min_length=1, max_length=500)
    data_access_level: Optional[str] = PydField(default=None, pattern="^(none|limited|full)$")
    personal_data: Optional[bool] = None
    hosting_region: Optional[str] = PydField(default=None, max_length=120)
    reviewer: Optional[str] = PydField(default=None, max_length=255)
    questionnaire: Optional[dict] = None
    outcome: Optional[str] = PydField(default=None, pattern="^(approved|conditional|rejected|pending)$")
    findings: Optional[str] = None
    next_review_due: Optional[datetime] = None
    control_refs: Optional[str] = PydField(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Audit integrity
# ---------------------------------------------------------------------------

@router.get("/audit/verify")
async def verify_audit_chains(
    scope: str = "security",
    envelope_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    if scope == "security":
        result = await audit_chain.verify_security_chain(db)
    elif scope == "envelope":
        if not envelope_id:
            raise HTTPException(status_code=422, detail="envelope_id is required for scope=envelope")
        result = await audit_chain.verify_envelope_chain(db, envelope_id)
    else:
        raise HTTPException(status_code=422, detail="scope must be 'security' or 'envelope'")
    seals = await audit_chain.verify_seals(db)
    return {"scope": scope, "chain": result, "seals": seals}


@router.post("/audit/seal")
async def seal_audit_chain(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    seal = await audit_chain.seal_security_chain(db, sealed_by=current_user.email)
    await audit_chain.append_security_event(
        db,
        event_type="control_reviewed",
        description="Security ledger sealed",
        actor_email=current_user.email,
        detail={"seal_id": seal.id, "last_seq": seal.last_seq},
    )
    await db.commit()
    return {"seal_id": seal.id, "last_seq": seal.last_seq, "event_count": seal.event_count,
            "last_event_hash": seal.last_event_hash}


@router.get("/audit/seals")
async def list_audit_seals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(AuditChainSeal).order_by(AuditChainSeal.sealed_at.desc()).limit(100)
    )).scalars().all()
    return [{"id": s.id, "scope": s.scope, "last_seq": s.last_seq,
             "last_event_hash": s.last_event_hash, "event_count": s.event_count,
             "sealed_by": s.sealed_by, "sealed_at": _iso(s.sealed_at)} for s in rows]


@router.get("/audit/security-events")
async def list_security_events(
    limit: int = 100,
    event_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    limit = max(1, min(limit, 500))
    q = select(SecurityEvent).order_by(SecurityEvent.seq.desc()).limit(limit)
    if event_type:
        q = q.where(SecurityEvent.event_type == event_type)
    rows = (await db.execute(q)).scalars().all()
    return [{"seq": e.seq, "event_type": e.event_type, "severity": e.severity,
             "actor_email": e.actor_email, "description": e.description,
             "created_at": _iso(e.created_at), "event_hash": e.event_hash} for e in rows]


# ---------------------------------------------------------------------------
# DSAR
# ---------------------------------------------------------------------------

@router.post("/dsar", status_code=201)
async def create_dsar(
    payload: DsarCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    account_id = payload.account_id or current_user.account_id
    if not account_id:
        raise HTTPException(status_code=422, detail="account_id is required for platform admins without a workspace")
    account = (await db.execute(select(Account).where(Account.id == account_id))).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    req = await dsar_service.create_request(
        db, account_id=account_id, subject_email=payload.subject_email,
        kind=payload.kind, requested_by_user_id=current_user.id,
    )
    await db.commit()
    return {"id": req.id, "state": req.state, "kind": req.kind,
            "subject_email": req.subject_email, "created_at": _iso(req.created_at)}


@router.get("/dsar")
async def list_dsar(
    state: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    q = select(DsarRequest).order_by(DsarRequest.created_at.desc()).limit(200)
    if state:
        if state not in dsar_service.VALID_STATES:
            raise HTTPException(status_code=422, detail=f"state must be one of {dsar_service.VALID_STATES}")
        q = q.where(DsarRequest.state == state)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": r.id, "kind": r.kind, "state": r.state,
             "subject_email": r.subject_email, "account_id": r.account_id,
             "failure_reason": r.failure_reason, "result_summary": r.result_summary,
             "created_at": _iso(r.created_at), "completed_at": _iso(r.completed_at)} for r in rows]


@router.get("/dsar/{request_id}")
async def get_dsar(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    r = await db.get(DsarRequest, request_id)
    if r is None:
        raise HTTPException(status_code=404, detail="DSAR request not found.")
    return {"id": r.id, "kind": r.kind, "state": r.state, "subject_email": r.subject_email,
            "failure_reason": r.failure_reason, "result_summary": r.result_summary,
            "result_ref": r.result_ref, "created_at": _iso(r.created_at),
            "started_at": _iso(r.started_at), "completed_at": _iso(r.completed_at),
            "cancelled_at": _iso(r.cancelled_at)}


@router.post("/dsar/{request_id}/cancel")
async def cancel_dsar(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    r = await db.get(DsarRequest, request_id)
    if r is None:
        raise HTTPException(status_code=404, detail="DSAR request not found.")
    try:
        await dsar_service.cancel_request(db, r)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return {"id": r.id, "state": r.state}


@router.post("/dsar/{request_id}/run")
async def run_dsar(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Drive one request to a terminal state, right now.

    The background loop does the same work on a timer; this endpoint exists so
    operators and tests do not have to wait for the poll interval.
    """
    await _require_platform_admin(current_user)
    r = await db.get(DsarRequest, request_id)
    if r is None:
        raise HTTPException(status_code=404, detail="DSAR request not found.")
    processed = await dsar_service.process_request(db, r)
    return {"id": processed.id, "state": processed.state,
            "failure_reason": processed.failure_reason,
            "result_summary": processed.result_summary}


@router.get("/dsar/{request_id}/download")
async def download_dsar(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    r = await db.get(DsarRequest, request_id)
    if r is None:
        raise HTTPException(status_code=404, detail="DSAR request not found.")
    if r.kind != "export" or r.state != "completed" or not r.result_ref:
        raise HTTPException(status_code=409, detail="No export bundle available for this request.")
    import os
    if not os.path.exists(r.result_ref):
        raise HTTPException(status_code=410, detail="Export bundle file is gone; re-run the request.")
    return FileResponse(r.result_ref, media_type="application/json",
                        filename=f"dsar_export_{r.id}.json")


# ---------------------------------------------------------------------------
# Consent ledger
# ---------------------------------------------------------------------------

@router.get("/consents")
async def list_consents(
    subject_email: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    q = select(ConsentRecord).order_by(ConsentRecord.created_at.desc()).limit(300)
    if subject_email:
        q = q.where(ConsentRecord.subject_email == subject_email.strip().lower())
    rows = (await db.execute(q)).scalars().all()
    return [{"id": c.id, "subject_email": c.subject_email, "purpose": c.purpose,
             "granted": bool(c.granted), "granted_at": _iso(c.granted_at),
             "revoked_at": _iso(c.revoked_at), "evidence_ref": c.evidence_ref} for c in rows]


@router.post("/consents", status_code=201)
async def record_consent(
    payload: ConsentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    record = ConsentRecord(
        account_id=current_user.account_id,
        subject_email=payload.subject_email.strip().lower(),
        purpose=payload.purpose,
        granted=payload.granted,
        granted_at=datetime.now(timezone.utc),
        evidence_ref=payload.evidence_ref,
    )
    db.add(record)
    await audit_chain.append_security_event(
        db,
        event_type="consent_recorded" if payload.granted else "consent_revoked",
        description=f"Consent for '{payload.purpose}' {'granted' if payload.granted else 'revoked'} for {payload.subject_email}",
        actor_email=current_user.email,
        detail={"subject": payload.subject_email, "purpose": payload.purpose},
    )
    await db.commit()
    return {"id": record.id, "granted": bool(record.granted)}


@router.post("/consents/{consent_id}/revoke")
async def revoke_consent(
    consent_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    record = await db.get(ConsentRecord, consent_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Consent record not found.")
    if record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        record.granted = False
        await audit_chain.append_security_event(
            db,
            event_type="consent_revoked",
            description=f"Consent for '{record.purpose}' revoked for {record.subject_email}",
            actor_email=current_user.email,
            detail={"subject": record.subject_email, "purpose": record.purpose},
        )
        await db.commit()
    return {"id": record.id, "revoked_at": _iso(record.revoked_at)}


# ---------------------------------------------------------------------------
# Retention policies & legal holds
# ---------------------------------------------------------------------------

@router.get("/retention-policies")
async def list_retention_policies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(select(RetentionPolicy))).scalars().all()
    return [{"id": p.id, "account_id": p.account_id, "resource_type": p.resource_type,
             "retention_days": p.retention_days, "action": p.action,
             "enabled": bool(p.enabled), "updated_at": _iso(p.updated_at)} for p in rows]


@router.put("/retention-policies")
async def upsert_retention_policy(
    payload: RetentionPolicyIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    q = select(RetentionPolicy).where(
        RetentionPolicy.resource_type == payload.resource_type,
        RetentionPolicy.account_id == payload.account_id,
    )
    policy = (await db.execute(q)).scalar_one_or_none()
    if policy is None:
        policy = RetentionPolicy(
            account_id=payload.account_id,
            resource_type=payload.resource_type,
        )
        db.add(policy)
    policy.retention_days = payload.retention_days
    policy.action = payload.action
    policy.enabled = payload.enabled
    policy.updated_by_user_id = current_user.id
    await db.commit()
    return {"id": policy.id, "account_id": policy.account_id,
            "resource_type": policy.resource_type,
            "retention_days": policy.retention_days, "action": policy.action,
            "enabled": bool(policy.enabled)}


@router.post("/retention/sweep")
async def run_retention_sweep(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run one bounded retention sweep now (the loop runs on a timer)."""
    await _require_platform_admin(current_user)
    summary = await retention_service.retention_sweep_once(db)
    return summary


@router.get("/legal-holds")
async def list_legal_holds(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(LegalHold).order_by(LegalHold.created_at.desc()).limit(200)
    )).scalars().all()
    return [{"id": h.id, "account_id": h.account_id, "name": h.name, "reason": h.reason,
             "scope_envelope_id": h.scope_envelope_id, "created_at": _iso(h.created_at),
             "released_at": _iso(h.released_at)} for h in rows]


@router.post("/legal-holds", status_code=201)
async def create_legal_hold(
    payload: LegalHoldCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    account = (await db.execute(select(Account).where(Account.id == payload.account_id))).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    hold = LegalHold(
        account_id=payload.account_id,
        name=payload.name,
        reason=payload.reason,
        scope_envelope_id=payload.scope_envelope_id,
        created_by_user_id=current_user.id,
    )
    db.add(hold)
    await audit_chain.append_security_event(
        db,
        event_type="legal_hold_added",
        description=f"Legal hold '{payload.name}' placed on workspace {payload.account_id}",
        severity="warning",
        account_id=payload.account_id,
        actor_email=current_user.email,
        detail={"hold_id": hold.id, "scope_envelope_id": payload.scope_envelope_id},
    )
    await db.commit()
    return {"id": hold.id, "name": hold.name}


@router.post("/legal-holds/{hold_id}/release")
async def release_legal_hold(
    hold_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    hold = await db.get(LegalHold, hold_id)
    if hold is None:
        raise HTTPException(status_code=404, detail="Legal hold not found.")
    if hold.released_at is None:
        hold.released_at = datetime.now(timezone.utc)
        await audit_chain.append_security_event(
            db,
            event_type="legal_hold_released",
            description=f"Legal hold '{hold.name}' released",
            severity="warning",
            account_id=hold.account_id,
            actor_email=current_user.email,
            detail={"hold_id": hold.id},
        )
        await db.commit()
    return {"id": hold.id, "released_at": _iso(hold.released_at)}


# ---------------------------------------------------------------------------
# Security incidents
# ---------------------------------------------------------------------------

@router.get("/incidents")
async def list_incidents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(SecurityIncident).order_by(SecurityIncident.detected_at.desc()).limit(200)
    )).scalars().all()
    return [_incident_out(i) for i in rows]


def _incident_out(i: SecurityIncident) -> dict:
    deadline = i.gdpr_notification_deadline
    # SQLite round-trips drop tzinfo; normalise before any comparison.
    if deadline is not None and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    overdue = False
    if deadline and i.status != "resolved" and not i.authority_notified_at:
        overdue = deadline <= datetime.now(timezone.utc)
    return {"id": i.id, "title": i.title, "description": i.description,
            "severity": i.severity, "status": i.status, "account_id": i.account_id,
            "detected_at": _iso(i.detected_at), "contained_at": _iso(i.contained_at),
            "resolved_at": _iso(i.resolved_at),
            "gdpr_notification_deadline": _iso(deadline),
            "authority_notified_at": _iso(i.authority_notified_at),
            "subjects_notified_at": _iso(i.subjects_notified_at),
            "reported_by": i.reported_by, "notification_overdue": overdue}


@router.post("/incidents", status_code=201)
async def create_incident(
    payload: IncidentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    detected = payload.detected_at or datetime.now(timezone.utc)
    if detected.tzinfo is None:
        detected = detected.replace(tzinfo=timezone.utc)
    incident = SecurityIncident(
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        account_id=payload.account_id,
        detected_at=detected,
        # The 72-hour clock is computed server-side from detection time and
        # cannot be moved afterwards; only actual notification timestamps
        # close it out.
        gdpr_notification_deadline=detected + _SEVENTY_TWO_HOURS,
        reported_by=payload.reported_by or current_user.email,
    )
    db.add(incident)
    await db.flush()
    await audit_chain.append_security_event(
        db,
        event_type="incident_recorded",
        description=f"Security incident recorded: {payload.title}",
        severity="critical" if payload.severity in ("high", "critical") else "warning",
        account_id=payload.account_id,
        actor_email=current_user.email,
        detail={"incident_id": incident.id, "deadline": incident.gdpr_notification_deadline.isoformat()},
    )
    await db.commit()
    return _incident_out(incident)


@router.post("/incidents/{incident_id}/contain")
async def contain_incident(
    incident_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    incident = await db.get(SecurityIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found.")
    if incident.status == "detected":
        incident.status = "contained"
        incident.contained_at = datetime.now(timezone.utc)
        await _incident_update_event(db, incident, "contained", current_user.email)
        await db.commit()
    return _incident_out(incident)


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    authority_notified: bool = False,
    subjects_notified: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    incident = await db.get(SecurityIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found.")
    now = datetime.now(timezone.utc)
    if incident.status != "resolved":
        incident.status = "resolved"
        incident.resolved_at = now
        # Notification timestamps record what actually happened; the flags are
        # assertions made by the operator and are stored as such.
        if authority_notified:
            incident.authority_notified_at = now
        if subjects_notified:
            incident.subjects_notified_at = now
        await _incident_update_event(db, incident, "resolved", current_user.email)
        await db.commit()
    return _incident_out(incident)


async def _incident_update_event(db, incident, action, actor_email):
    await audit_chain.append_security_event(
        db,
        event_type="incident_updated",
        description=f"Incident '{incident.title}' {action}",
        severity="warning",
        account_id=incident.account_id,
        actor_email=actor_email,
        detail={"incident_id": incident.id, "action": action},
    )


# ---------------------------------------------------------------------------
# Subprocessors
# ---------------------------------------------------------------------------

@router.get("/subprocessors")
async def list_subprocessors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(Subprocessor).order_by(Subprocessor.added_at.desc())
    )).scalars().all()
    return [_subprocessor_out(s) for s in rows]


def _subprocessor_out(s: Subprocessor) -> dict:
    return {"id": s.id, "name": s.name, "purpose": s.purpose,
            "data_location": s.data_location, "status": s.status,
            "url": s.url, "added_at": _iso(s.added_at),
            "removed_at": _iso(s.removed_at)}


@router.post("/subprocessors", status_code=201)
async def add_subprocessor(
    payload: SubprocessorIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    row = Subprocessor(**payload.model_dump())
    db.add(row)
    await db.flush()
    await audit_chain.append_security_event(
        db,
        event_type="subprocessor_recorded",
        description=f"Subprocessor registered: {row.name} ({row.status})",
        actor_email=current_user.email,
        detail={"subprocessor_id": row.id, "purpose": row.purpose},
    )
    await db.commit()
    return _subprocessor_out(row)


# ---------------------------------------------------------------------------
# Controls, evidence, access reviews, overview
# ---------------------------------------------------------------------------

@router.get("/compliance/controls")
async def list_controls(
    framework: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_seeded(db)
    q = select(ComplianceControl).options(selectinload(ComplianceControl.evidence)).order_by(ComplianceControl.control_id)
    if framework:
        if framework not in compliance_catalog.FRAMEWORKS:
            raise HTTPException(status_code=422, detail=f"framework must be one of {compliance_catalog.FRAMEWORKS}")
        q = q.where(ComplianceControl.framework == framework)
    rows = (await db.execute(q)).scalars().unique().all()
    return [_control_out(c) for c in rows]


def _control_out(c: ComplianceControl) -> dict:
    return {"id": c.id, "control_id": c.control_id, "name": c.name,
            "framework": c.framework, "description": c.description,
            "owner_role": c.owner_role, "readiness": c.readiness,
            "review_frequency": c.review_frequency,
            "last_reviewed_at": _iso(c.last_reviewed_at),
            "evidence": [{"id": e.id, "kind": e.kind, "reference": e.reference,
                          "note": e.note, "collected_at": _iso(e.collected_at)}
                         for e in c.evidence]}


@router.patch("/compliance/controls/{control_db_id}")
async def update_control_readiness(
    control_db_id: str,
    payload: ControlReadinessIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    if payload.readiness not in READINESS_STATES:
        raise HTTPException(
            status_code=422,
            detail=f"readiness must be one of {READINESS_STATES}; certification-like values are not accepted",
        )
    control = await db.get(ComplianceControl, control_db_id)
    if control is None:
        raise HTTPException(status_code=404, detail="Control not found.")
    previous = control.readiness
    control.readiness = payload.readiness
    control.last_reviewed_at = datetime.now(timezone.utc)
    await audit_chain.append_security_event(
        db,
        event_type="control_reviewed",
        description=f"Control {control.control_id} readiness {previous} -> {payload.readiness}",
        actor_email=current_user.email,
        detail={"control_id": control.control_id, "note": payload.note},
    )
    await db.commit()
    # Re-fetch with evidence eagerly loaded: lazy-loading a relationship from
    # async context is a MissingGreenlet trap.
    control = (
        await db.execute(
            select(ComplianceControl)
            .options(selectinload(ComplianceControl.evidence))
            .where(ComplianceControl.id == control_db_id)
        )
    ).scalars().unique().one()
    return _control_out(control)


@router.post("/compliance/controls/{control_db_id}/evidence", status_code=201)
async def add_evidence(
    control_db_id: str,
    payload: EvidenceIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    control = await db.get(ComplianceControl, control_db_id)
    if control is None:
        raise HTTPException(status_code=404, detail="Control not found.")
    item = ControlEvidence(control_id_fk=control.id, kind=payload.kind,
                           reference=payload.reference, note=payload.note)
    db.add(item)
    await db.commit()
    return {"id": item.id, "kind": item.kind, "reference": item.reference}


@router.post("/compliance/access-reviews", status_code=201)
async def record_access_review(
    payload: AccessReviewIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=422, detail="period_end must not precede period_start")
    review = AccessReview(
        period_start=payload.period_start,
        period_end=payload.period_end,
        reviewer_user_id=current_user.id,
        reviewer_email=current_user.email,
        scope=payload.scope,
        findings=payload.findings,
        accounts_reviewed=payload.accounts_reviewed,
        changes_required=payload.changes_required,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(review)
    await audit_chain.append_security_event(
        db,
        event_type="access_review_recorded",
        description=f"Access review recorded ({payload.period_start.date()} to {payload.period_end.date()})",
        actor_email=current_user.email,
        detail={"review_id": review.id, "changes_required": payload.changes_required},
    )
    await db.commit()
    return {"id": review.id, "reviewer_email": review.reviewer_email,
            "completed_at": _iso(review.completed_at)}


@router.get("/compliance/access-reviews")
async def list_access_reviews(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(AccessReview).order_by(AccessReview.created_at.desc()).limit(100)
    )).scalars().all()
    return [{"id": r.id, "period_start": _iso(r.period_start), "period_end": _iso(r.period_end),
             "reviewer_email": r.reviewer_email, "scope": r.scope, "findings": r.findings,
             "accounts_reviewed": r.accounts_reviewed, "changes_required": r.changes_required,
             "completed_at": _iso(r.completed_at)} for r in rows]


# ---------------------------------------------------------------------------
# Risk register (SOC2-01) and restore drills (ISO-06)
# ---------------------------------------------------------------------------

def _risk_out(r: RiskRegisterEntry) -> dict:
    return {
        "id": r.id,
        "risk_key": r.risk_key,
        "title": r.title,
        "description": r.description,
        "category": r.category,
        "likelihood": r.likelihood,
        "impact": r.impact,
        "inherent_score": r.inherent_score,
        "treatment": r.treatment,
        "treatment_notes": r.treatment_notes,
        "residual_likelihood": r.residual_likelihood,
        "residual_impact": r.residual_impact,
        "residual_score": r.residual_score,
        "owner": r.owner,
        "status": r.status,
        "control_refs": r.control_refs,
        "next_review_at": _iso(r.next_review_at),
        "closed_at": _iso(r.closed_at),
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
    }


@router.get("/compliance/risks")
async def list_risks(
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The risk register with a summary; scores were computed at write time."""
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_risks_seeded(db)
    query = select(RiskRegisterEntry).order_by(RiskRegisterEntry.inherent_score.desc())
    if status:
        query = query.where(RiskRegisterEntry.status == status)
    rows = (await db.execute(query)).scalars().all()
    open_rows = [r for r in rows if r.status != "closed"]
    return {
        "summary": {
            "total": len(rows),
            "open": len(open_rows),
            "top_inherent": max((r.inherent_score for r in open_rows), default=0),
            "max_residual": max((r.residual_score for r in open_rows), default=0),
            "due_for_review": sum(
                1 for r in open_rows
                if r.next_review_at is not None
                and r.next_review_at.replace(tzinfo=r.next_review_at.tzinfo or timezone.utc)
                <= datetime.now(timezone.utc)
            ),
        },
        "risks": [_risk_out(r) for r in rows],
    }


@router.post("/compliance/risks", status_code=201)
async def create_risk(
    payload: RiskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_risks_seeded(db)
    # Human-facing key continues after the highest existing RSK number.
    existing_keys = (await db.execute(
        select(RiskRegisterEntry.risk_key)
    )).scalars().all()
    numbers = []
    for key in existing_keys:
        try:
            numbers.append(int(key.rsplit("-", 1)[-1]))
        except (ValueError, AttributeError):
            continue
    risk_key = f"RSK-{(max(numbers) + 1) if numbers else 1:03d}"

    risk = RiskRegisterEntry(
        risk_key=risk_key,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        likelihood=payload.likelihood,
        impact=payload.impact,
        inherent_score=payload.likelihood * payload.impact,  # server-computed
        treatment=payload.treatment,
        treatment_notes=payload.treatment_notes,
        residual_likelihood=payload.residual_likelihood,
        residual_impact=payload.residual_impact,
        residual_score=payload.residual_likelihood * payload.residual_impact,
        owner=payload.owner,
        status="open",
        control_refs=payload.control_refs,
        next_review_at=payload.next_review_at,
    )
    db.add(risk)
    await audit_chain.append_security_event(
        db,
        event_type="risk_registered",
        description=f"Risk {risk_key} registered: {payload.title}",
        actor_email=current_user.email,
        detail={"risk_key": risk_key, "inherent_score": risk.inherent_score,
                "treatment": risk.treatment},
    )
    await db.commit()
    return _risk_out(risk)


@router.patch("/compliance/risks/{risk_id}")
async def update_risk(
    risk_id: str,
    payload: RiskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    risk = (await db.execute(
        select(RiskRegisterEntry).where(RiskRegisterEntry.id == risk_id)
    )).scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="risk not found")

    changed = []
    for field in ("title", "description", "category", "treatment", "treatment_notes",
                  "owner", "control_refs", "next_review_at"):
        value = getattr(payload, field)
        if value is not None:
            setattr(risk, field, value)
            changed.append(field)
    # Scores recomputed server-side whenever a scale component changes.
    if payload.likelihood is not None:
        risk.likelihood = payload.likelihood
        changed.append("likelihood")
    if payload.impact is not None:
        risk.impact = payload.impact
        changed.append("impact")
    if payload.residual_likelihood is not None:
        risk.residual_likelihood = payload.residual_likelihood
        changed.append("residual_likelihood")
    if payload.residual_impact is not None:
        risk.residual_impact = payload.residual_impact
        changed.append("residual_impact")
    risk.inherent_score = risk.likelihood * risk.impact
    risk.residual_score = risk.residual_likelihood * risk.residual_impact

    if payload.status is not None:
        if payload.status == "closed" and risk.status != "closed":
            risk.closed_at = datetime.now(timezone.utc)
        elif payload.status != "closed":
            risk.closed_at = None
        risk.status = payload.status
        changed.append("status")

    await audit_chain.append_security_event(
        db,
        event_type="risk_updated",
        description=f"Risk {risk.risk_key} updated ({', '.join(changed) or 'no changes'})",
        actor_email=current_user.email,
        detail={"risk_key": risk.risk_key, "fields": changed,
                "inherent_score": risk.inherent_score, "residual_score": risk.residual_score,
                "status": risk.status},
    )
    await db.commit()
    return _risk_out(risk)


# ---------------------------------------------------------------------------
# Change control (ISO-09) - four-eyes workflow
# ---------------------------------------------------------------------------

# Emergency changes may be implemented before review (that is what makes them
# emergency), but the retroactive review has a deadline. The list endpoint
# ages overdue emergencies visibly instead of hiding the gap.
_EMERGENCY_REVIEW_SLACK = timedelta(hours=48)


def _change_out(c: ChangeRequest, now: Optional[datetime] = None) -> dict:
    created = _utc_aware(c.created_at)
    emergency_review_overdue = (
        c.change_type == "emergency"
        and c.status == "proposed"
        and created is not None
        and (now or datetime.now(timezone.utc)) - created > _EMERGENCY_REVIEW_SLACK
    )
    return {
        "id": c.id,
        "change_key": c.change_key,
        "title": c.title,
        "description": c.description,
        "change_type": c.change_type,
        "risk_notes": c.risk_notes,
        "control_refs": c.control_refs,
        "status": c.status,
        "requested_by": c.requested_by,
        "reviewed_by": c.reviewed_by,
        "review_notes": c.review_notes,
        "decided_at": _iso(c.decided_at),
        "implemented_at": _iso(c.implemented_at),
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
        "emergency_review_overdue": emergency_review_overdue,
    }


async def _next_change_key(db: AsyncSession) -> str:
    numbers = []
    for key in (await db.execute(select(ChangeRequest.change_key))).scalars().all():
        try:
            numbers.append(int(key.rsplit("-", 1)[-1]))
        except (ValueError, AttributeError):
            continue
    return f"CHG-{(max(numbers) + 1) if numbers else 1:03d}"


@router.get("/compliance/changes")
async def list_changes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(ChangeRequest).order_by(ChangeRequest.created_at.desc())
    )).scalars().all()
    now = datetime.now(timezone.utc)
    items = [_change_out(c, now) for c in rows]
    return {
        "summary": {
            "total": len(items),
            "proposed": sum(1 for i in items if i["status"] == "proposed"),
            "approved": sum(1 for i in items if i["status"] == "approved"),
            "implemented": sum(1 for i in items if i["status"] == "implemented"),
            "rejected": sum(1 for i in items if i["status"] == "rejected"),
            "emergency_review_overdue": sum(
                1 for i in items if i["emergency_review_overdue"]),
        },
        "review_slack_hours": int(_EMERGENCY_REVIEW_SLACK.total_seconds() // 3600),
        "changes": items,
    }


@router.post("/compliance/changes", status_code=201)
async def propose_change(
    payload: ChangeCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    change = ChangeRequest(
        change_key=await _next_change_key(db),
        title=payload.title,
        description=payload.description,
        change_type=payload.change_type,
        risk_notes=payload.risk_notes,
        control_refs=payload.control_refs,
        status="proposed",
        requested_by=current_user.email,
    )
    db.add(change)
    await audit_chain.append_security_event(
        db,
        event_type="change_proposed",
        description=f"Change {change.change_key} proposed: {payload.title}",
        actor_email=current_user.email,
        detail={"change_key": change.change_key, "change_type": change.change_type},
    )
    await db.commit()
    return _change_out(change)


@router.post("/compliance/changes/{change_id}/decision")
async def decide_change(
    change_id: str,
    payload: ChangeDecision,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    change = (await db.execute(
        select(ChangeRequest).where(ChangeRequest.id == change_id)
    )).scalar_one_or_none()
    if change is None:
        raise HTTPException(status_code=404, detail="change not found")
    if change.status != "proposed":
        raise HTTPException(
            status_code=409,
            detail=f"change is {change.status}; only proposed changes can be decided",
        )
    # Four-eyes: the approver must differ from the requester. Self-approval
    # would make the workflow a rubber stamp, so it is refused server-side.
    if change.requested_by == current_user.email:
        raise HTTPException(
            status_code=422,
            detail="four-eyes: the reviewer must differ from the requester",
        )
    change.status = payload.decision
    change.reviewed_by = current_user.email
    change.review_notes = payload.review_notes
    change.decided_at = datetime.now(timezone.utc)
    await audit_chain.append_security_event(
        db,
        event_type="change_decided",
        description=f"Change {change.change_key} {payload.decision} by {current_user.email}",
        actor_email=current_user.email,
        detail={"change_key": change.change_key, "decision": payload.decision},
    )
    await db.commit()
    return _change_out(change)


@router.post("/compliance/changes/{change_id}/implement")
async def implement_change(
    change_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    change = (await db.execute(
        select(ChangeRequest).where(ChangeRequest.id == change_id)
    )).scalar_one_or_none()
    if change is None:
        raise HTTPException(status_code=404, detail="change not found")
    # Emergency changes may be implemented while still proposed (retroactive
    # review remains due and visible); everything else needs approval first.
    if change.status != "approved" and not (
        change.change_type == "emergency" and change.status == "proposed"
    ):
        raise HTTPException(
            status_code=409,
            detail=f"change is {change.status}; only approved (or emergency-proposed) changes can be implemented",
        )
    change.status = "implemented"
    change.implemented_at = datetime.now(timezone.utc)
    await audit_chain.append_security_event(
        db,
        event_type="change_implemented",
        description=f"Change {change.change_key} implemented",
        actor_email=current_user.email,
        detail={"change_key": change.change_key,
                "reviewed_before_implement": bool(change.reviewed_by)},
    )
    await db.commit()
    return _change_out(change)


# ---------------------------------------------------------------------------
# Vendor security reviews (SOC2-03) - questionnaire register
# ---------------------------------------------------------------------------

_VENDOR_OUTCOMES_REQUIRING_REVIEW = ("approved", "conditional")


def _utc_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite returns naive datetimes; comparisons need a consistent clock."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _vendor_out(v: VendorReview, now: Optional[datetime] = None) -> dict:
    next_due = _utc_aware(v.next_review_due)
    review_overdue = (
        v.outcome in _VENDOR_OUTCOMES_REQUIRING_REVIEW
        and next_due is not None
        and next_due < (now or datetime.now(timezone.utc))
    )
    return {
        "id": v.id,
        "vendor_key": v.vendor_key,
        "vendor_name": v.vendor_name,
        "service_provided": v.service_provided,
        "data_access_level": v.data_access_level,
        "personal_data": v.personal_data,
        "hosting_region": v.hosting_region,
        "reviewed_at": _iso(v.reviewed_at),
        "reviewer": v.reviewer,
        "questionnaire": v.questionnaire,
        "outcome": v.outcome,
        "findings": v.findings,
        "next_review_due": _iso(next_due),
        "control_refs": v.control_refs,
        "created_at": _iso(v.created_at),
        "updated_at": _iso(v.updated_at),
        "review_overdue": review_overdue,
    }


def _vendor_review_date_ok(outcome: str, next_review_due: Optional[datetime]) -> bool:
    """Approved/conditional outcomes must carry a next-review date - the
    register ages visibly instead of silently."""
    if outcome in _VENDOR_OUTCOMES_REQUIRING_REVIEW:
        return next_review_due is not None
    return True


@router.get("/compliance/vendors")
async def list_vendor_reviews(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_vendor_reviews_seeded(db)
    rows = (await db.execute(
        select(VendorReview).order_by(VendorReview.vendor_key)
    )).scalars().all()
    now = datetime.now(timezone.utc)
    items = [_vendor_out(v, now) for v in rows]
    return {
        "summary": {
            "total": len(items),
            "approved": sum(1 for i in items if i["outcome"] == "approved"),
            "conditional": sum(1 for i in items if i["outcome"] == "conditional"),
            "rejected": sum(1 for i in items if i["outcome"] == "rejected"),
            "pending": sum(1 for i in items if i["outcome"] == "pending"),
            "review_overdue": sum(1 for i in items if i["review_overdue"]),
            "with_personal_data": sum(1 for i in items if i["personal_data"]),
        },
        "vendors": items,
    }


@router.post("/compliance/vendors", status_code=201)
async def create_vendor_review(
    payload: VendorCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_vendor_reviews_seeded(db)
    if not _vendor_review_date_ok(payload.outcome, payload.next_review_due):
        raise HTTPException(
            status_code=422,
            detail="outcome approved/conditional requires next_review_due",
        )
    numbers = []
    for key in (await db.execute(select(VendorReview.vendor_key))).scalars().all():
        try:
            numbers.append(int(key.rsplit("-", 1)[-1]))
        except (ValueError, AttributeError):
            continue
    review = VendorReview(
        vendor_key=f"VND-{(max(numbers) + 1) if numbers else 1:03d}",
        vendor_name=payload.vendor_name,
        service_provided=payload.service_provided,
        data_access_level=payload.data_access_level,
        personal_data=payload.personal_data,
        hosting_region=payload.hosting_region,
        reviewed_at=payload.reviewed_at or datetime.now(timezone.utc),
        reviewer=payload.reviewer,
        questionnaire=payload.questionnaire,
        outcome=payload.outcome,
        findings=payload.findings,
        next_review_due=payload.next_review_due,
        control_refs=payload.control_refs,
    )
    db.add(review)
    await audit_chain.append_security_event(
        db,
        event_type="vendor_reviewed",
        description=f"Vendor review {review.vendor_key}: {payload.vendor_name} ({payload.outcome})",
        actor_email=current_user.email,
        detail={"vendor_key": review.vendor_key, "outcome": payload.outcome,
                "data_access_level": payload.data_access_level,
                "personal_data": payload.personal_data},
    )
    await db.commit()
    return _vendor_out(review)


@router.patch("/compliance/vendors/{vendor_id}")
async def update_vendor_review(
    vendor_id: str,
    payload: VendorUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    review = (await db.execute(
        select(VendorReview).where(VendorReview.id == vendor_id)
    )).scalar_one_or_none()
    if review is None:
        raise HTTPException(status_code=404, detail="vendor review not found")

    changed = []
    for field in ("vendor_name", "service_provided", "data_access_level",
                  "personal_data", "hosting_region", "reviewer", "questionnaire",
                  "findings", "control_refs"):
        value = getattr(payload, field)
        if value is not None:
            setattr(review, field, value)
            changed.append(field)
    if payload.outcome is not None:
        review.outcome = payload.outcome
        changed.append("outcome")
    if payload.next_review_due is not None:
        review.next_review_due = payload.next_review_due
        changed.append("next_review_due")
    # A re-review (any content change on a decided row) re-stamps the review
    # metadata so the register reflects who last looked and when.
    if changed:
        review.reviewed_at = datetime.now(timezone.utc)
        review.reviewer = payload.reviewer or current_user.email
    if not _vendor_review_date_ok(review.outcome, review.next_review_due):
        raise HTTPException(
            status_code=422,
            detail="outcome approved/conditional requires next_review_due",
        )

    await audit_chain.append_security_event(
        db,
        event_type="vendor_review_updated",
        description=f"Vendor review {review.vendor_key} updated ({', '.join(changed) or 'no changes'})",
        actor_email=current_user.email,
        detail={"vendor_key": review.vendor_key, "fields": changed,
                "outcome": review.outcome},
    )
    await db.commit()
    return _vendor_out(review)


@router.post("/compliance/restore-drills", status_code=201)
async def record_restore_drill(
    payload: RestoreDrillIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record the evidence of one executed restore drill.

    The drill itself runs offline via scripts/restore_drill.py (restore into
    a scratch database, integrity check, row counts, audit-chain
    re-verification). This endpoint archives the harness output verbatim;
    it deliberately does not re-run or re-judge the verification, because a
    server that judged its own backups would be grading its own homework.
    """
    await _require_platform_admin(current_user)
    drill = RestoreDrill(
        source=payload.source,
        rows_recovered=payload.rows_recovered,
        tables_checked=payload.tables_checked,
        chain_valid=payload.chain_valid,
        drill_output=payload.drill_output,
        performed_by=payload.performed_by or current_user.email,
        passed=bool(payload.chain_valid) if payload.passed is None else payload.passed,
        notes=payload.notes,
        executed_at=payload.executed_at or datetime.now(timezone.utc),
    )
    db.add(drill)
    await audit_chain.append_security_event(
        db,
        event_type="restore_drill_recorded",
        description=f"Restore drill recorded from {payload.source}: "
                    f"chain_valid={payload.chain_valid}, passed={drill.passed}",
        actor_email=current_user.email,
        detail={"drill_id": drill.id, "passed": drill.passed,
                "rows_recovered": drill.rows_recovered},
    )
    await db.commit()
    return {
        "id": drill.id,
        "source": drill.source,
        "rows_recovered": drill.rows_recovered,
        "tables_checked": drill.tables_checked,
        "chain_valid": drill.chain_valid,
        "passed": drill.passed,
        "executed_at": _iso(drill.executed_at),
        "recorded_at": _iso(drill.recorded_at),
    }


@router.get("/compliance/restore-drills")
async def list_restore_drills(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_platform_admin(current_user)
    rows = (await db.execute(
        select(RestoreDrill).order_by(RestoreDrill.executed_at.desc()).limit(100)
    )).scalars().all()
    return [{
        "id": d.id,
        "source": d.source,
        "rows_recovered": d.rows_recovered,
        "tables_checked": d.tables_checked,
        "chain_valid": d.chain_valid,
        "passed": d.passed,
        "performed_by": d.performed_by,
        "notes": d.notes,
        "drill_output": d.drill_output,
        "executed_at": _iso(d.executed_at),
        "recorded_at": _iso(d.recorded_at),
    } for d in rows]


@router.get("/compliance/overview")
async def compliance_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Everything the dashboard renders, in one honest aggregate."""
    await _require_platform_admin(current_user)
    await compliance_catalog.ensure_seeded(db)
    await compliance_catalog.ensure_risks_seeded(db)
    await compliance_catalog.ensure_vendor_reviews_seeded(db)

    controls = (await db.execute(select(ComplianceControl))).scalars().all()
    by_framework: dict[str, dict[str, int]] = {}
    for c in controls:
        fw = by_framework.setdefault(c.framework, {s: 0 for s in READINESS_STATES})
        if c.readiness in fw:
            fw[c.readiness] += 1

    dsar_counts = dict(
        (await db.execute(
            select(DsarRequest.state, func.count(DsarRequest.id)).group_by(DsarRequest.state)
        )).all()
    )
    incidents = (await db.execute(select(SecurityIncident))).scalars().all()
    open_incidents = [i for i in incidents if i.status != "resolved"]
    now = datetime.now(timezone.utc)
    overdue = []
    for i in open_incidents:
        if i.authority_notified_at:
            continue
        deadline = i.gdpr_notification_deadline
        if deadline is not None and deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if deadline is not None and deadline <= now:
            overdue.append(i)

    last_review = (await db.execute(
        select(AccessReview).order_by(AccessReview.completed_at.desc()).limit(1)
    )).scalar_one_or_none()

    risk_rows = (await db.execute(select(RiskRegisterEntry))).scalars().all()
    open_risks = [r for r in risk_rows if r.status != "closed"]
    last_drill = (await db.execute(
        select(RestoreDrill).order_by(RestoreDrill.executed_at.desc()).limit(1)
    )).scalar_one_or_none()

    hold_count = (await db.execute(
        select(func.count(LegalHold.id)).where(LegalHold.released_at.is_(None))
    )).scalar()
    policy_count = (await db.execute(select(func.count(RetentionPolicy.id)))).scalar()
    subprocessor_count = (await db.execute(
        select(func.count(Subprocessor.id)).where(Subprocessor.status != "retired")
    )).scalar()

    change_rows = (await db.execute(select(ChangeRequest))).scalars().all()
    vendor_rows = (await db.execute(select(VendorReview))).scalars().all()
    vendor_overdue = sum(
        1 for v in vendor_rows
        if v.outcome in _VENDOR_OUTCOMES_REQUIRING_REVIEW
        and v.next_review_due is not None
        and v.next_review_due.replace(tzinfo=v.next_review_due.tzinfo or timezone.utc) <= now
    )

    chain = await audit_chain.verify_security_chain(db)

    return {
        "readiness_vocabulary": list(READINESS_STATES),
        "certification_claim": None,
        "statement": (
            "Docurama publishes readiness states (Implemented, Partial, Missing, "
            "Needs Review) for its compliance controls. It holds no certifications "
            "and claims none. Evidence references point at real code, tests and "
            "configuration in the repository."
        ),
        "controls": {
            "total": len(controls),
            "by_framework": by_framework,
        },
        "dsar_queue": {state: int(count) for state, count in dsar_counts.items()},
        "incidents": {
            "open": len(open_incidents),
            "notification_overdue": len(overdue),
        },
        "legal_holds_active": int(hold_count or 0),
        "retention_policies": int(policy_count or 0),
        "subprocessors_active_or_planned": int(subprocessor_count or 0),
        "changes": {
            "proposed": sum(1 for c in change_rows if c.status == "proposed"),
            "approved": sum(1 for c in change_rows if c.status == "approved"),
            "implemented": sum(1 for c in change_rows if c.status == "implemented"),
            "emergency_review_overdue": sum(
                1 for c in change_rows
                if c.change_type == "emergency" and c.status == "proposed"
                and c.created_at is not None
                and now - c.created_at.replace(
                    tzinfo=c.created_at.tzinfo or timezone.utc) > _EMERGENCY_REVIEW_SLACK
            ),
        },
        "vendors": {
            "total": len(vendor_rows),
            "review_overdue": vendor_overdue,
        },
        "risks": {
            "open": len(open_risks),
            "top_inherent": max((r.inherent_score for r in open_risks), default=0),
            "max_residual": max((r.residual_score for r in open_risks), default=0),
            "overdue_reviews": sum(
                1 for r in open_risks
                if r.next_review_at is not None
                and r.next_review_at.replace(tzinfo=r.next_review_at.tzinfo or timezone.utc)
                <= now
            ),
        },
        "last_restore_drill": {
            "passed": last_drill.passed,
            "chain_valid": last_drill.chain_valid,
            "executed_at": _iso(last_drill.executed_at),
        } if last_drill else None,
        "last_access_review": {
            "completed_at": _iso(last_review.completed_at),
            "reviewer_email": last_review.reviewer_email,
        } if last_review else None,
        "audit_chain": chain,
    }


# ---------------------------------------------------------------------------
# Public trust center
# ---------------------------------------------------------------------------

@public_router.get("/trust")
async def trust_center(db: AsyncSession = Depends(get_db)):
    """The public trust center payload.

    Factual only: what the platform actually does, which subprocessors are
    engaged, how to report security issues. No badges, no certification
    claims, an empty certifications array, readiness vocabulary in place.
    """
    await compliance_catalog.ensure_seeded(db)
    controls = (await db.execute(select(ComplianceControl))).scalars().all()
    subprocessors = (await db.execute(
        select(Subprocessor).where(Subprocessor.status != "retired")
        .order_by(Subprocessor.added_at.asc())
    )).scalars().all()

    frameworks = {}
    for c in controls:
        frameworks.setdefault(c.framework, []).append({
            "control_id": c.control_id,
            "name": c.name,
            "readiness": c.readiness,
        })

    return {
        "statement": (
            "Docurama's compliance program publishes readiness states for each "
            "control - Implemented, Partial, Missing or Needs Review - with "
            "evidence drawn from the product's own source code and tests. "
            "Docurama holds no certifications and claims none."
        ),
        "certifications": [],
        "security_features": [
            "PAdES digital signatures (B-B through B-LTA) with pyHanko",
            "RFC 3161 trusted timestamps (operator-configured TSA)",
            "SHA-256 document integrity anchoring at ingest and completion",
            "Hash-chained, tamper-evident audit trails with public verification vocabulary",
            "TOTP multi-factor authentication and session revocation",
            "Scoped API keys, hashed at rest",
            "AES-256-GCM encryption at rest for stored documents (operator-activated via key configuration)",
            "DSAR export and erasure workflows with an honest five-state lifecycle",
            "Configurable retention with legal holds",
            "Security incident tracking with the GDPR 72-hour notification clock",
            "Scored risk register with an initial published assessment",
            "Restore-drill harness that re-verifies audit chains on restored backups",
            "Weekly scheduled security scanning (dependencies, containers, secrets) with an SBOM inventory",
            "Structured request logging and rate limiting",
            "Strict security headers including a CSP on every response",
        ],
        "readiness_by_framework": frameworks,
        "subprocessors": [_subprocessor_out(s) for s in subprocessors],
        "security_contact": settings.SECURITY_CONTACT or None,
        "security_txt": "/.well-known/security.txt",
        "gdpr_representative": None,
        "data_locations": "Operator-configured storage backend (local disk or S3-compatible); EU hosting available on sovereign plans.",
    }
