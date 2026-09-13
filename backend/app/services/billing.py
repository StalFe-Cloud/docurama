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
    price_setting: str
    description: str


PLAN_CATALOG: Dict[str, PlanDefinition] = {
    "plus": PlanDefinition(
        id="plus",
        display_name="Plus",
        envelopes_per_month=30,
        seats=1,
        price_setting="STRIPE_PRICE_STARTER",
        description="Individual signing: 30 envelopes per month, full PAdES sealing.",
    ),
    "business": PlanDefinition(
        id="business",
        display_name="Business Team",
        envelopes_per_month=250,
        seats=3,
        price_setting="STRIPE_PRICE_BUSINESS",
        description="Small teams: 250 envelopes per month across 3 seats, templates and API access.",
    ),
    "enterprise": PlanDefinition(
        id="enterprise",
        display_name="Enterprise",
        envelopes_per_month=1000,
        seats=10,
        price_setting="STRIPE_PRICE_ENTERPRISE",
        description="Organisations: 1000 envelopes per month, domain-verified workspaces, priority support.",
    ),
}

# Free/self-host plan names that must never be reachable through checkout.
NON_PURCHASABLE_PLANS = {"unlimited", "free", "trial"}


def billing_enabled() -> bool:
    """True only when the operator explicitly switched billing on."""
    return bool(getattr(settings, "BILLING_ENABLED", False))


def _price_id(plan: PlanDefinition) -> str:
    return (getattr(settings, plan.price_setting, "") or "").strip()


def plan_catalog_public() -> Dict[str, Any]:
    """
    The public catalog. Honesty rules: billing_enabled says what it means, and
    configured_price_id is empty when the operator has not set the price - the
    UI must render that as "coming soon", not as a purchasable plan.
    """
    enabled = billing_enabled()
    return {
        "billing_enabled": enabled,
        "plans": [
            {
                "id": plan.id,
                "display_name": plan.display_name,
                "envelopes_per_month": plan.envelopes_per_month,
                "seats": plan.seats,
                "description": plan.description,
                "configured_price_id": _price_id(plan) if enabled else "",
            }
            for plan in PLAN_CATALOG.values()
        ],
    }


def require_configured_price(plan_id: str) -> tuple:
    """Resolve a plan and its configured price; raises when unusable."""
    plan = PLAN_CATALOG.get(plan_id)
    if plan is None:
        raise ValueError("unknown plan")
    price_id = _price_id(plan)
    if not billing_enabled() or not price_id:
        raise BillingNotConfigured(
            "Billing is not configured on this deployment. "
            f"Missing: {'STRIPE keys' if not billing_enabled() else plan.price_setting}."
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
        }
    if etype == "customer.subscription.deleted":
        return {"action": "mark_cancelled"}
    return {"action": "ignore"}


def price_to_plan(price_id: str) -> Optional[str]:
    """Reverse lookup: which catalog plan does a configured price belong to."""
    if not price_id:
        return None
    for plan in PLAN_CATALOG.values():
        if price_id and price_id == _price_id(plan):
            return plan.id
    return None


def get_adapter() -> StripeAdapter:
    return StripeAdapter()
