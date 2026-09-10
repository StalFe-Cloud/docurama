"""
Time-based one-time passwords (RFC 6238) and recovery codes.

Implemented on the standard library rather than a dependency. TOTP is HMAC over a
counter derived from the clock; the whole algorithm is a dozen lines, and a security
primitive is a poor place to take on supply-chain surface for that much code.

The provisioning URI is rendered as a QR by the existing qr_generator, which already
produces the verification codes on certificates of completion.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import List, Optional, Tuple
from urllib.parse import quote

# RFC 6238 defaults, and what every authenticator app assumes.
DIGITS = 6
PERIOD_SECONDS = 30

# One step either side, so a code is accepted across a clock skew of up to 30 seconds
# in each direction. Wider than this starts extending the useful life of an
# intercepted code for no real usability gain.
DEFAULT_SKEW_STEPS = 1

RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_BYTES = 5  # 10 hex characters


def generate_secret(length_bytes: int = 20) -> str:
    """
    Mint a base32 secret. 20 bytes is the RFC 4226 recommendation and what
    authenticator apps expect.
    """
    return base64.b32encode(secrets.token_bytes(length_bytes)).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int, digits: int = DIGITS) -> str:
    """One HOTP value (RFC 4226), which TOTP is a time-keyed special case of."""
    # Restore the padding base64 strips; authenticator apps show secrets unpadded.
    padding = "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(secret_b32.upper() + padding, casefold=True)

    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)


def generate_code(secret_b32: str, at_time: Optional[float] = None, digits: int = DIGITS) -> str:
    """The code an authenticator would show right now. Used by tests and previews."""
    now = at_time if at_time is not None else time.time()
    return _hotp(secret_b32, int(now // PERIOD_SECONDS), digits)


def verify_code(
    secret_b32: str,
    submitted: str,
    at_time: Optional[float] = None,
    skew_steps: int = DEFAULT_SKEW_STEPS,
) -> bool:
    """
    Check a submitted code against the secret.

    Compared in constant time, and every candidate step is evaluated rather than
    returning on the first match, so the answer does not leak which step matched.
    """
    if not secret_b32 or not submitted:
        return False

    cleaned = "".join(ch for ch in str(submitted) if ch.isdigit())
    if len(cleaned) != DIGITS:
        return False

    now = at_time if at_time is not None else time.time()
    counter = int(now // PERIOD_SECONDS)

    matched = False
    for step in range(-skew_steps, skew_steps + 1):
        try:
            candidate = _hotp(secret_b32, counter + step)
        except Exception:
            return False
        if hmac.compare_digest(candidate, cleaned):
            matched = True
    return matched


def provisioning_uri(secret_b32: str, account_name: str, issuer: str = "Docurama") -> str:
    """
    The otpauth:// URI an authenticator app scans.

    Both the issuer parameter and the issuer prefix on the label are included; some
    apps read one and some the other, and disagreeing looks like a different account.
    """
    label = quote(f"{issuer}:{account_name}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret_b32}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD_SECONDS}"
    )


# ---------------------------------------------------------------------------
# Recovery codes
# ---------------------------------------------------------------------------

def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> Tuple[List[str], List[str]]:
    """
    Return (plaintext_codes, hashed_codes).

    The plaintext is shown once at enrolment and never again; only the hashes are
    stored. Formatted in two groups for legibility when written down, which is what
    these are for.
    """
    plaintext, hashed = [], []
    for _ in range(count):
        raw = secrets.token_hex(RECOVERY_CODE_BYTES)
        code = f"{raw[:5]}-{raw[5:]}"
        plaintext.append(code)
        hashed.append(hash_recovery_code(code))
    return plaintext, hashed


def hash_recovery_code(code: str) -> str:
    """SHA-256 of the normalised code. These carry full entropy, so no KDF is needed."""
    return hashlib.sha256(_normalise_recovery_code(code).encode("utf-8")).hexdigest()


def _normalise_recovery_code(code: str) -> str:
    """Ignore case, spacing and the separator, since these get typed by hand."""
    return "".join(ch for ch in (code or "").lower() if ch.isalnum())


def consume_recovery_code(code: str, hashed_codes: List[str]) -> Tuple[bool, List[str]]:
    """
    Check a recovery code and burn it.

    Returns (accepted, remaining_hashes). A used code is removed rather than marked,
    so a stolen list cannot be replayed even once more.
    """
    if not code or not hashed_codes:
        return False, list(hashed_codes or [])

    candidate = hash_recovery_code(code)
    remaining = list(hashed_codes)

    for index, stored in enumerate(remaining):
        if hmac.compare_digest(stored, candidate):
            remaining.pop(index)
            return True, remaining

    return False, remaining
