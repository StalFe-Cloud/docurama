"""
Grant the platform-administrator flag to a user by email.

Usage (inside the API container, where the image ships this script at
/app/scripts/grant_platform_admin.py):
    python scripts/grant_platform_admin.py ops@example.com

From a repository checkout the same command works, but the settings loader
does not read a .env file, so export the real configuration as environment
variables first (at minimum DOCURAMA_DATABASE_URL, plus DOCURAMA_SECRET_KEY
and DOCURAMA_P12_PASSWORD outside development).

Exits 0 when the flag was granted, 1 when the user does not exist.
"""
import asyncio
import os
import sys

# Point Python at the directory that CONTAINS the app package, derived from this
# file's location so it works from any working directory: <root>/backend in a
# repository checkout (script at <root>/scripts, package at <root>/backend/app),
# or /app inside the API container (script at /app/scripts, package at /app/app).
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.path.isdir(os.path.join(_BASE, "backend", "app")):
    sys.path.insert(0, os.path.join(_BASE, "backend"))
else:
    sys.path.insert(0, _BASE)

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
