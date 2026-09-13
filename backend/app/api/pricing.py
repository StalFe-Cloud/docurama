"""
Public pricing API (launch model).

Pure pricing calculators behind read-only endpoints. Nothing here touches
account state, Stripe, or money: the marketing site and the in-app pricing
page fetch the same numbers the billing engine would enforce, including a
Fair Exit refund preview before anyone commits.
"""
from typing import Any, Dict

from fastapi import APIRouter, Request, Response
from app.core.rate_limit import limiter
from app.core.config import settings
from app.services import billing
from app.services.pricing import (
    pricing_config_public,
    quote_cancellation,
    quote_subscription,
)

router = APIRouter(prefix="/pricing", tags=["pricing"])


@router.get("/config")
async def get_pricing_config() -> Dict[str, Any]:
    """The full public pricing payload: tiers, cycle model, intervals, Fair Exit, trial."""
    return pricing_config_public(billing_enabled=billing.billing_enabled())


@router.post("/quote")
@limiter.limit("60/minute")
async def post_quote(request: Request, response: Response, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Subscription quote for a tier + billing interval (+ optional extra seats)."""
    tier = str(payload.get("tier") or "")
    interval = str(payload.get("interval") or payload.get("commitment") or "monthly")
    try:
        extra_seats = int(payload.get("extra_seats") or 0)
    except (TypeError, ValueError):
        extra_seats = 0
    quote = quote_subscription(tier, interval, extra_seats=extra_seats)
    if quote is None:
        return {"error": "unknown_tier_or_interval"}
    return quote


@router.post("/refund-quote")
@limiter.limit("60/minute")
async def post_refund_quote(request: Request, response: Response, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Fair Exit Guarantee preview: refund for unused full cycles (annual billing)."""
    tier = str(payload.get("tier") or "")
    interval = str(payload.get("interval") or payload.get("commitment") or "")
    try:
        cycles_completed = int(payload.get("cycles_completed") or 0)
    except (TypeError, ValueError):
        cycles_completed = 0
    quote = quote_cancellation(tier, interval, cycles_completed)
    if quote is None:
        return {"error": "unknown_tier_or_interval"}
    return quote
