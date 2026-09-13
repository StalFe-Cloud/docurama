"""
Docurama pricing engine (Sprint 8).

The innovative subscription model, as pure server-side math:

- 35-day billing cycles for everyone ("weekends on us"): 12 billed cycles
  cover 420 days - 55 days more service than a 365-day year at the same
  cycle count. The cycle length is a product constant, not a display trick.
- Commitment discounts on the per-cycle price: rolling 0%, 3 months -5%,
  6 months -10%, 12 months -15%.
- The Fair Exit Guarantee: 6- and 12-month commitments carry a self-serve
  pro-rata cash refund of unused full cycles; 3-month commitments convert
  unused cycles to account credit; rolling plans simply stop at period end
  (click parity with the existing Stripe period-end cancellation).

This module is intentionally standalone and side-effect free: it prices, it
never charges. Money movement stays behind billing.py's Stripe adapter and
its honest 503s. Marketing ids (solo/team/business) map onto the stable
internal plan ids (plus/business/enterprise) that quotas.py enforces, so no
existing account row, quota table, or webhook mapping changes meaning.
"""
from typing import Any, Dict, List, Optional

# --- Cycle model -----------------------------------------------------------

CYCLE_DAYS = 35
STANDARD_MONTH_DAYS = 30
CYCLES_PER_COMMITMENT_YEAR = 12

# --- Commitment ladder ------------------------------------------------------

COMMITMENTS: Dict[str, Dict[str, Any]] = {
    "rolling": {
        "id": "rolling",
        "display_name": "Rolling (35-day cycles)",
        "cycles": 1,
        "discount": 0.0,
        "refund_type": "period_end",
        "description": "Billed every 35 days. Cancel anytime; coverage runs to the end of the paid cycle.",
    },
    "3m": {
        "id": "3m",
        "display_name": "3 months",
        "cycles": 3,
        "discount": 0.05,
        "refund_type": "credit",
        "description": "Three 35-day cycles (105 days of coverage) at 5% off. Cancel anytime; unused full cycles become account credit.",
    },
    "6m": {
        "id": "6m",
        "display_name": "6 months",
        "cycles": 6,
        "discount": 0.10,
        "refund_type": "cash",
        "description": "Six 35-day cycles (210 days of coverage) at 10% off. Fair Exit pro-rata cash refund on unused full cycles.",
    },
    "12m": {
        "id": "12m",
        "display_name": "12 months",
        "cycles": 12,
        "discount": 0.15,
        "refund_type": "cash",
        "description": "Twelve 35-day cycles (420 days of coverage - 55 days more than a calendar year) at 15% off. Fair Exit pro-rata cash refund on unused full cycles.",
    },
}

# --- Marketing tier ladder (EUR list prices per 35-day cycle) ----------------

TIERS: List[Dict[str, Any]] = [
    {
        "id": "solo",
        "internal_plan": "plus",
        "display_name": "Solo",
        "list_price_eur": 9.0,
        "envelopes_per_cycle": 30,
        "seats": 1,
        "purchasable": True,
        "contact_sales": False,
        "tagline": "For individuals who sign and send.",
        "features": [
            "30 envelopes per 35-day cycle",
            "1 seat",
            "PAdES signatures with X.509 seal",
            "RFC 3161 timestamping",
            "Verifiable audit trail",
            "Email + OTP signing channels",
        ],
    },
    {
        "id": "team",
        "internal_plan": "business",
        "display_name": "Team",
        "list_price_eur": 29.0,
        "envelopes_per_cycle": 250,
        "seats": 3,
        "purchasable": True,
        "contact_sales": False,
        "tagline": "For small teams that run on documents.",
        "features": [
            "250 envelopes per 35-day cycle",
            "3 seats",
            "Everything in Solo",
            "Templates and shared folders",
            "API access",
            "WhatsApp / Telegram OTP channels",
        ],
    },
    {
        "id": "business",
        "internal_plan": "enterprise",
        "display_name": "Business",
        "list_price_eur": 79.0,
        "envelopes_per_cycle": 10000,
        "seats": 100,
        "purchasable": True,
        "contact_sales": False,
        "tagline": "For organisations with volume and process.",
        "features": [
            "10,000 envelopes per 35-day cycle",
            "100 seats",
            "Everything in Team",
            "Domain-verified workspaces",
            "Custom branding and stamps",
            "Priority support",
        ],
    },
    {
        "id": "enterprise_custom",
        "internal_plan": None,
        "display_name": "Enterprise",
        "list_price_eur": None,
        "envelopes_per_cycle": None,
        "seats": None,
        "purchasable": False,
        "contact_sales": True,
        "tagline": "For regulated teams that need more.",
        "features": [
            "Custom envelope volume and seats",
            "Procurement, DPA and security review support",
            "Deployment and residency options",
            "Compliance evidence package",
            "Named support engineer",
        ],
    },
]

TIER_INDEX: Dict[str, Dict[str, Any]] = {t["id"]: t for t in TIERS}

# Marketing id -> internal plan id (stable across the platform).
MARKETING_TO_INTERNAL = {t["id"]: t["internal_plan"] for t in TIERS if t["internal_plan"]}


def _cents(value: float) -> float:
    """Round half-up to cents without floating drift surprises."""
    return round(value + 1e-9, 2)


def resolve_tier(tier_id: str) -> Optional[Dict[str, Any]]:
    """Accept marketing ids and, tolerantly, legacy internal ids."""
    if not tier_id:
        return None
    key = tier_id.strip().lower()
    tier = TIER_INDEX.get(key)
    if tier is not None:
        return tier
    # Legacy internal ids map onto their marketing tiers.
    legacy = {"plus": "solo", "business": "team", "enterprise": "business"}
    mapped = legacy.get(key)
    return TIER_INDEX.get(mapped) if mapped else None


def resolve_commitment(commitment_id: str) -> Optional[Dict[str, Any]]:
    if not commitment_id:
        return None
    key = commitment_id.strip().lower()
    if key in ("monthly", ""):
        key = "rolling"
    return COMMITMENTS.get(key)


def effective_cycle_price(tier_id: str, commitment_id: str) -> Optional[float]:
    """Per-cycle price after the commitment discount, in EUR."""
    tier = resolve_tier(tier_id)
    commitment = resolve_commitment(commitment_id)
    if tier is None or commitment is None or tier["list_price_eur"] is None:
        return None
    return _cents(tier["list_price_eur"] * (1.0 - commitment["discount"]))


def covered_days(cycles: int) -> int:
    """Service days a number of 35-day cycles covers."""
    return cycles * CYCLE_DAYS


def quote_subscription(tier_id: str, commitment_id: str) -> Optional[Dict[str, Any]]:
    """
    What a customer pays for a commitment, stated plainly:
    per-cycle price, cycle count, total, savings versus list, and the bonus
    service days the 35-day cycle grants versus a 30-day standard.
    """
    tier = resolve_tier(tier_id)
    commitment = resolve_commitment(commitment_id)
    if tier is None or commitment is None or tier["list_price_eur"] is None:
        return None
    cycles = int(commitment["cycles"])
    per_cycle = effective_cycle_price(tier_id, commitment_id)
    list_total = _cents(tier["list_price_eur"] * cycles)
    total = _cents((per_cycle or 0.0) * cycles)
    standard_days = cycles * STANDARD_MONTH_DAYS
    bonus_days = covered_days(cycles) - standard_days
    return {
        "tier_id": tier["id"],
        "internal_plan": tier["internal_plan"],
        "display_name": tier["display_name"],
        "commitment_id": commitment["id"],
        "cycle_days": CYCLE_DAYS,
        "cycles": cycles,
        "list_price_eur": tier["list_price_eur"],
        "per_cycle_eur": per_cycle,
        "discount": commitment["discount"],
        "total_eur": total,
        "list_total_eur": list_total,
        "savings_eur": _cents(max(0.0, list_total - total)),
        "covered_days": covered_days(cycles),
        "standard_days": standard_days,
        "bonus_days": bonus_days,
        "envelopes_per_cycle": tier["envelopes_per_cycle"],
        "seats": tier["seats"],
        "refund_type": commitment["refund_type"],
    }


def quote_cancellation(tier_id: str, commitment_id: str, cycles_completed: int) -> Optional[Dict[str, Any]]:
    """
    The Fair Exit Guarantee, as arithmetic.

    Only full unused cycles refund; the cycle in progress always runs its
    course (the customer keeps full access for days already paid for).
    Refund types: cash (6m/12m), credit (3m), period_end (rolling - nothing
    to refund because nothing beyond the current cycle was pre-paid).
    """
    subscription = quote_subscription(tier_id, commitment_id)
    if subscription is None:
        return None
    refund_type = subscription["refund_type"]
    try:
        completed = max(0, min(int(cycles_completed), subscription["cycles"]))
    except (TypeError, ValueError):
        return None
    unused_cycles = max(0, subscription["cycles"] - completed)
    per_cycle = subscription["per_cycle_eur"] or 0.0
    amount = _cents(unused_cycles * per_cycle)
    if refund_type == "period_end":
        amount = 0.0
        unused_cycles = 0
    return {
        "tier_id": subscription["tier_id"],
        "commitment_id": subscription["commitment_id"],
        "refund_type": refund_type,
        "cycles_total": subscription["cycles"],
        "cycles_completed": completed,
        "cycles_unused": unused_cycles,
        "per_cycle_eur": per_cycle,
        "refund_amount_eur": amount,
        "guarantee": "Fair Exit Guarantee" if refund_type in ("cash", "credit") else None,
        "note": {
            "cash": "Unused full cycles refund to the original payment method, pro-rata at your committed per-cycle rate.",
            "credit": "Unused full cycles convert to account credit at your committed per-cycle rate.",
            "period_end": "Rolling plan: nothing was pre-paid beyond the current 35-day cycle, so coverage simply runs to the end of the paid cycle.",
        }[refund_type],
    }


def pricing_config_public(billing_enabled: bool) -> Dict[str, Any]:
    """
    The public pricing payload that drives the marketing site.

    Honesty rules carry over from billing: `billing_enabled` reports what it
    means, and `stripe_ready` is false until the operator configures real
    price IDs - the UI renders checkout as "coming soon" rather than
    pretending a purchase can complete.
    """
    return {
        "cycle_days": CYCLE_DAYS,
        "standard_month_days": STANDARD_MONTH_DAYS,
        # Marketing headline: twelve 35-day cycles give 55 more days of
        # service than a 365-day calendar year.
        "bonus_days_per_year": covered_days(CYCLES_PER_COMMITMENT_YEAR) - 365,
        "covered_days_per_year": covered_days(CYCLES_PER_COMMITMENT_YEAR),
        "billing_enabled": bool(billing_enabled),
        "tiers": TIERS,
        "commitments": list(COMMITMENTS.values()),
        "fair_exit": {
            "name": "Fair Exit Guarantee",
            "cash_refund_commitments": ["6m", "12m"],
            "credit_commitments": ["3m"],
            "rolling": "Cancel anytime; coverage runs to the end of the paid 35-day cycle.",
        },
    }
