"""
Signup questionnaire endpoint.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user, require_interactive_session
from app.core.database import get_db
from app.models import User
from app.services.onboarding import apply_onboarding

router = APIRouter(tags=["onboarding"])


class OnboardingAnswers(BaseModel):
    role: Optional[str] = None
    use_case: Optional[str] = None
    monthly_volume: Optional[str] = None
    team_size: Optional[str] = None
    vertical: Optional[str] = None
    completed: bool = False


@router.post("/onboarding")
async def submit_onboarding(
    answers: OnboardingAnswers,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.account_id:
        raise _no_workspace()
    return await apply_onboarding(db, current_user.account_id, answers.model_dump())


def _no_workspace():
    return HTTPException(status_code=400, detail="No active workspace.")
