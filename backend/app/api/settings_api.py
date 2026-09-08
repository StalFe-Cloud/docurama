"""
Account settings, API keys, and signing certificate metadata.

The settings screen previously rendered these from hardcoded arrays in the React
component, so nothing survived a page reload. Every endpoint here is scoped to the
caller's active account, following the same pattern as envelopes and templates.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.auth import get_current_user
from app.core.database import get_db
from app.models import AccountSetting, ApiKey, SigningCertificate, User
from app.schemas import (
    AccountSettingOut,
    AccountSettingUpdate,
    ApiKeyCreate,
    ApiKeyCreatedOut,
    ApiKeyOut,
    SigningCertificateCreate,
    SigningCertificateOut,
)
from app.services import api_keys as api_key_service
from app.services.account_settings import defaults_for, is_valid_section, merge_section

router = APIRouter(tags=["settings"])


def _require_account(current_user: User) -> str:
    if not current_user.account_id:
        raise HTTPException(status_code=400, detail="No active company selected.")
    return current_user.account_id


# ---------------------------------------------------------------------------
# Per-section settings
# ---------------------------------------------------------------------------

@router.get("/settings/{section}", response_model=AccountSettingOut)
async def get_setting_section(
    section: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    if not is_valid_section(section):
        raise HTTPException(status_code=404, detail=f"Unknown settings section '{section}'.")

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == section,
        )
    )).scalar_one_or_none()

    if not row:
        # Report the documented defaults rather than an empty object, so the UI
        # renders the same state it would after the first save.
        return AccountSettingOut(section=section, data=defaults_for(section))

    return AccountSettingOut(section=row.section, data=row.data or {}, updated_at=row.updated_at)


@router.put("/settings/{section}", response_model=AccountSettingOut)
async def update_setting_section(
    section: str,
    payload: AccountSettingUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    if not is_valid_section(section):
        raise HTTPException(status_code=404, detail=f"Unknown settings section '{section}'.")

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == section,
        )
    )).scalar_one_or_none()

    merged = merge_section(section, row.data if row else {}, payload.data or {})

    if row:
        row.data = merged
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = AccountSetting(account_id=account_id, section=section, data=merged)
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return AccountSettingOut(section=row.section, data=row.data or {}, updated_at=row.updated_at)


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------

@router.get("/api-keys", response_model=List[ApiKeyOut])
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    rows = (await db.execute(
        select(ApiKey)
        .where(ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at.desc())
    )).scalars().all()
    return [ApiKeyOut.model_validate(r) for r in rows]


@router.post("/api-keys", response_model=ApiKeyCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: ApiKeyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a key. The plaintext is returned here and cannot be retrieved again."""
    account_id = _require_account(current_user)

    plaintext, prefix, hashed = api_key_service.generate_api_key()
    row = ApiKey(
        account_id=account_id,
        created_by_user_id=current_user.id,
        name=(payload.name or "API Key").strip() or "API Key",
        key_prefix=prefix,
        hashed_key=hashed,
        scopes=api_key_service.normalise_scopes(payload.scopes),
        expires_at=api_key_service.expiry_from_days(payload.expires_in_days),
        is_active=True,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    # Built explicitly rather than validated from the ORM row: plaintext_key is a
    # required field that exists only here, never in the database.
    return ApiKeyCreatedOut(
        **ApiKeyOut.model_validate(row).model_dump(),
        plaintext_key=plaintext,
    )


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_200_OK)
async def revoke_api_key(
    key_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    row = (await db.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.account_id == account_id)
    )).scalar_one_or_none()

    if not row or row.revoked_at is not None:
        raise HTTPException(status_code=404, detail="API key not found.")

    # Revoked rather than deleted, so delivery logs referencing it stay resolvable.
    row.is_active = False
    row.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True, "id": key_id, "message": f"Revoked API key '{row.name}'."}


# ---------------------------------------------------------------------------
# Signing certificates
# ---------------------------------------------------------------------------

@router.get("/signing-certificates", response_model=List[SigningCertificateOut])
async def list_signing_certificates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    rows = (await db.execute(
        select(SigningCertificate)
        .where(SigningCertificate.account_id == account_id)
        .order_by(SigningCertificate.created_at.desc())
    )).scalars().all()
    return [SigningCertificateOut.model_validate(r) for r in rows]


@router.post("/signing-certificates", response_model=SigningCertificateOut, status_code=status.HTTP_201_CREATED)
async def register_signing_certificate(
    payload: SigningCertificateCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record metadata for a certificate available to this account. Key material is
    provisioned on the host and is never accepted or stored here.
    """
    account_id = _require_account(current_user)

    row = SigningCertificate(
        account_id=account_id,
        label=payload.label.strip(),
        subject=payload.subject,
        issuer=payload.issuer,
        serial_number=payload.serial_number,
        fingerprint_sha256=payload.fingerprint_sha256,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        is_default=bool(payload.is_default),
        status="active",
    )
    db.add(row)

    if row.is_default:
        await _clear_other_defaults(db, account_id, exclude_id=None)

    await db.commit()
    await db.refresh(row)
    return SigningCertificateOut.model_validate(row)


@router.post("/signing-certificates/{cert_id}/default", response_model=SigningCertificateOut)
async def set_default_signing_certificate(
    cert_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    row = (await db.execute(
        select(SigningCertificate).where(
            SigningCertificate.id == cert_id,
            SigningCertificate.account_id == account_id,
        )
    )).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Signing certificate not found.")

    await _clear_other_defaults(db, account_id, exclude_id=cert_id)
    row.is_default = True
    await db.commit()
    await db.refresh(row)
    return SigningCertificateOut.model_validate(row)


@router.delete("/signing-certificates/{cert_id}", status_code=status.HTTP_200_OK)
async def remove_signing_certificate(
    cert_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    row = (await db.execute(
        select(SigningCertificate).where(
            SigningCertificate.id == cert_id,
            SigningCertificate.account_id == account_id,
        )
    )).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Signing certificate not found.")

    await db.delete(row)
    await db.commit()
    return {"success": True, "id": cert_id}


async def _clear_other_defaults(db: AsyncSession, account_id: str, exclude_id) -> None:
    """Only one certificate per account may be the default."""
    rows = (await db.execute(
        select(SigningCertificate).where(
            SigningCertificate.account_id == account_id,
            SigningCertificate.is_default == True,  # noqa: E712 - SQL expression
        )
    )).scalars().all()
    for other in rows:
        if exclude_id is None or other.id != exclude_id:
            other.is_default = False
