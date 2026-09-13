"""
Legal notice intake (Sprint 3 - compliance items 5 and 13 of §15.4).

A public, rate-limited intake for DMCA counter-notices and TAKE IT DOWN
requests. The sworn statements are captured verbatim because under both
policies the reporter's statement is the legal instrument; paraphrasing it
would make the platform a co-author of the claim. The reporter's IP is stored
with the notice - it is the only way to distinguish a good-faith reporter from
a serial abusive filer, and it is only ever surfaced to platform
administrators.

The 48-hour SLA on TAKE IT DOWN is a policy commitment (§15.4 item 13), and
the admin resolution queue carries the SLA label so the clock is visible
rather than aspirational.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.api.auth import get_current_user
from app.models import LegalNotice, User

router = APIRouter(prefix="/legal", tags=["legal"])

SLA_BY_KIND = {
    "dmca": "5 business days",
    "take_it_down": "48 hours",
}


def _now():
    return datetime.now(timezone.utc)


class LegalNoticeIn(BaseModel):
    kind: str = Field(default="dmca", pattern="^(dmca|take_it_down)$")
    reporter_name: str = Field(min_length=2, max_length=255)
    reporter_email: EmailStr
    reporter_company: str = Field(default="", max_length=255)
    content_location: str = Field(min_length=4, max_length=1000, description="URL or verification code of the material")
    original_work_reference: str = Field(min_length=4, max_length=2000)
    description: str = Field(min_length=10, max_length=8000)


class LegalNoticeOut(BaseModel):
    id: str
    kind: str
    status: str
    sla: str


@router.post("/dmca", response_model=LegalNoticeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def submit_notice(
    request: Request,
    payload: LegalNoticeIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    File a DMCA or TAKE IT DOWN notice.

    Public on purpose: a right-holder who cannot reach the intake will email
    whoever they can find, and an email is where legal deadlines go to die.
    The response carries the SLA so the reporter knows the commitment they can
    hold the platform to.
    """
    reporter_ip = request.client.host if request.client else None
    notice = LegalNotice(
        kind=payload.kind,
        status="pending",
        sla=SLA_BY_KIND[payload.kind],
        reporter_name=payload.reporter_name.strip(),
        reporter_email=str(payload.reporter_email).strip(),
        reporter_company=payload.reporter_company.strip(),
        content_location=payload.content_location.strip(),
        original_work_reference=payload.original_work_reference.strip(),
        description=payload.description.strip(),
        reporter_ip=reporter_ip,
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    return LegalNoticeOut(id=notice.id, kind=notice.kind, status=notice.status, sla=notice.sla)


async def _require_platform_admin(user: User) -> User:
    if not getattr(user, "is_platform_admin", False):
        raise HTTPException(status_code=403, detail="Platform administrator access required.")
    return user


@router.get("/notices", response_model=List[dict])
async def list_notices(
    ticket_status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Platform-admin queue of legal notices with their SLAs."""
    await _require_platform_admin(current_user)
    query = select(LegalNotice).order_by(LegalNotice.created_at.desc()).limit(200)
    if ticket_status:
        query = query.where(LegalNotice.status == ticket_status)
    notices = (await db.execute(query)).scalars().all()
    return [
        {
            "id": n.id,
            "kind": n.kind,
            "status": n.status,
            "sla": n.sla,
            "reporter_name": n.reporter_name,
            "reporter_email": n.reporter_email,
            "content_location": n.content_location,
            "description": n.description,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "resolved_at": n.resolved_at.isoformat() if n.resolved_at else None,
            "resolution": n.resolution or "",
        }
        for n in notices
    ]


class NoticeResolution(BaseModel):
    resolution: str = Field(min_length=4, max_length=4000)
    new_status: str = Field(default="resolved", pattern="^(resolved|dismissed|escalated)$")


@router.post("/notices/{notice_id}/resolve", response_model=LegalNoticeOut)
async def resolve_notice(
    notice_id: str,
    payload: NoticeResolution,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a decision on a notice; the decision text is retained verbatim."""
    await _require_platform_admin(current_user)
    notice = (await db.execute(
        select(LegalNotice).where(LegalNotice.id == notice_id)
    )).scalar_one_or_none()
    if notice is None:
        raise HTTPException(status_code=404, detail="Notice not found.")
    notice.status = payload.new_status
    notice.resolution = payload.resolution.strip()
    notice.resolved_at = _now()
    notice.resolved_by = current_user.email
    await db.commit()
    return LegalNoticeOut(id=notice.id, kind=notice.kind, status=notice.status, sla=notice.sla)
