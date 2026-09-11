"""
Signup questionnaire and starter packs.

The answers persist into the account's settings so later phases (billing,
templates, tours) can adapt to them. A vertical also materializes starter
template folders, once: re-running onboarding must never duplicate folders.
"""
from typing import Dict, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import AccountSetting, TemplateFolder

VERTICAL_PACKS: Dict[str, List[str]] = {
    "hr": ["Employment & HR"],
    "sales": ["Sales & Commercial"],
    "legal": ["Legal & Contracts"],
    "real_estate": ["Real Estate"],
    "finance": ["Finance & Procurement"],
}

ANSWER_KEYS = ["role", "use_case", "monthly_volume", "team_size", "vertical",
               "completed"]


async def apply_onboarding(db: AsyncSession, account_id: str, answers: dict) -> dict:
    cleaned = {k: answers.get(k) for k in ANSWER_KEYS if k in answers}

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == "onboarding",
        )
    )).scalar_one_or_none()
    stored = row.data if row else {}
    merged = {**(stored or {}), **cleaned}

    vertical = merged.get("vertical")
    if vertical in VERTICAL_PACKS:
        existing = set((await db.execute(
            select(TemplateFolder.name).where(
                TemplateFolder.account_id == account_id,
                TemplateFolder.name.in_(VERTICAL_PACKS[vertical]),
            )
        )).scalars().all())
        for name in VERTICAL_PACKS[vertical]:
            if name not in existing:
                db.add(TemplateFolder(account_id=account_id, name=name))

    if row:
        row.data = merged
    else:
        db.add(AccountSetting(account_id=account_id, section="onboarding",
                              data=merged))
    await db.commit()
    return merged
