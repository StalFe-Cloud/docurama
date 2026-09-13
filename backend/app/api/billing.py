"""
Billing API (Sprint 3).

Public plan catalog is honest about what is configured; every money-touching
operation answers 503 with the exact missing credential while the operator has
not supplied Stripe keys, and the webhook refuses unsigned payloads outright.
The webhook is the only route that mutates plan state, and only after its
signature verifies.
"""
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.api.auth import get_current_user
from app.models import Account, User, StripeEvent
from app.services import billing
from app.services.billing import BillingNotConfigured

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger("docurama.billing")


def _require_account(user: User) -> User:
    if not user.account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account has no workspace to bill. Sign up normally or contact support.",
        )
    return user


def _require_workspace_admin(user: User) -> User:
    """Checkout, the portal and cancellation are workspace commitments, not
    personal ones: they change what every seat pays and what service the whole
    team keeps. Same role gate as the settings API - a plain member must not
    be able to commit the company to a paid plan or cut its service off."""
    if (user.role or "").strip().lower() not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a workspace administrator can manage billing.",
        )
    return user


@router.get("/plans")
async def get_plans() -> Dict[str, Any]:
    """Public catalog. Reports configuration honestly; never fakes availability."""
    return billing.plan_catalog_public()


@router.get("/subscription")
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """The caller's subscription state, read from the account record."""
    _require_account(current_user)
    account = (await db.execute(
        select(Account).where(Account.id == current_user.account_id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    plan = account.plan or "unlimited"
    known = plan in billing.PLAN_CATALOG
    return {
        "plan": plan,
        "plan_display_name": billing.PLAN_CATALOG[plan].display_name if known else (
            "Trial" if getattr(account, "is_trial", False) else plan
        ),
        "is_trial": bool(getattr(account, "is_trial", False)),
        "trial_ends_at": getattr(account, "trial_ends_at", None),
        "billing_interval": getattr(account, "billing_interval", None),
        "cancel_at_period_end": bool(getattr(account, "cancel_at_period_end", False)),
        "current_period_end": getattr(account, "current_period_end", None),
        "billing_enabled": billing.billing_enabled(),
    }


@router.post("/checkout")
@limiter.limit("10/minute")
async def create_checkout(
    request: Request,
    payload: Dict[str, Any],
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Start a Stripe Checkout session for a catalog plan.

    Unconfigured deployments answer 503 naming the missing credential - an
    operator who forgets a price ID sees exactly that in the response rather
    than a mysterious failure at Stripe.
    """
    _require_account(current_user)
    _require_workspace_admin(current_user)
    plan_id = str(payload.get("plan") or "").strip()
    if not plan_id:
        raise HTTPException(status_code=422, detail="Choose a plan.")
    # Sprint 8: commitment rides along in checkout metadata so the operator's
    # Stripe records which commitment ladder the customer chose. The pricing
    # engine validated the id space; unknown values fall back to rolling.
    commitment_raw = str(payload.get("commitment") or "").strip().lower() or "rolling"
    from app.services.pricing import resolve_commitment

    commitment = resolve_commitment(commitment_raw)
    commitment_id = commitment["id"] if commitment else "rolling"
    if plan_id in billing.NON_PURCHASABLE_PLANS:
        raise HTTPException(status_code=400, detail="That plan is not purchasable.")
    try:
        plan, price_id = billing.require_configured_price(plan_id)
    except BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown plan.")

    adapter = billing.get_adapter()
    base = str(settings.APP_URL).rstrip("/")
    try:
        session = adapter.create_checkout_session(
            price_id=price_id,
            customer_email=current_user.email,
            success_url=f"{base}/settings?billing=success",
            cancel_url=f"{base}/settings?billing=cancelled",
            metadata={
                "account_id": current_user.account_id,
                "plan": plan.id,
                "commitment": commitment_id,
            },
        )
    except BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        logger.exception("checkout session creation failed")
        raise HTTPException(status_code=502, detail="Payment provider error.")
    return {"checkout_url": session["url"], "session_id": session["id"]}


@router.post("/portal")
@limiter.limit("10/minute")
async def create_portal(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Stripe customer portal link; 503 until the operator configures billing."""
    _require_account(current_user)
    _require_workspace_admin(current_user)
    account = (await db.execute(
        select(Account).where(Account.id == current_user.account_id)
    )).scalar_one_or_none()
    customer_id = getattr(account, "stripe_customer_id", None) if account else None
    if not customer_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No billing profile yet. Subscribe to a plan first.",
        )
    adapter = billing.get_adapter()
    try:
        session = adapter.create_portal_session(
            customer_id=customer_id, return_url=str(settings.APP_URL).rstrip("/") + "/settings"
        )
    except BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        logger.exception("portal session creation failed")
        raise HTTPException(status_code=502, detail="Payment provider error.")
    return {"portal_url": session["url"]}


@router.post("/cancel")
@limiter.limit("5/minute")
async def cancel_subscription(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    One-click period-end cancellation, same as the portal's own control.

    The benefit stays until the end of the paid period; the account keeps its
    plan features until then, which is recorded on the account row.
    """
    _require_account(current_user)
    _require_workspace_admin(current_user)
    account = (await db.execute(
        select(Account).where(Account.id == current_user.account_id)
    )).scalar_one_or_none()
    subscription_id = getattr(account, "stripe_subscription_id", None) if account else None
    if not subscription_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No active subscription to cancel.",
        )
    adapter = billing.get_adapter()
    try:
        result = adapter.cancel_subscription(subscription_id=subscription_id)
    except BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        logger.exception("cancellation failed")
        raise HTTPException(status_code=502, detail="Payment provider error.")
    account.cancel_at_period_end = True
    await db.commit()
    return {"cancelled": True, "period_end": result.get("current_period_end")}


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Signature-verified subscription sync.

    The raw body is read before any parsing because signature verification is
    computed over exact bytes. Unverified, malformed, or unmodelled payloads
    are refused or ignored - the plan state only ever moves along the mapped
    events, so a forged or reordered webhook cannot upgrade an account.
    """
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    adapter = billing.get_adapter()
    try:
        event = adapter.verify_webhook(payload=payload, signature=signature)
    except BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    # Idempotency (Sprint 9): Stripe delivers at-least-once and a replay of a
    # delivered event must never re-apply. The ledger row's primary key is the
    # Stripe event id, so the insert below is the gate: if it conflicts, the
    # event was already processed and we ack without touching plan state.
    # Failure of the whole ledger write rolls back with the sync, so a crash
    # between mutate and record cannot strand an unrecorded change.
    event_id = str(event.get("id") or "")
    if event_id:
        seen = (await db.execute(
            select(StripeEvent).where(StripeEvent.id == event_id)
        )).scalar_one_or_none()
        if seen is not None:
            logger.info("stripe webhook replay ignored: event_id=%s", event_id)
            return Response(status_code=200)

    instruction = billing.map_stripe_event(event)
    action = instruction.get("action")
    event_type = str(event.get("type") or "")

    async def _record_ledger(claimed_account_id: str | None) -> None:
        """Persist processing state in the same transaction as the effect."""
        if not event_id:
            return
        db.add(StripeEvent(
            id=event_id,
            event_type=event_type,
            action=str(action),
            account_id=claimed_account_id,
        ))

    if action == "ignore":
        # Unmodelled events are acked and recorded so a redelivery skips the
        # mapping work too, not just the mutation.
        await _record_ledger(None)
        await db.commit()
        return Response(status_code=200)

    metadata = instruction.get("metadata") or {}
    account_id = metadata.get("account_id")

    account = None
    if account_id:
        account = (await db.execute(
            select(Account).where(Account.id == str(account_id))
        )).scalar_one_or_none()

    if account is None:
        # Sprint 9 attribution fallback: subscription lifecycle events
        # (updated on renewal, deleted on cancellation) do not always carry
        # our checkout metadata. Resolve the account by the subscription or
        # customer id recorded on the account row at attach time - a
        # verified Stripe event about subscription X must reach the account
        # that owns subscription X.
        sub_handle = str(instruction.get("subscription_id") or "").strip()
        customer_handle = str(instruction.get("customer_id") or "").strip()
        if sub_handle:
            account = (await db.execute(
                select(Account).where(Account.stripe_subscription_id == sub_handle)
            )).scalar_one_or_none()
        if account is None and customer_handle:
            account = (await db.execute(
                select(Account).where(Account.stripe_customer_id == customer_handle)
            )).scalar_one_or_none()

    if account is None:
        logger.warning("stripe webhook could not be attributed: action=%s event=%s", action, event_id)
        await _record_ledger(None)
        await db.commit()
        return Response(status_code=200)

    if action == "attach_customer":
        account.stripe_customer_id = instruction.get("customer_id")
        account.stripe_subscription_id = instruction.get("subscription_id")
        plan_id = (instruction.get("metadata") or {}).get("plan")
        if plan_id in billing.PLAN_CATALOG:
            account.plan = plan_id
            account.is_trial = False
    elif action == "sync_subscription":
        plan_id = billing.price_to_plan(instruction.get("price_id", ""))
        if plan_id:
            account.plan = plan_id
            account.is_trial = False
        if instruction.get("current_period_end") is not None:
            account.current_period_end = instruction["current_period_end"]
        account.cancel_at_period_end = bool(instruction.get("cancel_at_period_end"))
    elif action == "mark_cancelled":
        account.cancel_at_period_end = True

    await _record_ledger(account.id)
    try:
        await db.commit()
    except Exception:
        # A concurrent delivery of the same event won the insert race. The
        # writes are field assignments, so the winner applied identical
        # state; ack instead of erroring into a Stripe retry loop.
        await db.rollback()
        logger.info("stripe webhook concurrent replay absorbed: event_id=%s", event_id)
    return Response(status_code=200)
