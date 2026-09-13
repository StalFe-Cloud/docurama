"""
Reset the password for an administrator account on the deployed stack.

The password is supplied at run time and hashed locally with the same passlib
context the API uses; neither the plaintext nor a pre-computed hash is stored in
this repository.

Usage:
    python scripts/seed_admin.py --email admin@example.com
    DOCURAMA_ADMIN_PASSWORD='...' python scripts/seed_admin.py --email admin@example.com

Without --password or DOCURAMA_ADMIN_PASSWORD the script prompts, and with
--generate it creates a strong password and prints it once.
"""
import argparse
import getpass
import os
import secrets
import subprocess
import sys

# Deployment target: provided by the environment, never committed.
# Production infrastructure details (hosts, users, key paths) do not belong in
# a repository - commit history is effectively a disclosure.
NEXA_HOST = os.getenv("DOCURAMA_VPS_HOST", "")
NEXA_USER = os.getenv("DOCURAMA_VPS_USER", "")
NEXA_KEY = os.path.expanduser(os.getenv("DOCURAMA_VPS_KEY", "~/.ssh/id_ed25519"))

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
os.environ.setdefault("DOCURAMA_ENV", "development")


def hash_password(plain: str) -> str:
    from app.core.security import get_password_hash
    return get_password_hash(plain)


def run_remote_sql(sql: str):
    """Pipe SQL into the postgres container over SSH, passing it on stdin only."""
    remote = (
        "docker exec -i docurama-postgres "
        "psql -U \"${POSTGRES_USER:-docurama}\" -d \"${POSTGRES_DB:-docurama}\""
    )
    cmd = [
        "ssh", "-i", NEXA_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        f"{NEXA_USER}@{NEXA_HOST}",
        remote,
    ]
    res = subprocess.run(cmd, input=sql, text=True, capture_output=True, encoding="utf-8")
    if res.stdout:
        print(res.stdout.strip())
    if res.stderr and res.returncode != 0:
        print("STDERR:", res.stderr.strip())
    return res


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset a Docurama administrator password.")
    parser.add_argument("--email", required=True, help="Email address of the account to update.")
    parser.add_argument("--password", help="New password. Prefer the prompt or DOCURAMA_ADMIN_PASSWORD.")
    parser.add_argument("--generate", action="store_true", help="Generate a strong password and print it once.")
    args = parser.parse_args()

    if args.generate:
        password = secrets.token_urlsafe(18)
        print(f"Generated password for {args.email}: {password}")
        print("Store it in your password manager now; it is not shown again.")
    else:
        password = args.password or os.getenv("DOCURAMA_ADMIN_PASSWORD") or getpass.getpass(
            f"New password for {args.email}: "
        )

    if not password or len(password) < 12:
        print("Refusing to set a password shorter than 12 characters.", file=sys.stderr)
        return 1

    hashed = hash_password(password)

    # psql variables keep the values out of the SQL string itself.
    sql = (
        "\\set ON_ERROR_STOP on\n"
        f"\\set target_email {_quote(args.email)}\n"
        f"\\set new_hash {_quote(hashed)}\n"
        "UPDATE users SET created_at = NOW() WHERE created_at IS NULL;\n"
        "UPDATE users SET hashed_password = :'new_hash', updated_at = NOW() "
        "WHERE email = :'target_email';\n"
        "SELECT id, email, role, is_active FROM users WHERE email = :'target_email';\n"
    )

    res = run_remote_sql(sql)
    if res.returncode != 0:
        print("Password reset failed.", file=sys.stderr)
        return res.returncode

    print(f"Password updated for {args.email}.")
    return 0


def _quote(value: str) -> str:
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


if __name__ == "__main__":
    sys.exit(main())
