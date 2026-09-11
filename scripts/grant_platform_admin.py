"""
Grant the platform-administrator flag to a user by email.

Usage (inside the API container, or any environment with a configured .env):
    python scripts/grant_platform_admin.py ops@example.com

Exits 0 when the flag was granted, 1 when the user does not exist.
"""
import asyncio
import sys

sys.path.insert(0, "backend")

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services.platform_admin import grant_platform_admin  # noqa: E402


async def main(email: str) -> int:
    async with AsyncSessionLocal() as session:
        granted = await grant_platform_admin(session, email)
    if not granted:
        print(f"No user found with email {email}")
        return 1
    print(f"Granted platform admin to {email}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
