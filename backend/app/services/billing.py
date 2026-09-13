"""
Billing service (Sprint 3, P1-26).

The upgrade path used to be a mailto: link. This module is the honest scaffold
for real billing:

- The plan catalog is real and public, and reports exactly which price IDs the
  operator has configured - no pretend values.
- While Stripe credentials are absent (the operator manages them), every
  money-touching endpoint answers a plain 503 explaining what is missing.
  Nothing here fakes a checkout, a subscription, or a cancellation.
- Once credentials are present, checkout/portal/cancel go through Stripe, and
  the webhook - the only path that mutates plan state - verifies signatures
  before trusting a byte of payload.

Cancellation is period-end ("click parity"): what the customer can do in one
click from the app, the API does in one call, and the subscription keeps its
paid benefits until the period they already paid for runs out.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger("docurama.billing")


class BillingNotConfigured(Exception):
    """Raised when a billing operation is attempted without credentials."""


@dataclass(frozen=True)
class PlanDefinition:
    id: str
    display_name: str
    envelopes_per_month: int
    seats: int
    price_setting: str           # monthly Stripe price env (annual appends _ANNUAL)
    description: str
    extra_seat_setting: Optional[str] = None   # Stripe price env for additional seats
    self_serve: bool = True      # False = sales-led (no checkout, by design)


PLAN_CATALOG: Dict[str, PlanDefinition] = {
    "plus": PlanDefinition(
        id="plus",
        display_name="Plus",
        envelopes_per_month=30,
        seats=1,
        price_setting="STRIPE_PRICE_PLUS_MONTHLY",
        description="Professional signing: 30 envelopes per 35-day cycle, unlimited templates, email + SMS OTP, custom branding, webhooks.",
    ),
    "business": PlanDefinition(
        id="business",
        display_name="Business Team",
        envelopes_per_month=250,
        seats=3,
        price_setting="STRIPE_PRICE_BUSINESS_TEAM_MONTHLY",
        extra_seat_setting="STRIPE_PRICE_BUSINESS_TEAM_SEAT",
        description="Teams: 250 pooled envelopes per 35-day cycle across 3 seats (+€15/cycle per extra seat), WhatsApp/Telegram OTP, custom domains, REST API.",
    ),
    "enterprise": PlanDefinition(
        id="enterprise",
        display_name="Enterprise",
        envelopes_per_month=10000,
        seats=100,
        price_setting="",
        description="Sales-led. Custom pricing (reference from €1,500/year), deployment choice: Managed Public Cloud, Managed Private Cloud, On-Premises, Air-Gapped where appropriate.",
        self_serve=False,
    ),
}

# Launch marketing ids -> stable internal plan ids. Retired marketing ids
# (solo/team/business) resolve onto the launch tier owning the same internal
# plan so a stale client cannot resurrect the retired €9/€29/€79 catalog.
MARKETING_PLAN_ALIASES = {"plus": "plus", "business_team": "business", "solo": "plus", "team": "business"}


def resolve_plan_id(plan_id: str) -> Optional[str]:
    """
    Map a marketing or legacy plan id onto the internal catalog id.

    Marketing aliases resolve FIRST. Legacy internal ids that are not
    aliased (enterprise) fall through to the catalog; enterprise is
    sales-led and never self-serve purchasable.
    """
    if not plan_id:
        return None
    key = plan_id.strip().lower()
    mapped = MARKETING_PLAN_ALIASES.get(key)
    if mapped:
        return mapped
    if key in PLAN_CATALOG:
        return key
    return None

# Free/self-host plan names that must never be reachable through checkout.
# "unlimited" is the self-host deployment's plan: self-host is Enterprise
# only, so it is not a Cloud purchase under any circumstances.
NON_PURCHASABLE_PLANS = {"unlimited", "free", "trial"}


def billing_enabled() -> bool:
    """True only when the operator explicitly switched billing on."""
    return bool(getattr(settings, "BILLING_ENABLED", False))


def _price_id(plan: PlanDefinition, interval: str = "monthly") -> str:
    if not plan.price_setting:
        return ""  # sales-led plan: no self-serve price exists
    setting = plan.price_setting
    if interval == "annual":
        setting = plan.price_setting.replace("_MONTHLY", "_ANNUAL")
    return (getattr(settings, setting, "") or "").strip()


def plan_catalog_public() -> Dict[str, Any]:
    """
    The public catalog. Honesty rules: billing_enabled says what it means, and
    configured price ids are empty when the operator has not set them - the
    UI must render that as "coming soon", not as a purchasable plan.
    Enterprise is sales-led and reports no self-serve price by design.
    """
    from app.services.pricing import CYCLE_DAYS, MARKETING_TO_INTERNAL, TRIAL_DAYS

    enabled = billing_enabled()
    internal_to_marketing = {v: k for k, v in MARKETING_TO_INTERNAL.items()}
    return {
        "billing_enabled": enabled,
        "cycle_days": CYCLE_DAYS,
        "trial_days": TRIAL_DAYS,
        "plans": [
            {
                "id": plan.id,
                "marketing_id": internal_to_marketing.get(plan.id),
                "display_name": plan.display_name,
                "envelopes_per_month": plan.envelopes_per_month,
                "seats": plan.seats,
                "description": plan.description,
                "self_serve": plan.self_serve,
                "extra_seat_setting": plan.extra_seat_setting,
                "configured_price_id": _price_id(plan) if enabled else "",
                "configured_price_id_annual": _price_id(plan, "annual") if enabled else "",
            }
            for plan in PLAN_CATALOG.values()
        ],
    }


def require_configured_price(plan_id: str, interval: str = "monthly") -> tuple:
    """
    Resolve a plan (marketing or internal id) and its configured price for
    the billing interval. Enterprise raises a distinct error: it is sales-led
    and must never present a self-serve checkout.
    """
    resolved = resolve_plan_id(plan_id)
    plan = PLAN_CATALOG.get(resolved) if resolved else None
    if plan is None:
        raise ValueError("unknown plan")
    if not plan.self_serve:
        raise BillingNotConfigured(
            "Enterprise is provisioned by our sales team. Contact sales@docurama.eu."
        )
    if interval not in ("monthly", "annual"):
        raise ValueError("unknown interval")
    price_id = _price_id(plan, interval)
    if not billing_enabled() or not price_id:
        raise BillingNotConfigured(
            "Billing is not configured on this deployment. "
            f"Missing: {'STRIPE keys' if not billing_enabled() else (plan.price_setting.replace('_MONTHLY', '_ANNUAL') if interval == 'annual' else plan.price_setting)}."
        )
    return plan, price_id


class StripeAdapter:
    """
    Thin, injectable wrapper over the Stripe SDK. The SDK is imported lazily;
    every method raises BillingNotConfigured before touching Stripe when the
    corresponding credentials are absent.
    """

    def __init__(self, api_key: Optional[str] = None, webhook_secret: Optional[str] = None):
        self._api_key = api_key or (getattr(settings, "STRIPE_SECRET_KEY", "") or "")
        self._webhook_secret = webhook_secret or (
            getattr(settings, "STRIPE_WEBHOOK_SECRET", "") or ""
        )

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _stripe(self):
        if not self._api_key:
            raise BillingNotConfigured("STRIPE_SECRET_KEY is not set")
        import stripe  # optional dependency

        stripe.api_key = self._api_key
        return stripe

    def create_checkout_session(
        self,
        *,
        price_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        stripe = self._stripe()
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            customer_email=customer_email,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=metadata or {},
            # Lifecycle attribution (Sprint 9): session metadata lives and dies
            # with the checkout session. Every later webhook that matters -
            # subscription.updated on renewal, subscription.deleted on
            # cancellation - reads the SUBSCRIPTION's metadata, which is empty
            # unless we explicitly copy ours onto it at creation time.
            subscription_data={"metadata": metadata or {}},
        )
        return {"id": session["id"], "url": session["url"]}

    def create_portal_session(self, *, customer_id: str, return_url: str) -> Dict[str, Any]:
        stripe = self._stripe()
        session = stripe.billing_portal.Session.create(
            customer=customer_id, return_url=return_url
        )
        return {"url": session["url"]}

    def cancel_subscription(self, *, subscription_id: str) -> Dict[str, Any]:
        """Period-end cancellation: the customer keeps what they paid for."""
        stripe = self._stripe()
        sub = stripe.Subscription.modify(
            subscription_id, cancel_at_period_end=True
        )
        return {
            "id": sub["id"],
            "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
            "current_period_end": sub.get("current_period_end"),
        }

    def verify_webhook(self, *, payload: bytes, signature: str) -> Dict[str, Any]:
        """Verify a webhook signature and return the parsed event. Never trust raw payloads."""
        if not self._webhook_secret:
            raise BillingNotConfigured("STRIPE_WEBHOOK_SECRET is not set")
        stripe = self._stripe()
        event = stripe.Webhook.construct_event(
            payload=payload, sig_header=signature, secret=self._webhook_secret
        )
        return dict(event)


def map_stripe_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Translate a verified Stripe event into a subscription-sync instruction.

    Pure function so the mapping is unit-testable without Stripe. Unknown
    events map to {"action": "ignore"} - the webhook acks them without
    touching account state, because acting on unmodelled events is how
    subscription state drifts from the source of truth.
    """
    etype = event.get("type") or event.get("event_type") or ""
    data = event.get("data") or {}
    obj = data.get("object") or {}

    if etype == "checkout.session.completed":
        return {
            "action": "attach_customer",
            "customer_id": obj.get("customer"),
            "subscription_id": obj.get("subscription"),
            "metadata": obj.get("metadata") or {},
        }
    if etype == "customer.subscription.updated":
        items = obj.get("items") or {}
        item_list = items.get("data") if isinstance(items, dict) else None
        price_id = ""
        if item_list:
            first = item_list[0] or {}
            price = first.get("price") or {}
            price_id = price.get("id", "")
        period_end = obj.get("current_period_end")
        return {
            "action": "sync_subscription",
            "price_id": price_id,
            "cancel_at_period_end": bool(obj.get("cancel_at_period_end")),
            "current_period_end": (
                datetime.fromtimestamp(period_end, tz=timezone.utc)
                if isinstance(period_end, (int, float))
                else None
            ),
            # Attribution handles (Sprint 9): lifecycle events must be
            # resolvable even when the subscription carries no metadata.
            "subscription_id": obj.get("id") or "",
            "customer_id": obj.get("customer") or "",
            "metadata": obj.get("metadata") or {},
        }
    if etype == "customer.subscription.deleted":
        return {
            "action": "mark_cancelled",
            "subscription_id": obj.get("id") or "",
            "customer_id": obj.get("customer") or "",
            "metadata": obj.get("metadata") or {},
        }
    return {"action": "ignore"}


def price_to_plan(price_id: str) -> Optional[str]:
    """Reverse lookup: which catalog plan does a configured price belong to.
    Checks both the monthly and the annual price of every plan so a renewal
    webhook on the annual price still attributes correctly."""
    if not price_id:
        return None
    for plan in PLAN_CATALOG.values():
        if price_id and price_id in (_price_id(plan, "monthly"), _price_id(plan, "annual")):
            return plan.id
    return None


def price_to_interval(price_id: str) -> Optional[str]:
    """Reverse lookup: which billing interval a configured price belongs to."""
    if not price_id:
        return None
    for plan in PLAN_CATALOG.values():
        if price_id and price_id == _price_id(plan, "monthly"):
            return "monthly"
        if price_id and price_id == _price_id(plan, "annual"):
            return "annual"
    return None


def get_adapter() -> StripeAdapter:
    return StripeAdapter()
