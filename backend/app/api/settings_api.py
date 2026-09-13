"""
Account settings, API keys, and signing certificate metadata.

The settings screen previously rendered these from hardcoded arrays in the React
component, so nothing survived a page reload. Every endpoint here is scoped to the
caller's active account, following the same pattern as envelopes and templates.
"""
import asyncio
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.auth import get_current_user
from app.api.quotas import require_paid_write
from app.core.database import get_db
from app.models import AccountSetting, ApiKey, PlatformSetting, SigningCertificate, User
from app.services import audit_chain
from app.schemas import (
    AccountSettingOut,
    AccountSettingUpdate,
    ApiKeyCreate,
    ApiKeyCreatedOut,
    ApiKeyOut,
    DeliverabilityCheckRequest,
    SigningCertificateCreate,
    SigningCertificateOut,
    SmtpSettingsOut,
    SmtpSettingsUpdate,
    SmtpTestRequest,
    SmtpTestResult,
)
from app.services import api_keys as api_key_service
from app.services import mail_deliverability, mailer, smtp_config
from app.services.account_settings import defaults_for, is_valid_section, merge_section

router = APIRouter(tags=["settings"])

# Credential fields stored inside a settings section that must never be handed
# back to a reader. They are write-only: GET replaces each with a *_set boolean,
# and PUT treats an omitted or empty value as "keep what is stored", so saving
# a form that never received the secret cannot wipe it (mirroring smtp_config).
CHANNEL_SECRET_SECTION = "sms"
CHANNEL_SECRET_FIELDS = {"auth_token", "bot_token", "access_token"}


def _require_workspace_admin(current_user: User) -> None:
    """Gateway/mailer credentials redirect outbound signing mail and OTP codes.
    A plain member must not be able to repoint them."""
    if (current_user.role or "").strip().lower() not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a workspace administrator can change these settings.",
        )


def _redact_section(section: str, data: dict) -> dict:
    """Project a stored section for display, swapping secrets for *_set flags."""
    if section != CHANNEL_SECRET_SECTION or not isinstance(data, dict):
        return data
    out = dict(data)
    for field in CHANNEL_SECRET_FIELDS:
        if field in out:
            out[f"{field}_set"] = bool(out.get(field))
            out[field] = ""
    return out


def _apply_secret_write_only(section: str, stored: dict, incoming: dict) -> dict:
    """Drop empty secret values from an update so they cannot clear stored ones."""
    if section != CHANNEL_SECRET_SECTION:
        return incoming
    incoming = dict(incoming or {})
    for field in CHANNEL_SECRET_FIELDS:
        value = incoming.get(field)
        if field in incoming and (value is None or str(value).strip() == ""):
            del incoming[field]
    return incoming



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
        return AccountSettingOut(section=section, data=_redact_section(section, defaults_for(section)))

    return AccountSettingOut(section=row.section, data=_redact_section(section, row.data or {}), updated_at=row.updated_at)


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
    if section == CHANNEL_SECRET_SECTION:
        _require_workspace_admin(current_user)

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == section,
        )
    )).scalar_one_or_none()

    merged = merge_section(section, row.data if row else {}, _apply_secret_write_only(section, row.data if row else {}, payload.data or {}))

    if row:
        row.data = merged
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = AccountSetting(account_id=account_id, section=section, data=merged)
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return AccountSettingOut(section=row.section, data=_redact_section(section, row.data or {}), updated_at=row.updated_at)


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------

@router.get("/api-keys", response_model=List[ApiKeyOut])
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Keys are workspace credentials: visibility follows the same admin gate
    # as minting, so a member cannot enumerate live machine credentials.
    _require_workspace_admin(current_user)
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
    current_user: User = Depends(require_paid_write),
    db: AsyncSession = Depends(get_db),
):
    """Mint a key. The plaintext is returned here and cannot be retrieved again."""
    # A minted key is a persistent, session-independent credential over the
    # whole workspace. Same boundary as SMTP and billing: admins only. A
    # member could otherwise turn a browser session into a durable token.
    _require_workspace_admin(current_user)
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
    await audit_chain.safe_append(
        db, event_type="api_key_created", severity="warning",
        account_id=account_id, actor_user_id=current_user.id,
        actor_email=current_user.email,
        description=f"API key '{row.name}' created (prefix {prefix})",
        detail={"key_id": row.id, "scopes": row.scopes},
    )
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
    await audit_chain.safe_append(
        db, event_type="api_key_revoked", severity="warning",
        account_id=account_id, actor_user_id=current_user.id,
        actor_email=current_user.email,
        description=f"API key '{row.name}' revoked",
        detail={"key_id": row.id},
    )
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
    current_user: User = Depends(require_paid_write),
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


# ---------------------------------------------------------------------------
# Mail server profile
#
# Separate from the generic settings sections above, which return stored data
# verbatim. The mail profile holds an encrypted credential, so it is redacted on
# read and encrypted on write, and it resolves through a platform default.
# ---------------------------------------------------------------------------

def _require_platform_admin(current_user: User) -> None:
    if not getattr(current_user, "is_platform_admin", False):
        raise HTTPException(
            status_code=403,
            detail="Only a platform administrator can change deployment-wide settings.",
        )


async def _smtp_out(db: AsyncSession, stored, scope: str, account_id) -> SmtpSettingsOut:
    """Redact for display and report which profile mail would actually go out through."""
    effective = await smtp_config.resolve(db, account_id)
    return SmtpSettingsOut(
        **smtp_config.redact(stored),
        effective_source=effective.source if effective else None,
        scope=scope,
    )


@router.get("/settings/smtp/account", response_model=SmtpSettingsOut)
async def get_account_smtp(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account_id = _require_account(current_user)
    stored = await smtp_config.get_account_settings(db, account_id)
    return await _smtp_out(db, stored, "account", account_id)


@router.put("/settings/smtp/account", response_model=SmtpSettingsOut)
async def update_account_smtp(
    payload: SmtpSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # The account SMTP server receives every signing-link mail; a member able to
    # repoint it would receive other people's documents.
    _require_workspace_admin(current_user)
    account_id = _require_account(current_user)

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == smtp_config.SECTION,
        )
    )).scalar_one_or_none()

    merged = smtp_config.apply_update(row.data if row else None, payload.model_dump(exclude_unset=True))

    if row:
        row.data = merged
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = AccountSetting(account_id=account_id, section=smtp_config.SECTION, data=merged)
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return await _smtp_out(db, row.data, "account", account_id)


@router.get("/platform/settings/smtp", response_model=SmtpSettingsOut)
async def get_platform_smtp(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_platform_admin(current_user)
    stored = await smtp_config.get_platform_settings(db)
    return await _smtp_out(db, stored, "platform", current_user.account_id)


@router.put("/platform/settings/smtp", response_model=SmtpSettingsOut)
async def update_platform_smtp(
    payload: SmtpSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_platform_admin(current_user)

    row = (await db.execute(
        select(PlatformSetting).where(PlatformSetting.section == smtp_config.SECTION)
    )).scalar_one_or_none()

    merged = smtp_config.apply_update(row.data if row else None, payload.model_dump(exclude_unset=True))

    if row:
        row.data = merged
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = PlatformSetting(section=smtp_config.SECTION, data=merged)
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return await _smtp_out(db, row.data, "platform", current_user.account_id)


@router.post("/settings/smtp/test", response_model=SmtpTestResult)
async def send_test_email(
    payload: SmtpTestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send a test message through whichever profile resolves for this account.

    Catching a wrong password here is the difference between an operator fixing it in
    the moment and a signer never receiving an invitation, with only an audit entry to
    show for it.
    """
    account_id = _require_account(current_user)
    config = await smtp_config.resolve(db, account_id)

    if not mailer.is_configured(config):
        return SmtpTestResult(
            sent=False,
            source=None,
            message=(
                "No mail server is configured for this company, and no platform default "
                "is available."
            ),
        )

    subject, html, text = mailer.smtp_test_message(config.from_email, config.source)
    result = await asyncio.to_thread(
        mailer.send_email, config, payload.to_email, "", subject, html, text
    )

    return SmtpTestResult(
        sent=result.sent,
        source=config.source,
        message=(
            f"Test message delivered to {payload.to_email} using the {config.source} profile."
            if result.sent else f"Delivery failed: {result.error}"
        ),
    )


@router.post("/settings/deliverability")
async def check_deliverability(
    payload: DeliverabilityCheckRequest,
    current_user: User = Depends(get_current_user),
):
    domain = mail_deliverability.sanitize_domain(payload.domain)
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Provide a valid domain, for example example.com.")
    return await mail_deliverability.check_domain(domain)
