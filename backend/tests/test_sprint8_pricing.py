"""
Sprint 8: the pricing engine - 35-day cycles, commitment ladder, Fair Exit.

Pins the innovative subscription model as server-side arithmetic:

- The 35-day billing cycle is a product constant: 12 billed cycles cover 420
  days - 60 more than twelve 30-day months, 55 more than a calendar year;
- Commitment discounts (rolling 0%, 3m -5%, 6m -10%, 12m -15%) price in
  cents without float drift;
- The Fair Exit Guarantee refunds unused full cycles pro-rata: cash on 6/12
  month commitments, credit on 3-month, plain period-end on rolling;
- Marketing ids (solo/team/business) resolve onto the stable internal plan
  ids (plus/business/enterprise) that quotas.py enforces - no account row,
  quota table, or webhook mapping changes meaning;
- The public config stays honest: no certification claims, billing_enabled
  reports what it means.
"""
import json

import pytest

from app.services import billing
from app.services.pricing import (
    CYCLE_DAYS,
    TIERS,
    effective_cycle_price,
    pricing_config_public,
    quote_cancellation,
    quote_subscription,
    resolve_commitment,
    resolve_tier,
)


# ---------------------------------------------------------------------------
# cycle model
# ---------------------------------------------------------------------------

def test_cycle_constant_is_35_days():
    assert CYCLE_DAYS == 35


def test_twelve_cycles_cover_420_days():
    quote = quote_subscription("solo", "12m")
    assert quote is not None
    assert quote["cycles"] == 12
    assert quote["covered_days"] == 420
    assert quote["standard_days"] == 360
    assert quote["bonus_days"] == 60


def test_config_reports_bonus_vs_calendar_year():
    config = pricing_config_public(billing_enabled=False)
    assert config["covered_days_per_year"] == 420
    assert config["bonus_days_per_year"] == 420 - 365  # 55 days more than a year


# ---------------------------------------------------------------------------
# commitment ladder pricing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "tier,commitment,expected",
    [
        ("solo", "rolling", 9.00),
        ("solo", "3m", 8.55),      # 9 * 0.95
        ("team", "12m", 24.65),    # 29 * 0.85
        ("business", "6m", 71.10), # 79 * 0.90
    ],
)
def test_effective_cycle_price_ladder(tier, commitment, expected):
    assert effective_cycle_price(tier, commitment) == pytest.approx(expected, abs=0.001)


def test_subscription_quote_totals_and_savings():
    quote = quote_subscription("business", "12m")
    assert quote["per_cycle_eur"] == pytest.approx(67.15, abs=0.001)   # 79 * 0.85
    assert quote["list_total_eur"] == pytest.approx(948.00, abs=0.001)
    assert quote["total_eur"] == pytest.approx(805.80, abs=0.001)
    assert quote["savings_eur"] == pytest.approx(142.20, abs=0.001)
    assert quote["refund_type"] == "cash"


def test_enterprise_custom_is_contact_sales():
    tier = resolve_tier("enterprise_custom")
    assert tier is not None
    assert tier["purchasable"] is False
    assert tier["contact_sales"] is True
    assert tier["list_price_eur"] is None
    assert quote_subscription("enterprise_custom", "12m") is None


# ---------------------------------------------------------------------------
# Fair Exit Guarantee
# ---------------------------------------------------------------------------

def test_cash_refund_on_six_month_commitment():
    quote = quote_cancellation("business", "6m", cycles_completed=2)
    assert quote["refund_type"] == "cash"
    assert quote["cycles_total"] == 6
    assert quote["cycles_unused"] == 4
    assert quote["refund_amount_eur"] == pytest.approx(284.40, abs=0.001)  # 4 * 71.10
    assert quote["guarantee"] == "Fair Exit Guarantee"


def test_credit_refund_on_three_month_commitment():
    quote = quote_cancellation("team", "3m", cycles_completed=1)
    assert quote["refund_type"] == "credit"
    assert quote["cycles_unused"] == 2
    assert quote["refund_amount_eur"] == pytest.approx(55.10, abs=0.001)   # 2 * 27.55


def test_rolling_cancellation_is_period_end_with_no_refund():
    quote = quote_cancellation("solo", "rolling", cycles_completed=0)
    assert quote["refund_type"] == "period_end"
    assert quote["refund_amount_eur"] == 0.0
    assert quote["guarantee"] is None
    assert "end of the paid cycle" in quote["note"]


def test_refund_clamps_out_of_range_progress():
    over = quote_cancellation("team", "6m", cycles_completed=99)
    assert over["cycles_unused"] == 0
    assert over["refund_amount_eur"] == 0.0
    under = quote_cancellation("team", "6m", cycles_completed=-5)
    assert under["cycles_completed"] == 0


# ---------------------------------------------------------------------------
# resolution and legacy tolerance
# ---------------------------------------------------------------------------

def test_marketing_ids_map_to_stable_internal_plans():
    assert resolve_tier("solo")["internal_plan"] == "plus"
    assert resolve_tier("team")["internal_plan"] == "business"
    assert resolve_tier("business")["internal_plan"] == "enterprise"


def test_legacy_internal_ids_resolve_to_marketing_tiers():
    # "plus" and "enterprise" are unambiguous legacy ids...
    assert resolve_tier("plus")["id"] == "solo"
    assert resolve_tier("enterprise")["id"] == "business"
    # ...while "business" collides: the marketing tier takes precedence.
    assert resolve_tier("business")["id"] == "business"
    assert resolve_tier("business")["list_price_eur"] == 79.0


def test_monthly_alias_resolves_to_rolling():
    assert resolve_commitment("monthly")["id"] == "rolling"
    assert resolve_commitment("nonsense") is None
    assert resolve_tier("nonsense") is None


def test_billing_catalog_resolves_marketing_aliases():
    assert billing.resolve_plan_id("solo") == "plus"
    assert billing.resolve_plan_id("team") == "business"
    # Marketing "business" (EUR 79) must land on the internal enterprise plan.
    assert billing.resolve_plan_id("business") == "enterprise"
    assert billing.resolve_plan_id("plus") == "plus"      # legacy id still valid
    assert billing.resolve_plan_id("enterprise") == "enterprise"
    assert billing.resolve_plan_id("enterprise_custom") is None  # contact sales


def test_billing_catalog_display_names_and_cycle():
    catalog = billing.plan_catalog_public()
    assert catalog["cycle_days"] == 35
    names = {p["id"]: p["display_name"] for p in catalog["plans"]}
    assert names == {"plus": "Solo", "business": "Team", "enterprise": "Business"}


# ---------------------------------------------------------------------------
# public config honesty
# ---------------------------------------------------------------------------

def test_public_config_shape_and_vocabulary():
    config = pricing_config_public(billing_enabled=False)
    assert config["billing_enabled"] is False
    assert len(config["tiers"]) == 4
    assert {c["id"] for c in config["commitments"]} == {"rolling", "3m", "6m", "12m"}
    assert config["fair_exit"]["cash_refund_commitments"] == ["6m", "12m"]
    assert config["fair_exit"]["credit_commitments"] == ["3m"]
    # The vocabulary guardrail: no certification claims in the pricing payload.
    dumped = json.dumps(config).lower()
    for banned in ("certified", "certificat"):
        assert banned not in dumped


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------

async def test_pricing_config_endpoint_public(client):
    resp = await client.get("/api/pricing/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cycle_days"] == 35
    assert body["tiers"][0]["id"] == "solo"


async def test_quote_and_refund_quote_endpoints(client):
    resp = await client.post("/api/pricing/quote", json={"tier": "team", "commitment": "12m"})
    assert resp.status_code == 200
    assert resp.json()["per_cycle_eur"] == pytest.approx(24.65, abs=0.001)

    refund = await client.post(
        "/api/pricing/refund-quote",
        json={"tier": "business", "commitment": "6m", "cycles_completed": 3},
    )
    assert refund.status_code == 200
    body = refund.json()
    assert body["cycles_unused"] == 3
    assert body["refund_amount_eur"] == pytest.approx(213.30, abs=0.001)  # 3 * 71.10


async def test_quote_endpoints_reject_unknown_tier(client):
    resp = await client.post("/api/pricing/quote", json={"tier": "nonsense", "commitment": "12m"})
    assert resp.status_code == 200
    assert resp.json() == {"error": "unknown_tier_or_commitment"}
