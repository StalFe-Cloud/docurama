"""
Tenant naming rules.

A subdomain is decorative in self-host but becomes a routable hostname in cloud
mode, so the rules are enforced at creation time regardless of mode: tightening
later would strand existing names.
"""
import re
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Account

# Hosts that always belong to the platform itself.
RESERVED_SUBDOMAINS = frozenset({
    "www", "app", "api", "mail", "sign", "verify", "trust", "notify",
    "staging", "admin",
    # The ten public hosts of the launch domain architecture (deploy/
    # DOMAIN_SPLIT.md): a workspace must never be able to claim a hostname
    # that the edge routes to the marketing site or a public service.
    "signup", "docs", "help", "status", "sandbox",
})

# A DNS label: 2-40 chars, lowercase letters/digits/hyphens, no lead/trail hyphen.
SUBDOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")


def subdomain_error(candidate: str) -> Optional[str]:
    # Normalization is the caller's job (the endpoint strips and lowercases before
    # asking); this judges the form it is given, so uppercase is a shape error.
    value = (candidate or "").strip()
    if not value:
        return "Subdomain cannot be blank."
    if value in RESERVED_SUBDOMAINS:
        return f"'{value}' is reserved for the platform."
    if not SUBDOMAIN_RE.match(value):
        return (
            "Use 2 to 40 lowercase letters, digits, or hyphens, "
            "starting and ending with a letter or digit."
        )
    return None


async def subdomain_available(db: AsyncSession, candidate: str) -> bool:
    existing = (await db.execute(
        select(Account.id).where(Account.subdomain == candidate)
    )).scalar_one_or_none()
    return existing is None
