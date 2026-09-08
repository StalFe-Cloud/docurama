"""
Mail server configuration.

SMTP used to be read from environment variables, which meant a tenant could not send
from its own domain without editing the deployment. It is configured in the product
now: per account, falling back to a platform default.

These cover the two rules that matter. The password is write-only, so it never travels
back to a browser. And resolution falls back rather than failing, so a new company can
send before it has stood up a mail server of its own.
"""
import pytest

from app.core import config
from app.core.secrets import decrypt_secret, encrypt_secret, reset_cache
from app.services import mailer
from app.services.smtp_config import (
    DEFAULT_SMTP_SETTINGS,
    SmtpConfig,
    apply_update,
    redact,
    to_config,
)


def _profile(**overrides):
    data = dict(DEFAULT_SMTP_SETTINGS)
    data.update({
        "enabled": True,
        "host": "smtp.example.com",
        "from_email": "no-reply@example.com",
    })
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# The password never leaves the server
# ---------------------------------------------------------------------------

def test_redaction_removes_the_stored_credential():
    stored = _profile(password_encrypted=encrypt_secret("hunter2"))

    out = redact(stored)

    assert "password_encrypted" not in out
    assert "password" not in out
    assert out["password_set"] is True
    # Nothing in the projection may contain the ciphertext or the plaintext.
    assert "hunter2" not in str(out)
    assert stored["password_encrypted"] not in str(out)


def test_redaction_reports_when_no_password_is_stored():
    assert redact(_profile())["password_set"] is False
    assert redact(None)["password_set"] is False


def test_redaction_of_nothing_still_returns_the_documented_shape():
    out = redact(None)
    assert out["port"] == 587
    assert out["enabled"] is False


# ---------------------------------------------------------------------------
# Updates
# ---------------------------------------------------------------------------

def test_password_is_encrypted_on_write():
    merged = apply_update(None, {"host": "smtp.example.com", "password": "hunter2"})

    assert merged["password_encrypted"] != "hunter2"
    assert decrypt_secret(merged["password_encrypted"]) == "hunter2"


def test_omitting_the_password_leaves_the_stored_one_intact():
    """
    A form that never received the password must not wipe it when saving another field.
    """
    stored = _profile(password_encrypted=encrypt_secret("hunter2"))

    merged = apply_update(stored, {"host": "smtp2.example.com"})

    assert merged["host"] == "smtp2.example.com"
    assert decrypt_secret(merged["password_encrypted"]) == "hunter2"


def test_an_explicitly_empty_password_clears_it():
    stored = _profile(password_encrypted=encrypt_secret("hunter2"))

    merged = apply_update(stored, {"password": ""})

    assert merged["password_encrypted"] == ""


def test_clients_cannot_inject_ciphertext_directly():
    """password_encrypted is derived. Accepting it would let a caller set arbitrary bytes."""
    merged = apply_update(None, {"password_encrypted": "forged", "password_set": True})

    assert merged["password_encrypted"] == ""


def test_unknown_fields_are_ignored():
    merged = apply_update(None, {"host": "smtp.example.com", "is_platform_admin": True})

    assert "is_platform_admin" not in merged
    assert merged["host"] == "smtp.example.com"


# ---------------------------------------------------------------------------
# Usability
# ---------------------------------------------------------------------------

def test_a_disabled_profile_is_not_usable():
    assert to_config(_profile(enabled=False), "account") is None


def test_a_profile_without_a_host_is_not_usable():
    assert to_config(_profile(host=""), "account") is None


def test_a_profile_without_a_sender_is_not_usable():
    assert to_config(_profile(from_email=""), "account") is None


def test_a_complete_profile_is_usable():
    cfg = to_config(_profile(password_encrypted=encrypt_secret("hunter2")), "account")

    assert cfg is not None
    assert cfg.is_usable
    assert cfg.host == "smtp.example.com"
    assert cfg.password == "hunter2"
    assert cfg.source == "account"


def test_a_password_that_will_not_decrypt_makes_the_profile_unusable():
    """
    After SECRET_KEY rotation the stored password cannot be recovered. Sending with an
    empty password instead would surface as a confusing rejection from the mail server,
    so the profile is reported as unusable and the operator is told to re-enter it.
    """
    stored = _profile(password_encrypted=encrypt_secret("hunter2"))

    original = config.settings.SECRET_KEY
    try:
        object.__setattr__(config.settings, "SECRET_KEY", "a-different-key-" + "z" * 40)
        reset_cache()
        assert to_config(stored, "account") is None
    finally:
        object.__setattr__(config.settings, "SECRET_KEY", original)
        reset_cache()


# ---------------------------------------------------------------------------
# The mailer consumes a profile rather than globals
# ---------------------------------------------------------------------------

def test_mailer_reports_not_configured_without_a_profile():
    assert mailer.is_configured(None) is False

    result = mailer.send_email(None, "signer@example.com", "S", "s", "<p>h</p>", "t")
    assert result.sent is False
    assert "No mail server is configured" in result.error


def test_mailer_accepts_a_usable_profile():
    cfg = to_config(_profile(), "platform")
    assert mailer.is_configured(cfg) is True


def test_message_is_addressed_from_the_profile(monkeypatch):
    """The sender comes from the resolved profile, so each tenant sends as itself."""
    cfg = SmtpConfig(
        host="smtp.example.com", port=587, username="", password="",
        from_email="legal@tenant.example", from_name="Tenant Legal",
        use_tls=True, use_ssl=False, timeout=20, source="account",
    )

    captured = []

    class FakeServer:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def send_message(self, msg):
            captured.append(msg)

    monkeypatch.setattr(mailer, "_connect", lambda config: FakeServer())

    result = mailer.send_email(cfg, "signer@example.com", "Signer", "Subject", "<p>h</p>", "t")

    assert result.sent is True
    assert captured[0]["From"] == "Tenant Legal <legal@tenant.example>"
