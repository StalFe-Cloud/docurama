"""
Deployment capability registry.

One honest table of what each deployment mode switches on, instead of mode-string
comparisons scattered through routers. Self-host keeps every platform capability
off: there is no billing to enforce, no subdomain to route, and a capability that
accidentally lights up on a private deployment would be a defect, not a feature.
"""
from dataclasses import dataclass

from app.core import config


@dataclass(frozen=True)
class Capabilities:
    tenant_subdomains: bool      # <subdomain>.<cloud domain> routes to a tenant
    custom_domain_routing: bool  # a verified customer domain routes to its tenant
    billing: bool                # plans, subscriptions, checkout
    quotas: bool                 # per-account envelope/storage/seat limits


_CLOUD = Capabilities(
    tenant_subdomains=True,
    custom_domain_routing=True,
    billing=True,
    quotas=True,
)
_SELFHOST = Capabilities(
    tenant_subdomains=False,
    custom_domain_routing=False,
    billing=False,
    quotas=False,
)


def capabilities_for(mode: str) -> Capabilities:
    return _CLOUD if (mode or "").strip().lower() == "cloud" else _SELFHOST


def current_capabilities() -> Capabilities:
    return capabilities_for(config.settings.DEPLOYMENT_MODE)
