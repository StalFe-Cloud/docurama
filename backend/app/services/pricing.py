"""
Docurama pricing engine - FINAL commercial model (launch alignment).

Single authoritative source for everything commercial. The 35-day billing
cycle engine is retained deliberately: twelve billed cycles still cover 420
days - 55 days more service than a calendar year - which remains the product
differentiator ("weekends on us"). What changed is the catalog riding on it:

- PLUS             €19 per cycle (monthly billing) or €15/cycle-equivalent
                   when billed annually (12 cycles, €180). 30 envelopes per
                   cycle, 1 seat.
- BUSINESS TEAM    €49 per cycle or €39/cycle-equivalent annual (€468).
                   250 pooled envelopes per cycle, 3 seats included,
                   additional seats €15 per cycle each.
- ENTERPRISE       Custom pricing, sales-led. Reference starting point
                   €1,500/year. Deployment models: Managed Public Cloud,
                   Managed Private Cloud, On-Premises, Air-Gapped where
                   technically appropriate. Not self-serve purchasable.

The old self-serve ladder (Solo €9 / Team €29 / Business €79, 3m/6m/12m
commitment steps) is retired. Billing intervals reduce to monthly and
annual; the Fair Exit Guarantee survives, adapted: annual prepayments
refund unused full cycles pro-rata as cash, monthly plans simply run to
period end (click parity with Stripe cancellation).

This module is intentionally standalone and side-effect free: it prices, it
never charges. Money movement stays behind billing.py's Stripe adapter and
its honest 503s. Marketing ids map onto the stable internal plan ids
(plus/business/enterprise) that quotas.py enforces, so no existing account
row, quota table, or webhook mapping changes meaning.
"""
from typing import Any, Dict, List, Optional

# --- Cycle model (engine retained from Sprint 8) ----------------------------

CYCLE_DAYS = 35
STANDARD_MONTH_DAYS = 30
CYCLES_PER_YEAR = 12

# --- Trial model (final: 14 days, no card, full Plus experience) ------------

TRIAL_DAYS = 14

# --- Billing intervals (the retired 3m/6m/12m ladder collapses to two) ------

BILLING_INTERVALS: Dict[str, Dict[str, Any]] = {
    "monthly": {
        "id": "monthly",
        "display_name": "Monthly",
        "cycles": 1,
        "discount": 0.0,
        "refund_type": "period_end",
        "description": "Billed every 35 days. Cancel anytime; coverage runs to the end of the paid cycle.",
    },
    "annual": {
        "id": "annual",
        "display_name": "Annual",
        "cycles": CYCLES_PER_YEAR,
        "discount": 0.0,  # annual savings are priced per tier (exact cents), not a flat ladder
        "refund_type": "cash",
        "description": "Twelve 35-day cycles (420 days of coverage - 55 days more than a calendar year) billed once a year. Fair Exit pro-rata cash refund on unused full cycles.",
    },
}

# --- Premium tier ladder (EUR list prices per 35-day cycle) ------------------
# annual_total_eur is the exact charged amount for the annual interval and
# MUST equal the advertised per-cycle-equivalent x 12 (plus 15 x 12 = 180,
# business team 39 x 12 = 468). The engine derives the per-cycle equivalent
# from this total so the advertised number and the charged number cannot
# drift apart.

TIERS: List[Dict[str, Any]] = [
    {
        "id": "plus",
        "internal_plan": "plus",
        "display_name": "Plus",
        "list_price_eur": 19.0,
        "annual_total_eur": 180.0,
        "extra_seat_price_eur": None,
        "envelopes_per_cycle": 30,
        "seats": 1,
        "purchasable": True,
        "contact_sales": False,
        "trial_eligible": True,
        "tagline": "For professionals who sign and send.",
        "features": [
            "30 envelopes per month",
            "1 seat",
            "Unlimited templates",
            "Email + SMS OTP signing",
            "Custom logo and email branding",
            "Tamper-evident cryptographic seal",
            "Audit trail certificates",
            "Webhooks and event integrations",
        ],
    },
    {
        "id": "business_team",
        "internal_plan": "business",
        "display_name": "Business Team",
        "list_price_eur": 49.0,
        "annual_total_eur": 468.0,
        "extra_seat_price_eur": 15.0,
        "envelopes_per_cycle": 250,
        "seats": 3,
        "purchasable": True,
        "contact_sales": False,
        "trial_eligible": False,
        "tagline": "For teams that run on documents.",
        "features": [
            "250 pooled envelopes per month",
            "3 seats included",
            "Additional seats €15/month each",
            "Everything in Plus",
            "WhatsApp + Telegram OTP channels",
            "Team workspace with role permissions",
            "Custom subdomain and custom domain",
            "REST API, API keys, webhooks",
            "Priority support",
        ],
    },
    {
        "id": "enterprise_custom",
        "internal_plan": None,
        "display_name": "Enterprise",
        "list_price_eur": None,
        "annual_total_eur": None,
        "extra_seat_price_eur": None,
        "envelopes_per_cycle": None,
        "seats": None,
        "purchasable": False,
        "contact_sales": True,
        "trial_eligible": False,
        "reference_price": "from €1,500/year",
        "deployment_options": [
            "Managed Public Cloud",
            "Managed Private Cloud",
            "On-Premises",
            "Air-Gapped (where technically appropriate)",
        ],
        "tagline": "For organisations that need sovereignty and scale.",
        "features": [
            "Custom pricing - from €1,500/year reference",
            "High-volume envelopes; seats per contract",
            "Deployment choice: Public Cloud, Private Cloud, On-Premises, Air-Gapped",
            "EU deployment and data sovereignty controls",
            "SSO (SAML / OIDC)",
            "Custom certificate infrastructure, HSM/KMS integration",
            "White-label",
            "Dedicated support and contractual SLA options",
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
    """
    Accept the launch marketing ids plus/business_team and, tolerantly, the
    retired marketing and legacy internal ids. Retired ids resolve onto the
    launch tier that owns the same internal plan - a stale client cannot
    conjure the retired €9/€29/€79 prices back into existence.
    """
    if not tier_id:
        return None
    key = tier_id.strip().lower()
    tier = TIER_INDEX.get(key)
    if tier is not None:
        return tier
    # Retired marketing ids and legacy internal ids -> launch tiers.
    legacy = {"solo": "plus", "plus": "plus", "team": "business_team",
              "business": "business_team", "enterprise": "enterprise_custom"}
    mapped = legacy.get(key)
    return TIER_INDEX.get(mapped) if mapped else None


def resolve_interval(interval_id: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a billing interval. Legacy ids from the retired commitment ladder
    map where unambiguous: rolling/monthly -> monthly, 12m -> annual. The
    retired 3m and 6m steps resolve to None on purpose - silently re-pricing
    them would resurrect the old ladder through the side door.
    """
    if not interval_id:
        return BILLING_INTERVALS["monthly"]
    key = interval_id.strip().lower()
    if key in ("rolling", "monthly"):
        return BILLING_INTERVALS["monthly"]
    if key in ("annual", "yearly", "12m"):
        return BILLING_INTERVALS["annual"]
    return None


# Backward-compatible alias: checkout and tests may still say "commitment".
def resolve_commitment(commitment_id: str) -> Optional[Dict[str, Any]]:
    return resolve_interval(commitment_id)


def effective_cycle_price(tier_id: str, interval_id: str) -> Optional[float]:
    """Per-cycle price for the interval, in EUR. Annual derives from the
    exact annual total so the advertised €15/€39 equivalents are what runs."""
    tier = resolve_tier(tier_id)
    interval = resolve_interval(interval_id)
    if tier is None or interval is None or tier["list_price_eur"] is None:
        return None
    if interval["id"] == "annual":
        annual_total = tier.get("annual_total_eur")
        if annual_total is None:
            return None
        return _cents(annual_total / interval["cycles"])
    return _cents(tier["list_price_eur"])


def covered_days(cycles: int) -> int:
    """Service days a number of 35-day cycles covers."""
    return cycles * CYCLE_DAYS


def quote_subscription(tier_id: str, interval_id: str, extra_seats: int = 0) -> Optional[Dict[str, Any]]:
    """
    What a customer pays for a billing interval, stated plainly: per-cycle
    price, cycle count, total, savings versus monthly, and the bonus service
    days the 35-day cycle grants versus a 30-day standard. Business Team
    extra seats add €15/cycle each on either interval.
    """
    tier = resolve_tier(tier_id)
    interval = resolve_interval(interval_id)
    if tier is None or interval is None or tier["list_price_eur"] is None:
        return None
    try:
        seats_extra = max(0, int(extra_seats or 0))
    except (TypeError, ValueError):
        seats_extra = 0
    seat_price = tier.get("extra_seat_price_eur")
    if seats_extra and seat_price is None:
        return None  # seats cannot be added to a tier that does not sell them
    cycles = int(interval["cycles"])
    per_cycle = effective_cycle_price(tier_id, interval_id)
    plan_total = _cents((per_cycle or 0.0) * cycles)
    seats_total = _cents(seats_extra * (seat_price or 0.0) * cycles)
    total = _cents(plan_total + seats_total)
    monthly_total = _cents(_cents(tier["list_price_eur"]) * cycles)
    annual_total = tier.get("annual_total_eur")
    if interval["id"] == "annual" and annual_total is not None:
        list_total = _cents(monthly_total + seats_extra * (seat_price or 0.0) * cycles)
    else:
        list_total = total
    return {
        "tier_id": tier["id"],
        "internal_plan": tier["internal_plan"],
        "display_name": tier["display_name"],
        "interval_id": interval["id"],
        "cycle_days": CYCLE_DAYS,
        "cycles": cycles,
        "list_price_eur": tier["list_price_eur"],
        "per_cycle_eur": per_cycle,
        "annual_total_eur": annual_total,
        "extra_seats": seats_extra,
        "extra_seat_price_eur": seat_price,
        "extra_seats_total_eur": seats_total,
        "discount": round(1 - (per_cycle / tier["list_price_eur"]), 4) if (interval["id"] == "annual" and tier["list_price_eur"]) else 0.0,
        "total_eur": total,
        "list_total_eur": list_total,
        "savings_eur": _cents(max(0.0, list_total - total)),
        "covered_days": covered_days(cycles),
        "standard_days": cycles * STANDARD_MONTH_DAYS,
        "bonus_days": covered_days(cycles) - cycles * STANDARD_MONTH_DAYS,
        "envelopes_per_cycle": tier["envelopes_per_cycle"],
        "seats": tier["seats"],
        "refund_type": interval["refund_type"],
    }


def quote_cancellation(tier_id: str, interval_id: str, cycles_completed: int) -> Optional[Dict[str, Any]]:
    """
    The Fair Exit Guarantee, as arithmetic, adapted to the launch model.

    Annual: unused full cycles refund to the original payment method,
    pro-rata at the committed per-cycle rate; the cycle in progress always
    runs its course (the customer keeps full access for days already paid
    for). Monthly: nothing was pre-paid beyond the current cycle, so
    coverage simply runs to period end - click parity with Stripe.
    """
    subscription = quote_subscription(tier_id, interval_id)
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
        "interval_id": subscription["interval_id"],
        "refund_type": refund_type,
        "cycles_total": subscription["cycles"],
        "cycles_completed": completed,
        "cycles_unused": unused_cycles,
        "per_cycle_eur": per_cycle,
        "refund_amount_eur": amount,
        "guarantee": "Fair Exit Guarantee" if refund_type == "cash" else None,
        "note": {
            "cash": "Unused full cycles refund to the original payment method, pro-rata at your committed per-cycle rate.",
            "period_end": "Monthly plan: nothing was pre-paid beyond the current 35-day cycle, so coverage simply runs to the end of the paid cycle.",
        }[refund_type],
    }


def pricing_config_public(billing_enabled: bool) -> Dict[str, Any]:
    """
    The public pricing payload that drives the marketing site.

    Honesty rules carry over from billing: `billing_enabled` reports what it
    means, and `stripe_ready` is false until the operator configures real
    price IDs - the UI renders checkout as "coming soon" rather than
    pretending a purchase can complete. There is no free tier and no free
    self-host plan anywhere in this payload; the trial is the 14-day,
    no-card Plus trial.
    """
    return {
        "cycle_days": CYCLE_DAYS,
        "standard_month_days": STANDARD_MONTH_DAYS,
        "trial_days": TRIAL_DAYS,
        # Marketing headline: twelve 35-day cycles give 55 more days of
        # service than a 365-day calendar year.
        "bonus_days_per_year": covered_days(CYCLES_PER_YEAR) - 365,
        "covered_days_per_year": covered_days(CYCLES_PER_YEAR),
        "billing_enabled": bool(billing_enabled),
        "intervals": list(BILLING_INTERVALS.values()),
        "tiers": TIERS,
        "fair_exit": {
            "name": "Fair Exit Guarantee",
            "cash_refund_intervals": ["annual"],
            "monthly": "Cancel anytime; coverage runs to the end of the paid 35-day cycle.",
            "annual": "Unused full cycles refund to your payment method, pro-rata, self-serve in one click.",
        },
    }
