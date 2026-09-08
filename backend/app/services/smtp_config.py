"""
Where the mail server settings come from.

SMTP used to be read from environment variables, which is wrong for a platform serving
multiple companies: a tenant that wants signature requests to arrive from its own domain
cannot edit the deployment's environment. It is configured in the product instead,
following the same shape as the other account settings.

Resolution order:

  1. the account's own profile, when it has one and it is enabled
  2. the platform default, set by a platform administrator
  3. nothing, in which case no mail is sent and the audit trail says so

The third case is a first-class outcome, not an error. An envelope still completes and
its audit trail records the failed delivery honestly, rather than claiming a send that
never happened.
"""
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.secrets import decrypt_secret, encrypt_secret
from app.models import AccountSetting, PlatformSetting

SECTION = "smtp"

# The stored shape. The password is held separately and encrypted; it never appears here.
DEFAULT_SMTP_SETTINGS: Dict[str, Any] = {
    "enabled": False,
    "host": "",
    "port": 587,
    "username": "",
    "password_encrypted": "",
    "from_email": "",
    "from_name": "Docurama",
    "use_tls": True,
    "use_ssl": False,
    "timeout": 20,
}

# Never returned to a browser.
_SECRET_FIELDS = {"password_encrypted"}


@dataclass
class SmtpConfig:
    """A resolved, usable mail server profile."""
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    use_tls: bool
    use_ssl: bool
    timeout: int
    # "account" or "platform"; shown in the UI so an operator knows which profile is in use.
    source: str = "account"

    @property
    def is_usable(self) -> bool:
        return bool(self.host and self.from_email)


def redact(stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Project stored settings for display.

    The encrypted password is replaced by a boolean. A write-only credential cannot leak
    through a screenshot, a browser cache or a support session.
    """
    data = dict(DEFAULT_SMTP_SETTINGS)
    if stored:
        data.update(stored)

    out = {k: v for k, v in data.items() if k not in _SECRET_FIELDS}
    out["password_set"] = bool(data.get("password_encrypted"))
    return out


def apply_update(stored: Optional[Dict[str, Any]], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge an update onto what is stored.

    A submitted `password` is encrypted and replaces the stored one. Omitting it leaves
    the existing password in place, so saving an unrelated field from a form that never
    received the password does not wipe it. An explicitly empty password clears it.
    """
    merged = dict(DEFAULT_SMTP_SETTINGS)
    if stored:
        merged.update(stored)

    incoming = dict(incoming or {})
    password = incoming.pop("password", None)

    # password_encrypted is derived, never accepted from a client.
    incoming.pop("password_encrypted", None)
    incoming.pop("password_set", None)

    for key, value in incoming.items():
        if key in DEFAULT_SMTP_SETTINGS:
            merged[key] = value

    if password is not None:
        merged["password_encrypted"] = encrypt_secret(password) if password else ""

    return merged


def to_config(data: Dict[str, Any], source: str) -> Optional[SmtpConfig]:
    """Build a usable config from stored settings, or None when it is not usable."""
    if not data or not data.get("enabled"):
        return None

    host = (data.get("host") or "").strip()
    from_email = (data.get("from_email") or "").strip()
    if not host or not from_email:
        return None

    # A password that will not decrypt means SECRET_KEY was rotated. Treating it as an
    # empty string would attempt an authenticated send with the wrong credential and
    # surface as a confusing rejection from the mail server.
    stored_password = data.get("password_encrypted") or ""
    password = decrypt_secret(stored_password) if stored_password else ""
    if stored_password and password is None:
        print(
            "[SMTP] Stored password could not be decrypted; DOCURAMA_SECRET_KEY has "
            f"probably been rotated. Re-enter the password for {host}."
        )
        return None

    return SmtpConfig(
        host=host,
        port=int(data.get("port") or 587),
        username=data.get("username") or "",
        password=password or "",
        from_email=from_email,
        from_name=data.get("from_name") or "Docurama",
        use_tls=bool(data.get("use_tls", True)),
        use_ssl=bool(data.get("use_ssl", False)),
        timeout=int(data.get("timeout") or 20),
        source=source,
    )


async def get_account_settings(db: AsyncSession, account_id: str) -> Optional[Dict[str, Any]]:
    if not account_id:
        return None
    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == SECTION,
        )
    )).scalar_one_or_none()
    return row.data if row else None


async def get_platform_settings(db: AsyncSession) -> Optional[Dict[str, Any]]:
    row = (await db.execute(
        select(PlatformSetting).where(PlatformSetting.section == SECTION)
    )).scalar_one_or_none()
    return row.data if row else None


async def resolve(db: AsyncSession, account_id: Optional[str]) -> Optional[SmtpConfig]:
    """
    Resolve the profile to send an account's mail with, or None when none is usable.
    """
    account_config = to_config(await get_account_settings(db, account_id), "account")
    if account_config:
        return account_config

    return to_config(await get_platform_settings(db), "platform")
