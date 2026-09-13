"""
Host-to-tenant resolution.

The parser is pure so routing rules can be tested without a database; the
resolver turns a parsed host into the account that owns it. Soft-deleted
accounts never resolve: their envelopes must keep verifying, but their
hostname must not serve a workspace.
"""
from dataclasses import dataclass
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Account, DomainVerification
from app.services.tenancy import RESERVED_SUBDOMAINS

PLATFORM = "platform"
SUBDOMAIN = "subdomain"
# Parser-only kind: a host that is not a tenant label under the cloud domain and
# not the platform itself. The DB decides whether it is a claimed custom domain.
CUSTOM = "custom"
CUSTOM_DOMAIN = "custom_domain"
UNKNOWN = "unknown"


def _host_only(value: str) -> str:
    return (value or "").strip().lower().split(":")[0]


def parse_tenant_host(host: str, cloud_domain: str) -> Tuple[str, Optional[str], Optional[str]]:
    host = _host_only(host)
    if not host or host in ("test", "testserver", "localhost", "127.0.0.1"):
        return PLATFORM, None, None

    primary = _host_only(cloud_domain)
    # Recognized cloud root domains (primary active domain plus held docurama.eu)
    valid_roots = [primary] if primary else []
    for fallback in ("docurama.eu",):
        if fallback not in valid_roots:
            valid_roots.append(fallback)

    for root in valid_roots:
        if host == root:
            return PLATFORM, None, None

        suffix = f".{root}"
        if host.endswith(suffix):
            label = host[: -len(suffix)]
            if "." in label:
                return CUSTOM, None, host
            if label in RESERVED_SUBDOMAINS:
                return PLATFORM, None, None
            return SUBDOMAIN, label, None

    return CUSTOM, None, host


@dataclass
class TenantContext:
    kind: str
    label: Optional[str] = None
    domain: Optional[str] = None
    account_id: Optional[str] = None


async def resolve_tenant(db: AsyncSession, host: str) -> TenantContext:
    from app.core.config import settings

    kind, label, custom_domain = parse_tenant_host(host, settings.CLOUD_DOMAIN)

    if kind == PLATFORM:
        return TenantContext(kind=PLATFORM)

    if kind == SUBDOMAIN:
        account_id = (await db.execute(
            select(Account.id).where(
                Account.subdomain == label,
                Account.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if account_id:
            return TenantContext(kind=SUBDOMAIN, label=label, account_id=account_id)
        return TenantContext(kind=UNKNOWN, label=label)

    # A verified custom domain routes to its owner; anything else is unknown.
    row = (await db.execute(
        select(DomainVerification.account_id, Account.deleted_at)
        .join(Account, Account.id == DomainVerification.account_id)
        .where(
            DomainVerification.domain == custom_domain,
            DomainVerification.status == "verified",
        )
    )).first()
    if row and row.deleted_at is None:
        return TenantContext(kind=CUSTOM_DOMAIN, domain=custom_domain,
                             account_id=row.account_id)
    return TenantContext(kind=UNKNOWN, domain=custom_domain)
