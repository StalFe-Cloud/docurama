"""
Public verification portal.

Every cryptographic claim returned here is derived from an actual inspection of the
document by crypto_engine. Nothing in this module may hard-code a positive result:
if a check did not run, or ran and failed, the response says so.
"""
import asyncio
import os
import shutil
import tempfile
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Request, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models import Envelope, DomainVerification
from app.schemas import VerificationResponse, AuditEventOut
from app.services.crypto_engine import calculate_file_sha256, verify_document_integrity

router = APIRouter(prefix="/verify", tags=["verify"])


def _timestamp_label(crypto_check: Dict[str, Any]) -> Optional[str]:
    """Describe the RFC 3161 timestamp only when one was actually validated."""
    if not crypto_check.get("has_timestamp"):
        return None
    ts = crypto_check.get("timestamp_utc")
    return f"RFC 3161 timestamp verified ({ts})" if ts else "RFC 3161 timestamp verified"


async def _issuer_domain(account_id: Optional[str], db: AsyncSession):
    """Return (is_verified, domain) for the issuing account's DNS attestation."""
    if not account_id:
        return False, None
    query = select(DomainVerification).where(
        DomainVerification.account_id == account_id,
        DomainVerification.status == "verified",
    )
    domain = (await db.execute(query)).scalars().first()
    return (True, domain.domain) if domain else (False, None)


def _crypto_fields(crypto_check: Dict[str, Any]) -> Dict[str, Any]:
    """Project the engine's observations onto the response, defaulting to negative."""
    return {
        "certificate_subject": crypto_check.get("signer_subject"),
        "certificate_issuer": crypto_check.get("signer_issuer"),
        "timestamp_rfc3161": _timestamp_label(crypto_check),
        "pades_ltv_verified": bool(crypto_check.get("pades_ltv_verified", False)),
        "has_digital_signature": bool(crypto_check.get("has_digital_signature", False)),
        "signature_intact": bool(crypto_check.get("signature_intact", False)),
        "has_timestamp": bool(crypto_check.get("has_timestamp", False)),
        "timestamp_utc": crypto_check.get("timestamp_utc"),
        "pades_level": crypto_check.get("pades_level"),
    }


@router.get("", response_model=VerificationResponse)
async def verify_by_code(
    code: str = Query(..., description="Envelope verification code or UUID"),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Envelope)
        .where(
            (Envelope.verification_code == code.strip().upper())
            | (Envelope.id == code.strip())
        )
        .options(selectinload(Envelope.audit_events))
    )
    envelope = (await db.execute(query)).scalar_one_or_none()

    if not envelope:
        return VerificationResponse(
            is_valid=False,
            message="No document record found for this verification code.",
        )

    issuer_domain_verified, verified_domain_name = await _issuer_domain(envelope.account_id, db)

    signed_pdf_path = envelope.signed_pdf_path or envelope.original_pdf_path
    crypto_check = (
        await asyncio.to_thread(verify_document_integrity, signed_pdf_path)
        if signed_pdf_path else {}
    )

    seal_status = getattr(envelope, "seal_status", None)
    is_valid = bool(crypto_check.get("is_valid", False))

    message = crypto_check.get("message") or "The document's cryptographic state could not be established."
    if seal_status == "unsealed":
        message = (
            "This document is on record and its audit trail is intact, but no cryptographic "
            "seal was applied when it was completed. " + message
        )
    elif seal_status == "pending" and envelope.status == "completed":
        message = (
            "This document predates cryptographic seal tracking, so its seal state was not "
            "recorded at completion. " + message
        )

    return VerificationResponse(
        is_valid=is_valid,
        envelope_title=envelope.title,
        envelope_id=envelope.id,
        verification_code=envelope.verification_code,
        status=envelope.status,
        completed_at=envelope.completed_at,
        sha256=envelope.sha256_signed or envelope.sha256_original,
        seal_status=seal_status,
        audit_trail=[AuditEventOut.model_validate(a) for a in (envelope.audit_events or [])],
        issuer_domain_verified=issuer_domain_verified,
        verified_domain=verified_domain_name,
        message=message,
        **_crypto_fields(crypto_check),
    )


@router.post("/upload", response_model=VerificationResponse)
@limiter.limit("10/minute")
async def verify_by_upload(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        uploaded_sha = calculate_file_sha256(tmp_path)
        crypto_check = await asyncio.to_thread(verify_document_integrity, tmp_path)

        query = (
            select(Envelope)
            .where(
                (Envelope.sha256_signed == uploaded_sha)
                | (Envelope.sha256_original == uploaded_sha)
            )
            .options(selectinload(Envelope.audit_events))
        )
        envelope = (await db.execute(query)).scalar_one_or_none()

        is_valid = bool(crypto_check.get("is_valid", False))
        base_message = crypto_check.get("message") or "The document could not be verified."

        if not envelope:
            return VerificationResponse(
                is_valid=is_valid,
                sha256=uploaded_sha,
                message=(
                    "This document does not match any record in the Docurama registry. "
                    + base_message
                ),
                **_crypto_fields(crypto_check),
            )

        issuer_domain_verified, verified_domain_name = await _issuer_domain(envelope.account_id, db)
        seal_status = getattr(envelope, "seal_status", None)

        message = f"This document matches Docurama registry record {envelope.verification_code}. " + base_message
        if seal_status == "unsealed":
            message = (
                f"This document matches Docurama registry record {envelope.verification_code}, "
                "but no cryptographic seal was applied when it was completed. " + base_message
            )

        return VerificationResponse(
            is_valid=is_valid,
            envelope_title=envelope.title,
            envelope_id=envelope.id,
            verification_code=envelope.verification_code,
            status=envelope.status,
            completed_at=envelope.completed_at,
            sha256=uploaded_sha,
            seal_status=seal_status,
            audit_trail=[AuditEventOut.model_validate(a) for a in (envelope.audit_events or [])],
            issuer_domain_verified=issuer_domain_verified,
            verified_domain=verified_domain_name,
            message=message,
            **_crypto_fields(crypto_check),
        )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
