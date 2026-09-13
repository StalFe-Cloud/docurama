"""
Launch commercial model: premium tiers on the retained 35-day engine.

Pins the FINAL pricing model as server-side arithmetic:

- The 35-day billing cycle engine is retained deliberately: twelve billed
  cycles cover 420 days - 55 days more than a calendar year;
- The catalog is Plus / Business Team / Enterprise. Plus is EUR 19 per cycle
  or EUR 15 per cycle-equivalent billed annually (EUR 180 total); Business
  Team is EUR 49 / EUR 39 (EUR 468 total) with 3 seats and additional seats
  at EUR 15 per cycle; Enterprise is custom and sales-led;
- The retired ladder (Solo 9 / Team 29 / Business 79, 3m/6m/12m steps)
  cannot reappear: retired ids resolve onto launch tiers, retired intervals
  resolve to None, and no tier carries the retired price points;
- The Fair Exit Guarantee survives adapted: annual prepayments refund
  unused full cycles pro-rata as cash; monthly plans run to period end;
- The public config stays honest: trial_days = 14, no free tier, no free
  self-host, no certification vocabulary.
"""
import json

import pytest

from app.services import billing
from app.services.pricing import (
    CYCLE_DAYS,
    TRIAL_DAYS,
    TIERS,
    effective_cycle_price,
    pricing_config_public,
    quote_cancellation,
    quote_subscription,
    resolve_interval,
    resolve_tier,
)


# ---------------------------------------------------------------------------
# cycle model (engine retained)
# ---------------------------------------------------------------------------

def test_cycle_constant_is_still_35_days():
    assert CYCLE_DAYS == 35


def test_trial_constant_is_14_days():
    assert TRIAL_DAYS == 14


def test_twelve_annual_cycles_cover_420_days():
    quote = quote_subscription("plus", "annual")
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
# launch tier pricing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "tier,interval,expected",
    [
        ("plus", "monthly", 19.00),
        ("plus", "annual", 15.00),        # 180 / 12 exactly
        ("business_team", "monthly", 49.00),
        ("business_team", "annual", 39.00),  # 468 / 12 exactly
    ],
)
def test_launch_price_points(tier, interval, expected):
    assert effective_cycle_price(tier, interval) == pytest.approx(expected, abs=0.001)


def test_plus_annual_quote_totals():
    quote = quote_subscription("plus", "annual")
    assert quote["total_eur"] == pytest.approx(180.00, abs=0.001)
    assert quote["savings_eur"] == pytest.approx(48.00, abs=0.001)  # 228 - 180
    assert quote["discount"] == pytest.approx(1 - 15 / 19, abs=0.001)
    assert quote["refund_type"] == "cash"


def test_business_team_annual_quote_totals():
    quote = quote_subscription("business_team", "annual")
    assert quote["total_eur"] == pytest.approx(468.00, abs=0.001)
    assert quote["savings_eur"] == pytest.approx(120.00, abs=0.001)  # 588 - 468
    assert quote["extra_seat_price_eur"] == 15.0


def test_extra_seat_math_monthly_and_annual():
    monthly = quote_subscription("business_team", "monthly", extra_seats=2)
    assert monthly["extra_seats_total_eur"] == pytest.approx(30.00, abs=0.001)
    assert monthly["total_eur"] == pytest.approx(79.00, abs=0.001)  # 49 + 2*15
    annual = quote_subscription("business_team", "annual", extra_seats=2)
    assert annual["extra_seats_total_eur"] == pytest.approx(360.00, abs=0.001)
    assert annual["total_eur"] == pytest.approx(828.00, abs=0.001)  # 468 + 2*180


def test_extra_seats_rejected_on_plus():
    assert quote_subscription("plus", "monthly", extra_seats=2) is None


def test_enterprise_is_sales_led():
    tier = resolve_tier("enterprise_custom")
    assert tier is not None
    assert tier["purchasable"] is False
    assert tier["contact_sales"] is True
    assert tier["list_price_eur"] is None
    assert tier["reference_price"].startswith("from €1,500")
    assert "Air-Gapped" in " ".join(tier["deployment_options"])
    assert quote_subscription("enterprise_custom", "annual") is None


# ---------------------------------------------------------------------------
# the retired 35-day-era ladder cannot reappear
# ---------------------------------------------------------------------------

def test_retired_price_points_are_gone():
    for tier in TIERS:
        if tier["list_price_eur"] is not None:
            assert tier["list_price_eur"] not in (9.0, 29.0, 79.0), tier["id"]


def test_retired_ladder_steps_resolve_to_none():
    assert resolve_interval("3m") is None
    assert resolve_interval("6m") is None


def test_interval_aliases():
    assert resolve_interval("monthly")["id"] == "monthly"
    assert resolve_interval("rolling")["id"] == "monthly"   # legacy alias
    assert resolve_interval("annual")["id"] == "annual"
    assert resolve_interval("12m")["id"] == "annual"        # legacy alias
    assert resolve_interval("nonsense") is None


def test_retired_marketing_ids_resolve_to_launch_tiers():
    # A stale client cannot conjure the retired €9/€29/€79 catalog back.
    assert resolve_tier("solo")["id"] == "plus"
    assert resolve_tier("team")["id"] == "business_team"
    assert resolve_tier("business")["id"] == "business_team"
    assert resolve_tier("solo")["list_price_eur"] == 19.0


# ---------------------------------------------------------------------------
# Fair Exit Guarantee, adapted
# ---------------------------------------------------------------------------

def test_annual_cash_refund_pro_rata():
    quote = quote_cancellation("plus", "annual", cycles_completed=5)
    assert quote["refund_type"] == "cash"
    assert quote["cycles_total"] == 12
    assert quote["cycles_unused"] == 7
    assert quote["refund_amount_eur"] == pytest.approx(105.00, abs=0.001)  # 7 * 15
    assert quote["guarantee"] == "Fair Exit Guarantee"


def test_monthly_cancellation_is_period_end_with_no_refund():
    quote = quote_cancellation("plus", "monthly", cycles_completed=0)
    assert quote["refund_type"] == "period_end"
    assert quote["refund_amount_eur"] == 0.0
    assert quote["guarantee"] is None
    assert "end of the paid cycle" in quote["note"]


def test_refund_clamps_out_of_range_progress():
    over = quote_cancellation("business_team", "annual", cycles_completed=99)
    assert over["cycles_unused"] == 0
    assert over["refund_amount_eur"] == 0.0
    under = quote_cancellation("business_team", "annual", cycles_completed=-5)
    assert under["cycles_completed"] == 0


# ---------------------------------------------------------------------------
# resolution and catalog
# ---------------------------------------------------------------------------

def test_marketing_ids_map_to_stable_internal_plans():
    assert resolve_tier("plus")["internal_plan"] == "plus"
    assert resolve_tier("business_team")["internal_plan"] == "business"


def test_billing_catalog_resolves_marketing_ids():
    assert billing.resolve_plan_id("plus") == "plus"
    assert billing.resolve_plan_id("business_team") == "business"
    assert billing.resolve_plan_id("solo") == "plus"          # retired id -> launch tier
    assert billing.resolve_plan_id("team") == "business"      # retired id -> launch tier
    assert billing.resolve_plan_id("enterprise") == "enterprise"  # sales-led catalog id
    assert billing.resolve_plan_id("unlimited") is None       # self-host is not a cloud plan


def test_billing_catalog_display_names_and_honesty():
    catalog = billing.plan_catalog_public()
    assert catalog["cycle_days"] == 35
    assert catalog["trial_days"] == 14
    names = {p["id"]: p["display_name"] for p in catalog["plans"]}
    assert names == {"plus": "Plus", "business": "Business Team", "enterprise": "Enterprise"}
    by_id = {p["id"]: p for p in catalog["plans"]}
    assert by_id["enterprise"]["self_serve"] is False
    assert by_id["enterprise"]["configured_price_id"] == ""
    assert by_id["plus"]["configured_price_id"] == ""  # operator has not configured prices


def test_enterprise_never_yields_a_self_serve_price(monkeypatch):
    monkeypatch.setattr(billing, "billing_enabled", lambda: True)
    with pytest.raises(billing.BillingNotConfigured, match="sales"):
        billing.require_configured_price("enterprise", "monthly")


# ---------------------------------------------------------------------------
# public config honesty
# ---------------------------------------------------------------------------

def test_public_config_shape_and_vocabulary():
    config = pricing_config_public(billing_enabled=False)
    assert config["billing_enabled"] is False
    assert config["trial_days"] == 14
    assert len(config["tiers"]) == 3
    assert {t["id"] for t in config["tiers"]} == {"plus", "business_team", "enterprise_custom"}
    assert {c["id"] for c in config["intervals"]} == {"monthly", "annual"}
    assert config["fair_exit"]["cash_refund_intervals"] == ["annual"]
    # The vocabulary guardrail: claims are banned; document-artifact nouns
    # ("audit trail certificates") are legitimate capability copy.
    dumped = json.dumps(config).lower()
    for banned in ("certified", "certification", "eidas", "qualified", "legally guaranteed"):
        assert banned not in dumped


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------

async def test_pricing_config_endpoint_public(client):
    resp = await client.get("/api/pricing/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cycle_days"] == 35
    assert body["trial_days"] == 14
    assert body["tiers"][0]["id"] == "plus"


async def test_quote_and_refund_quote_endpoints(client):
    resp = await client.post("/api/pricing/quote", json={"tier": "business_team", "interval": "annual"})
    assert resp.status_code == 200
    assert resp.json()["per_cycle_eur"] == pytest.approx(39.00, abs=0.001)

    refund = await client.post(
        "/api/pricing/refund-quote",
        json={"tier": "plus", "interval": "annual", "cycles_completed": 3},
    )
    assert refund.status_code == 200
    body = refund.json()
    assert body["cycles_unused"] == 9
    assert body["refund_amount_eur"] == pytest.approx(135.00, abs=0.001)  # 9 * 15


async def test_quote_endpoints_reject_unknown_tier(client):
    resp = await client.post("/api/pricing/quote", json={"tier": "nonsense", "interval": "annual"})
    assert resp.status_code == 200
    assert resp.json() == {"error": "unknown_tier_or_interval"}
