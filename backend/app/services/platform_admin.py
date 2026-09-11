"""
Platform administrator bootstrap.

users.is_platform_admin gates the deployment-wide settings (the default mail
server, and later billing and tenant administration). No web endpoint grants it:
the first platform admin is created by an operator with shell access to the
deployment, which is the same trust boundary that owns the environment.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import User


async def grant_platform_admin(db: AsyncSession, email: str) -> bool:
    user = (await db.execute(
        select(User).where(User.email == (email or "").strip().lower())
    )).scalar_one_or_none()
    if not user:
        return False
    user.is_platform_admin = True
    await db.commit()
    return True
