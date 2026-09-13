"""
Tenant context dependencies.

current_tenant answers "which tenant, if any, does this host belong to".
require_tenant_binding answers "may this session act on this host's tenant".
Platform hosts (the marketing domain, app., api., reserved names) never raise:
the platform is every tenant's front door.
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.capabilities import current_capabilities
from app.core.database import get_db
from app.core.tenant_middleware import TenantHostMiddleware  # noqa: F401  (re-export)
from app.api.auth import get_current_user
from app.models import User
from app.services.tenant_resolver import (
    PLATFORM,
    UNKNOWN,
    TenantContext,
    resolve_tenant,
)


def _tenant_routing_enabled() -> bool:
    caps = current_capabilities()
    return caps.tenant_subdomains or caps.custom_domain_routing


async def current_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    cached = getattr(request.state, "tenant_context", None)
    if cached is not None:
        return cached
    if not _tenant_routing_enabled():
        context = TenantContext(kind=PLATFORM)
    else:
        context = await resolve_tenant(db, getattr(request.state, "tenant_host", ""))
    request.state.tenant_context = context
    return context


async def require_tenant_binding(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    context = await current_tenant(request, db)
    rejection = await binding_rejection(db, request, current_user)
    if rejection is not None:
        raise rejection
    return context


async def binding_rejection(db: AsyncSession, request: Request, user: User):
    """
    The reason an authenticated request may not proceed on this host, if any.

    Called from get_current_user so the guard covers every authenticated endpoint
    (writes included), not just the routers that declare the dependency. Platform
    hosts never reject: the platform is every tenant's front door.
    """
    if not _tenant_routing_enabled():
        return None
    context = await current_tenant(request, db)
    if context.kind == PLATFORM:
        return None
    if context.kind == UNKNOWN:
        return HTTPException(status_code=404, detail="Unknown workspace.")
    if context.account_id and user.account_id != context.account_id:
        return HTTPException(
            status_code=403,
            detail="This workspace is not served here. Sign in at the platform root.",
        )
    return None
