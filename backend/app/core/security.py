import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Any, Dict
import jwt
# PyJWT replaces python-jose: the jose dependency tree pins ecdsa, which carries
# an unfixed advisory (PYSEC-2026-1325) reachable only through EC-key algorithms
# this platform never uses. PyJWT relies on cryptography alone. The alias keeps
# every call site unchanged: PyJWTError is the base of all decode failures,
# matching the breadth of jose's JWTError.
from jwt import PyJWTError as JWTError
from passlib.context import CryptContext
from app.core.config import settings

# Argon2id is the default for new hashes; bcrypt is retained so that passwords
# hashed before this change continue to verify.
#
# The order matters. With bcrypt first, passlib 1.7.4 emits an "error reading bcrypt
# version" traceback on every backend load against bcrypt 4.x, and the stronger
# algorithm goes unused despite argon2-cffi already being a dependency.
pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated="auto"
)

ALGORITHM = "HS256"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Check a password against a stored hash.

    Accepts both argon2 and legacy bcrypt hashes. Callers that can persist an updated
    hash should use verify_and_upgrade_password instead, so old hashes migrate.
    """
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def verify_and_upgrade_password(plain_password: str, hashed_password: str):
    """
    Check a password and, when it was stored under a superseded scheme, return a
    replacement hash so the caller can persist the upgrade.

    Returns (is_valid, new_hash_or_None).
    """
    try:
        valid, new_hash = pwd_context.verify_and_update(plain_password, hashed_password)
        return bool(valid), new_hash
    except Exception:
        return False, None

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(subject: str | Any, expires_delta: Optional[timedelta] = None, claims: Optional[Dict[str, Any]] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"exp": expire, "sub": str(subject)}
    if claims:
        to_encode.update(claims)
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

def generate_secure_token(nbytes: int = 32) -> str:
    """Generate a URL-safe cryptographically strong random token."""
    return secrets.token_urlsafe(nbytes)
