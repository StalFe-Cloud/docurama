"""
Settings persistence tests.

The defect these cover: the settings screen rendered API keys, certificates and
preferences from hardcoded arrays in the React component, so nothing survived a
reload and issued keys authenticated nothing.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.account_settings import DEFAULT_SECTION_DATA, VALID_SECTIONS, merge_section
from app.schemas import (
    AccountSettingUpdate,
    ApiKeyCreate,
    ApiKeyCreatedOut,
    SigningCertificateCreate,
)
from app.services import api_keys as svc


# ---------------------------------------------------------------------------
# Key minting
# ---------------------------------------------------------------------------

def test_generated_key_is_verifiable_against_its_hash():
    plaintext, prefix, hashed = svc.generate_api_key()

    assert plaintext.startswith(f"{svc.KEY_NAMESPACE}_{prefix}_")
    assert svc.verify_api_key(plaintext, hashed) is True


def test_plaintext_is_not_recoverable_from_the_stored_hash():
    plaintext, _prefix, hashed = svc.generate_api_key()

    assert plaintext not in hashed
    assert len(hashed) == 64  # sha256 hex


def test_each_key_is_unique():
    keys = {svc.generate_api_key()[0] for _ in range(50)}
    assert len(keys) == 50


def test_wrong_key_does_not_verify():
    _plaintext, _prefix, hashed = svc.generate_api_key()
    other_plaintext, _, _ = svc.generate_api_key()

    assert svc.verify_api_key(other_plaintext, hashed) is False
    assert svc.verify_api_key("", hashed) is False
    assert svc.verify_api_key("dcr_deadbeef_nonsense", hashed) is False


# ---------------------------------------------------------------------------
# Prefix parsing, which drives the lookup
# ---------------------------------------------------------------------------

def test_prefix_round_trips():
    plaintext, prefix, _hashed = svc.generate_api_key()
    assert svc.parse_prefix(plaintext) == prefix


@pytest.mark.parametrize("bad", [
    "",
    None,
    "not-a-key",
    "dcr_tooshort_secret",
    "wrong_deadbeef_secret",      # wrong namespace
    "dcr_deadbeef",               # missing secret
    "dcr_zzzzzzzz_secret",        # non-hex prefix
    "dcr_deadbeef_",              # empty secret
])
def test_malformed_keys_have_no_prefix(bad):
    assert svc.parse_prefix(bad) is None


def test_secret_may_contain_underscores():
    """token_urlsafe emits "_", so only the first two separators are structural."""
    assert svc.parse_prefix("dcr_deadbeef_se_cr_et") == "deadbeef"


# ---------------------------------------------------------------------------
# Usability rules
# ---------------------------------------------------------------------------

def test_active_key_without_expiry_is_usable():
    assert svc.is_usable(True, None, None) is True


def test_revoked_key_is_not_usable():
    assert svc.is_usable(True, datetime.now(timezone.utc), None) is False


def test_inactive_key_is_not_usable():
    assert svc.is_usable(False, None, None) is False


def test_expired_key_is_not_usable():
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert svc.is_usable(True, None, past) is False


def test_unexpired_key_is_usable():
    future = datetime.now(timezone.utc) + timedelta(days=1)
    assert svc.is_usable(True, None, future) is True


def test_naive_expiry_is_treated_as_utc():
    naive_past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None)
    assert svc.is_usable(True, None, naive_past) is False


# ---------------------------------------------------------------------------
# Scopes and expiry translation
# ---------------------------------------------------------------------------

def test_scopes_default_to_read_only():
    assert svc.normalise_scopes(None) == ["read"]
    assert svc.normalise_scopes([]) == ["read"]


def test_unknown_scopes_are_dropped():
    assert svc.normalise_scopes(["read", "admin", "delete-everything"]) == ["read"]


def test_scopes_are_deduplicated_and_normalised():
    assert svc.normalise_scopes(["READ", "read", "Write"]) == ["read", "write"]


def test_all_unknown_scopes_fall_back_to_default():
    assert svc.normalise_scopes(["root", "superuser"]) == ["read"]


def test_expiry_translation():
    assert svc.expiry_from_days(None) is None
    assert svc.expiry_from_days(0) is None
    assert svc.expiry_from_days(-5) is None

    expires = svc.expiry_from_days(30)
    assert expires is not None
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(days=29) < delta <= timedelta(days=30)


# ---------------------------------------------------------------------------
# Settings sections
# ---------------------------------------------------------------------------

def test_every_valid_section_has_documented_defaults():
    """A section with no defaults would render an empty screen on first load."""
    for section in VALID_SECTIONS:
        assert section in DEFAULT_SECTION_DATA


def test_notification_defaults_are_conservative():
    defaults = DEFAULT_SECTION_DATA["notifications"]
    # Opt-in features stay off until the account turns them on.
    assert defaults["daily_digest"] is False
    assert defaults["notify_on_viewed"] is False


def test_sms_and_mcp_default_to_disabled():
    assert DEFAULT_SECTION_DATA["sms"]["enabled"] is False
    assert DEFAULT_SECTION_DATA["mcp"]["enabled"] is False


def test_setting_update_accepts_partial_payloads():
    """A partial update must be mergeable onto the defaults, not replace them."""
    payload = AccountSettingUpdate(data={"daily_digest": True})
    merged = merge_section("notifications", {}, payload.data)

    assert merged["daily_digest"] is True
    # Untouched keys survive the merge.
    assert merged["notify_on_completed"] is True


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

def test_api_key_create_defaults():
    payload = ApiKeyCreate()
    assert payload.name == "API Key"
    assert payload.scopes is None
    assert payload.expires_in_days is None


def test_created_key_response_carries_plaintext_once():
    out = ApiKeyCreatedOut(
        id="k1",
        name="CI pipeline",
        key_prefix="deadbeef",
        scopes=["read"],
        is_active=True,
        plaintext_key="dcr_deadbeef_secret",
    )
    assert out.plaintext_key == "dcr_deadbeef_secret"
    # The listing schema has no such field, so a key cannot be re-read later.
    assert "plaintext_key" not in ApiKeyCreate.model_fields


def test_signing_certificate_create_requires_a_label():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SigningCertificateCreate()

    cert = SigningCertificateCreate(label="Production Signer")
    assert cert.label == "Production Signer"
    assert cert.is_default is False


def test_created_key_response_builds_from_a_listing_row():
    """
    ApiKeyCreatedOut cannot be validated straight from the ORM row: plaintext_key is
    required and exists only in the creation response. The endpoint composes it from
    an ApiKeyOut projection plus the plaintext.
    """
    from app.schemas import ApiKeyOut

    listing = ApiKeyOut(
        id="k1",
        name="CI pipeline",
        key_prefix="deadbeef",
        scopes=["read", "write"],
        is_active=True,
    )
    created = ApiKeyCreatedOut(**listing.model_dump(), plaintext_key="dcr_deadbeef_secret")

    assert created.id == "k1"
    assert created.scopes == ["read", "write"]
    assert created.plaintext_key == "dcr_deadbeef_secret"


def test_created_key_response_requires_the_plaintext():
    """Omitting it must fail loudly rather than returning a key nobody can use."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ApiKeyCreatedOut(id="k1", name="n", key_prefix="deadbeef", scopes=[], is_active=True)


# ---------------------------------------------------------------------------
# Saved stamps
#
# The Profile screen reported "Signature stamp saved" and stored nothing. These
# cover the rules that keep a user-supplied image, which ends up composited onto a
# legal document, from being trusted.
# ---------------------------------------------------------------------------

def test_only_known_stamp_kinds_are_accepted():
    from app.services import stamp_store

    assert stamp_store.is_valid_kind("signature") is True
    assert stamp_store.is_valid_kind("initials") is True
    for bad in ["", "avatar", "logo", "../../etc/passwd"]:
        assert stamp_store.is_valid_kind(bad) is False


def test_stamp_content_type_comes_from_the_bytes():
    """A declared mime type is a client assertion; the magic bytes are evidence."""
    from app.services import stamp_store

    assert stamp_store.detect_content_type(b"\x89PNG\r\n\x1a\n rest") == "image/png"
    assert stamp_store.detect_content_type(b"\xff\xd8\xff\xe0 rest") == "image/jpeg"
    # A renamed executable or a script must not pass.
    assert stamp_store.detect_content_type(b"MZ\x90\x00") is None
    assert stamp_store.detect_content_type(b"<svg onload=alert(1)>") is None
    assert stamp_store.detect_content_type(b"") is None


def test_oversized_stamp_is_refused():
    from app.services import stamp_store

    too_big = b"\x89PNG\r\n\x1a\n" + (b"x" * stamp_store.MAX_STAMP_BYTES)
    content_type, error = stamp_store.validate_image(too_big)
    assert content_type is None
    assert "exceeds" in error


def test_stamp_path_refuses_ids_it_did_not_mint():
    from app.services import stamp_store

    for bad in ["../../etc/passwd", "stamp_short", "", "stamp_" + "g" * 32]:
        with pytest.raises(ValueError):
            stamp_store.stamp_path("/storage", bad, "image/png")

    ok = stamp_store.stamp_path("/storage", stamp_store.new_stamp_id(), "image/png")
    assert ok.endswith(".png")


def test_data_url_must_be_a_real_image():
    from app.services import stamp_store

    data, error = stamp_store.decode_data_url("data:text/html;base64,PGh0bWw+")
    assert data is None and "PNG or JPEG" in error

    data, error = stamp_store.decode_data_url("not-a-data-url")
    assert data is None and error

    data, error = stamp_store.decode_data_url("")
    assert data is None and error
