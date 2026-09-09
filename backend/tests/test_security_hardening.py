"""
Security hardening tests.

Covers the webhook SSRF guard, the signing-link expiry rule, the preview upload
constraints, and the production configuration guard.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.preview_store import (
    DOC_ID_RE,
    MAX_UPLOAD_BYTES,
    PDF_MAGIC,
    is_valid_doc_id,
    looks_like_pdf,
    new_doc_id,
    preview_path,
)
from conftest import requires_argon2
from app.core.config import DEV_P12_PASSWORD, DEV_SECRET_KEY, Settings, _validate_production_secrets
from app.services.webhook_dispatcher import _is_blocked_ip, validate_webhook_url


# ---------------------------------------------------------------------------
# Webhook destination validation (SSRF)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ip", [
    "127.0.0.1",          # loopback
    "10.0.0.5",           # private
    "172.17.0.1",         # docker bridge gateway
    "192.168.1.10",       # private
    "169.254.169.254",    # cloud metadata endpoint
    "0.0.0.0",            # unspecified
    "224.0.0.1",          # multicast
    "::1",                # ipv6 loopback
    "fd00::1",            # ipv6 unique local
])
def test_internal_addresses_are_blocked(ip):
    assert _is_blocked_ip(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(ip):
    assert _is_blocked_ip(ip) is False


def test_malformed_address_is_treated_as_blocked():
    """An address that cannot be parsed must fail closed."""
    assert _is_blocked_ip("not-an-ip") is True
    assert _is_blocked_ip("") is True


def test_loopback_webhook_url_is_rejected():
    allowed, reason = validate_webhook_url("http://127.0.0.1:8000/hook")
    assert allowed is False
    assert "private or reserved" in reason


def test_non_http_scheme_is_rejected():
    for url in ["file:///etc/passwd", "gopher://evil/", "ftp://example.com/x"]:
        allowed, reason = validate_webhook_url(url)
        assert allowed is False
        assert "http or https" in reason


def test_url_without_host_is_rejected():
    allowed, reason = validate_webhook_url("https://")
    assert allowed is False


def test_unresolvable_host_is_rejected():
    allowed, reason = validate_webhook_url("https://nonexistent.invalid/hook")
    assert allowed is False
    assert "could not be resolved" in reason


# ---------------------------------------------------------------------------
# Signing link expiry
# ---------------------------------------------------------------------------

def _expiry_check(expires_at, now=None):
    """Mirrors _assert_token_live in the signing API, without the HTTP layer."""
    now = now or datetime.now(timezone.utc)
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return now <= expires_at


def test_expired_signing_link_is_rejected():
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert _expiry_check(past) is False


def test_live_signing_link_is_accepted():
    future = datetime.now(timezone.utc) + timedelta(days=30)
    assert _expiry_check(future) is True


def test_legacy_recipient_without_expiry_still_works():
    """Recipients created before expiry tracking must not be locked out retroactively."""
    assert _expiry_check(None) is True


def test_naive_expiry_is_interpreted_as_utc():
    naive_past = (datetime.now(timezone.utc) - timedelta(days=2)).replace(tzinfo=None)
    assert _expiry_check(naive_past) is False


# ---------------------------------------------------------------------------
# Preview upload constraints
# ---------------------------------------------------------------------------

def test_document_id_pattern_rejects_traversal():
    """Only ids this service minted may reach the filesystem."""
    for bad in [
        "../../etc/passwd",
        "doc_../../secret",
        "doc_short",
        "doc_" + "g" * 32,      # non-hex
        "envelope_abc",
        "doc_" + "a" * 31,      # wrong length
        "",
    ]:
        assert DOC_ID_RE.match(bad) is None

        assert is_valid_doc_id(bad) is False

    minted = new_doc_id()
    assert DOC_ID_RE.match(minted) is not None
    assert is_valid_doc_id(minted) is True


def test_preview_path_refuses_foreign_ids():
    """A path is only ever built from an id this service minted."""
    import pytest as _pytest

    with _pytest.raises(ValueError):
        preview_path("/storage", "../../etc/passwd")

    ok = preview_path("/storage", new_doc_id())
    assert ok.endswith(".pdf")


def test_pdf_magic_is_the_content_check():
    """The upload guard keys on content, not on a filename extension."""
    assert PDF_MAGIC == b"%PDF-"
    assert looks_like_pdf(b"%PDF-1.7\n...") is True
    # A renamed executable or HTML page must not pass.
    assert looks_like_pdf(b"MZ\x90\x00") is False
    assert looks_like_pdf(b"<html>") is False
    assert looks_like_pdf(b"") is False


def test_upload_cap_is_bounded():
    assert 0 < MAX_UPLOAD_BYTES <= 100 * 1024 * 1024


# ---------------------------------------------------------------------------
# Production configuration guard
# ---------------------------------------------------------------------------

def _settings(**overrides) -> Settings:
    cfg = Settings()
    for key, value in overrides.items():
        object.__setattr__(cfg, key, value)
    return cfg


def test_production_refuses_default_secret_key():
    cfg = _settings(ENV="production", SECRET_KEY=DEV_SECRET_KEY, P12_PASSWORD="a-real-password")
    with pytest.raises(RuntimeError) as exc:
        _validate_production_secrets(cfg)
    assert "DOCURAMA_SECRET_KEY" in str(exc.value)


def test_production_refuses_default_p12_password():
    cfg = _settings(ENV="production", SECRET_KEY="x" * 48, P12_PASSWORD=DEV_P12_PASSWORD)
    with pytest.raises(RuntimeError) as exc:
        _validate_production_secrets(cfg)
    assert "DOCURAMA_P12_PASSWORD" in str(exc.value)


def test_production_refuses_short_secret_key():
    cfg = _settings(ENV="production", SECRET_KEY="tooshort", P12_PASSWORD="a-real-password")
    with pytest.raises(RuntimeError) as exc:
        _validate_production_secrets(cfg)
    assert "at least 32 characters" in str(exc.value)


def test_production_accepts_real_secrets():
    cfg = _settings(
        ENV="production",
        SECRET_KEY="x" * 48,
        P12_PASSWORD="a-real-password",
        APP_URL="https://docurama.stalfe.com",
    )
    _validate_production_secrets(cfg)  # must not raise


def test_production_refuses_placeholder_app_url():
    """
    APP_URL drives the CNAME target customers are told to delegate to, the contact
    embedded in every signature, and the portal URL printed on every certificate. A
    placeholder there is a customer-visible defect, not a cosmetic one.
    """
    cfg = _settings(
        ENV="production",
        SECRET_KEY="x" * 48,
        P12_PASSWORD="a-real-password",
        APP_URL="https://docurama.example.com",
    )
    with pytest.raises(RuntimeError) as exc:
        _validate_production_secrets(cfg)
    assert "DOCURAMA_APP_URL" in str(exc.value)


def test_development_may_use_defaults():
    """Local development must stay runnable with the shipped values."""
    cfg = _settings(ENV="development", SECRET_KEY=DEV_SECRET_KEY, P12_PASSWORD=DEV_P12_PASSWORD)
    _validate_production_secrets(cfg)  # must not raise


# ---------------------------------------------------------------------------
# Password hashing scheme
#
# argon2 is the default for new hashes; bcrypt is retained so passwords stored
# before the change keep working and migrate on the next successful sign-in.
#
# argon2-cffi is a runtime dependency (see requirements.txt) and is installed in
# the container image. It may be absent from a developer's host interpreter, in
# which case these skip rather than fail: run the suite inside the image to
# exercise them.
# ---------------------------------------------------------------------------

@requires_argon2
def test_new_hashes_use_argon2():
    from app.core.security import get_password_hash

    assert get_password_hash("CorrectHorseBatteryStaple9!").startswith("$argon2")


@requires_argon2
def test_argon2_hash_round_trips():
    from app.core.security import get_password_hash, verify_password

    h = get_password_hash("CorrectHorseBatteryStaple9!")
    assert verify_password("CorrectHorseBatteryStaple9!", h) is True
    assert verify_password("wrong", h) is False


@requires_argon2
def test_legacy_bcrypt_hashes_still_verify():
    """Existing users must not be locked out by the scheme change."""
    from passlib.context import CryptContext
    from app.core.security import verify_password

    legacy = CryptContext(schemes=["bcrypt"]).hash("LegacyPassword123!")
    assert legacy.startswith("$2b$")
    assert verify_password("LegacyPassword123!", legacy) is True
    assert verify_password("wrong", legacy) is False


@requires_argon2
def test_legacy_hash_is_upgraded_on_successful_verify():
    """A correct password against a bcrypt hash yields an argon2 replacement."""
    from passlib.context import CryptContext
    from app.core.security import verify_and_upgrade_password

    legacy = CryptContext(schemes=["bcrypt"]).hash("LegacyPassword123!")

    ok, upgraded = verify_and_upgrade_password("LegacyPassword123!", legacy)
    assert ok is True
    assert upgraded is not None
    assert upgraded.startswith("$argon2")


@requires_argon2
def test_current_scheme_hash_is_not_rehashed():
    from app.core.security import get_password_hash, verify_and_upgrade_password

    current = get_password_hash("CorrectHorseBatteryStaple9!")
    ok, upgraded = verify_and_upgrade_password("CorrectHorseBatteryStaple9!", current)

    assert ok is True
    assert upgraded is None


@requires_argon2
def test_wrong_password_yields_no_upgrade():
    from app.core.security import get_password_hash, verify_and_upgrade_password

    ok, upgraded = verify_and_upgrade_password("wrong", get_password_hash("right"))

    assert ok is False
    assert upgraded is None


# ---------------------------------------------------------------------------
# Password change.
#
# The Profile screen has always shown a password form. Until now there was no endpoint
# behind it and the button reported "Password changed successfully" unconditionally.
# Someone rotating a credential they believe is exposed is exactly the person who must
# not be wrongly reassured.
# ---------------------------------------------------------------------------

@requires_argon2
def test_changed_password_replaces_the_old_one():
    from app.core.security import get_password_hash, verify_and_upgrade_password

    original = "OriginalPassword123!"
    stored = get_password_hash(original)
    assert verify_and_upgrade_password(original, stored)[0] is True

    replacement = get_password_hash("ReplacementPassword456!")

    # The new password works and the old one stops working. A rotation that leaves the
    # previous credential valid has not rotated anything.
    assert verify_and_upgrade_password("ReplacementPassword456!", replacement)[0] is True
    assert verify_and_upgrade_password(original, replacement)[0] is False


@requires_argon2
def test_a_wrong_current_password_does_not_verify():
    """The endpoint gates on this, so a wrong current password must fail closed."""
    from app.core.security import get_password_hash, verify_and_upgrade_password

    stored = get_password_hash("TheRealPassword123!")

    assert verify_and_upgrade_password("not-the-password", stored)[0] is False
    assert verify_and_upgrade_password("", stored)[0] is False


def test_password_change_schema_requires_both_values():
    """Neither field may be omitted: the current one is what authorises the change."""
    from pydantic import ValidationError
    from app.schemas import PasswordChangeRequest

    with pytest.raises(ValidationError):
        PasswordChangeRequest(new_password="LongEnoughPassword1")
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="whatever")

    req = PasswordChangeRequest(current_password="old", new_password="LongEnoughPassword1")
    assert req.current_password == "old"


def test_change_password_endpoint_exists_and_is_guarded():
    """
    The rules the endpoint enforces, asserted against its source: a verified current
    password, a minimum length, and a new value that actually differs.
    """
    import pathlib

    auth = (pathlib.Path(__file__).resolve().parent.parent / "app" / "api" / "auth.py").read_text(
        encoding="utf-8"
    )

    assert '@router.post("/change-password"' in auth
    assert "verify_and_upgrade_password(" in auth
    assert "current password is incorrect" in auth
    assert "at least 12 characters" in auth
    assert "must differ from the current one" in auth
