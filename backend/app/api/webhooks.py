from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.auth import get_current_user
from app.api.quotas import require_paid_write
from app.models.models import User, Webhook, WebhookDelivery
from app.schemas.schemas import WebhookCreate, WebhookOut, WebhookTestRequest, WebhookDeliveryOut
from app.services.webhook_dispatcher import WebhookDispatcher, validate_webhook_url

router = APIRouter()

@router.get("", response_model=List[WebhookOut])
async def list_webhooks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Webhook).where(
        Webhook.account_id == current_user.account_id
    ).order_by(Webhook.created_at.desc())
    res = await db.execute(stmt)
    webhooks = res.scalars().all()
    
    out = []
    for wh in webhooks:
        del_count_stmt = select(WebhookDelivery).where(WebhookDelivery.webhook_id == wh.id)
        d_res = await db.execute(del_count_stmt)
        count = len(d_res.scalars().all())
        w_out = WebhookOut.model_validate(wh)
        w_out.deliveries_count = count
        out.append(w_out)
    return out

@router.post("", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    req: WebhookCreate,
    current_user: User = Depends(require_paid_write),
    db: AsyncSession = Depends(get_db)
):
    # Reject private, loopback and link-local destinations at creation time so an
    # account cannot point a webhook at internal services or cloud metadata.
    allowed, reason = validate_webhook_url(req.url)
    if not allowed:
        raise HTTPException(status_code=400, detail=reason)

    wh = Webhook(
        account_id=current_user.account_id,
        url=req.url,
        events=req.events or ["*"],
        is_active=req.is_active if req.is_active is not None else True
    )
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    w_out = WebhookOut.model_validate(wh)
    w_out.deliveries_count = 0
    return w_out

@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    webhook_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Webhook).where(
        Webhook.id == webhook_id,
        Webhook.account_id == current_user.account_id
    )
    res = await db.execute(stmt)
    wh = res.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(wh)
    await db.commit()

@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    req: WebhookTestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Webhook).where(
        Webhook.id == webhook_id,
        Webhook.account_id == current_user.account_id
    )
    res = await db.execute(stmt)
    wh = res.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    test_data = {
        "event": req.event_type or "ping",
        "message": "Test webhook delivery from Docurama",
        "webhook_id": wh.id,
        "account_id": current_user.account_id
    }
    
    await WebhookDispatcher.dispatch_event(
        db, 
        current_user.account_id, 
        req.event_type or "ping", 
        test_data
    )
    return {"status": "dispatched", "message": "Test event sent to endpoint"}

@router.get("/{webhook_id}/deliveries", response_model=List[WebhookDeliveryOut])
async def list_webhook_deliveries(
    webhook_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(WebhookDelivery).join(Webhook).where(
        WebhookDelivery.webhook_id == webhook_id,
        Webhook.account_id == current_user.account_id
    ).order_by(WebhookDelivery.created_at.desc()).limit(50)
    res = await db.execute(stmt)
    return res.scalars().all()
