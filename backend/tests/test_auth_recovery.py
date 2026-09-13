"""
Password reset and two-factor authentication.

Both screens existed and reported success while doing nothing: the Profile tab
offered a password form with no endpoint behind it, and the 2FA modal showed a static
icon in place of a QR code. These cover the properties that make the real
implementations safe rather than merely present.
"""
import base64
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.services import password_reset as reset
from app.services import totp


# ---------------------------------------------------------------------------
# TOTP, against the published vectors
# ---------------------------------------------------------------------------

# RFC 6238 Appendix B, SHA-1, seed "12345678901234567890".
RFC_SEED = base64.b32encode(b"12345678901234567890").decode().rstrip("=")


@pytest.mark.parametrize("at_time,expected", [
    (59, "287082"),
    (1111111109, "081804"),
    (1111111111, "050471"),
    (1234567890, "005924"),
    (2000000000, "279037"),
])
def test_rfc6238_test_vectors(at_time, expected):
    """If these drift, every authenticator app in the world disagrees with us."""
    assert totp.generate_code(RFC_SEED, at_time=at_time) == expected


def test_generated_secrets_are_base32_and_unique():
    secrets_seen = {totp.generate_secret() for _ in range(20)}
    assert len(secrets_seen) == 20
    for s in secrets_seen:
        # Must decode with the padding an authenticator would restore.
        base64.b32decode(s + "=" * (-len(s) % 8), casefold=True)


def test_current_code_verifies():
    secret = totp.generate_secret()
    assert totp.verify_code(secret, totp.generate_code(secret)) is True


def test_wrong_code_is_refused():
    secret = totp.generate_secret()
    wrong = "000000" if totp.generate_code(secret) != "000000" else "111111"
    assert totp.verify_code(secret, wrong) is False


def test_clock_skew_is_tolerated_one_step_either_way():
    """A user's phone and the server are never exactly in step."""
    secret = totp.generate_secret()
    now = time.time()

    for offset in (-totp.PERIOD_SECONDS, 0, totp.PERIOD_SECONDS):
        code = totp.generate_code(secret, at_time=now + offset)
        assert totp.verify_code(secret, code, at_time=now) is True


def test_codes_outside_the_skew_window_are_refused():
    """An old code must stop working, or interception stays useful for minutes."""
    secret = totp.generate_secret()
    now = time.time()
    stale = totp.generate_code(secret, at_time=now - (totp.PERIOD_SECONDS * 3))

    assert totp.verify_code(secret, stale, at_time=now) is False


@pytest.mark.parametrize("bad", ["", None, "12345", "1234567", "abcdef", "12 34 56x"])
def test_malformed_codes_are_refused(bad):
    assert totp.verify_code(totp.generate_secret(), bad) is False


def test_verification_against_an_empty_secret_fails_closed():
    assert totp.verify_code("", "123456") is False


def test_provisioning_uri_carries_what_an_app_needs():
    secret = totp.generate_secret()
    uri = totp.provisioning_uri(secret, "ada@example.com", issuer="Docurama")

    assert uri.startswith("otpauth://totp/")
    assert f"secret={secret}" in uri
    assert "issuer=Docurama" in uri
    # The label must be issuer-prefixed as well; apps disagree about which they read.
    assert "Docurama%3Aada%40example.com" in uri


# ---------------------------------------------------------------------------
# Recovery codes
# ---------------------------------------------------------------------------

def test_recovery_codes_are_generated_hashed_and_unique():
    plaintext, hashed = totp.generate_recovery_codes()

    assert len(plaintext) == totp.RECOVERY_CODE_COUNT
    assert len(set(plaintext)) == totp.RECOVERY_CODE_COUNT
    # Only hashes are stored; no plaintext may be recoverable from them.
    for code, digest in zip(plaintext, hashed):
        assert code not in digest
        assert len(digest) == 64


def test_a_recovery_code_works_once_and_then_never_again():
    """
    Single use is the whole point. A list that keeps working is a password that
    cannot be changed.
    """
    plaintext, hashed = totp.generate_recovery_codes()
    code = plaintext[0]

    accepted, remaining = totp.consume_recovery_code(code, hashed)
    assert accepted is True
    assert len(remaining) == len(hashed) - 1

    accepted_again, still_remaining = totp.consume_recovery_code(code, remaining)
    assert accepted_again is False
    assert len(still_remaining) == len(remaining)


def test_recovery_codes_ignore_case_and_separators():
    """These get read off paper and typed by hand."""
    plaintext, hashed = totp.generate_recovery_codes()
    messy = plaintext[0].upper().replace("-", " ")

    accepted, _ = totp.consume_recovery_code(messy, hashed)
    assert accepted is True


def test_an_unknown_recovery_code_consumes_nothing():
    _plaintext, hashed = totp.generate_recovery_codes()

    accepted, remaining = totp.consume_recovery_code("dead0-beef0", hashed)
    assert accepted is False
    assert len(remaining) == len(hashed)


# ---------------------------------------------------------------------------
# Password reset tokens
# ---------------------------------------------------------------------------

def test_reset_token_is_stored_only_as_a_hash():
    plaintext, hashed = reset.generate_token()

    assert plaintext not in hashed
    assert len(hashed) == 64
    assert reset.tokens_match(plaintext, hashed) is True


def test_a_different_token_does_not_match():
    _p1, h1 = reset.generate_token()
    p2, _h2 = reset.generate_token()

    assert reset.tokens_match(p2, h1) is False
    assert reset.tokens_match("", h1) is False


def test_reset_tokens_are_unique():
    assert len({reset.generate_token()[0] for _ in range(50)}) == 50


def test_a_fresh_token_is_redeemable():
    assert reset.is_redeemable(reset.expiry_from_now(), None) is True


def test_an_expired_token_is_not_redeemable():
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert reset.is_redeemable(past, None) is False


def test_a_used_token_is_not_redeemable_even_before_expiry():
    """
    Single use and expiry are independent. A link sitting in an inbox must not be
    replayable by whoever reads that inbox next.
    """
    future = reset.expiry_from_now()
    assert reset.is_redeemable(future, datetime.now(timezone.utc)) is False


def test_a_token_with_no_expiry_is_not_redeemable():
    """Fail closed: a row missing its expiry is malformed, not eternal."""
    assert reset.is_redeemable(None, None) is False


def test_naive_expiry_is_read_as_utc():
    naive_past = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(tzinfo=None)
    assert reset.is_redeemable(naive_past, None) is False


def test_token_lifetime_is_bounded():
    """A reset link that lives for days is a standing account takeover."""
    assert 0 < reset.TOKEN_TTL_MINUTES <= 24 * 60


def test_password_rules_are_shared_between_reset_and_change():
    assert reset.validate_new_password("short") is not None
    assert reset.validate_new_password("a-long-enough-password") is None
    # The change-password path also forbids reusing the current one.
    assert reset.validate_new_password("same-password-here", "same-password-here") is not None
    assert reset.validate_new_password("a-new-password-here", "old-password-here") is None


def test_reset_url_is_built_from_the_configured_app_url():
    url = reset.reset_url("https://docurama.stalfe.com/", "tok123")
    assert url == "https://docurama.stalfe.com/reset-password?token=tok123"
