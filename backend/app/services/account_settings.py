"""
Account settings policy.

Which setting sections exist and what each defaults to is domain knowledge rather
than routing detail, so it lives here and the API layer consumes it. Keeping it out
of the API module also lets the rules be exercised without the web framework.
"""
from typing import Any, Dict

# Sections the settings screen persists. Restricted so a caller cannot use the
# settings store as arbitrary key-value storage.
#
# "smtp" is deliberately not here. This module's read path returns stored data
# verbatim, and the mail profile holds an encrypted credential that must never reach
# a browser. It has dedicated endpoints that redact on read and encrypt on write.
VALID_SECTIONS = ["notifications", "sms", "mcp", "branding", "compliance", "signing", "profile"]

# First-load state. Reported when no row exists yet, so the UI shows the same
# thing before and after the first save.
DEFAULT_SECTION_DATA: Dict[str, Dict[str, Any]] = {
    "notifications": {
        "notify_on_signed": True,
        "notify_on_completed": True,
        "notify_on_declined": True,
        "notify_on_viewed": False,
        "daily_digest": False,
    },
    "sms": {"enabled": False, "provider": None, "sender_id": None},
    "mcp": {"enabled": False, "allowed_tools": []},
    "branding": {"accent_color": "#1D72FE", "logo_url": None},
    "compliance": {"part_11_enabled": False, "require_reason_for_signing": False},
    # Signing behaviour and document delivery. These were rendered as live controls that
    # reported success and stored nothing, so the defaults below are what every account
    # has effectively been running with.
    "signing": {
        "enforce_signing_order": True,
        "allow_decline": True,
        "allow_delegation": True,
        "allow_resubmission": False,
        "show_signature_id": True,
        "flatten_pdf_fields": True,
        "combine_audit_log": True,
        "allow_multiple_signatures": True,
        "prefill_signature": False,
        "download_filename_format": "{document.name} - {submission.status}.pdf",
        "download_link_expiry_hours": 168,
        "tsa_url": None,
    },
    # Organisation-facing profile fields shown on the Account tab.
    "profile": {
        "organisation_name": None,
        "contact_email": None,
        "support_url": None,
    },
}


def is_valid_section(section: str) -> bool:
    return section in VALID_SECTIONS


def defaults_for(section: str) -> Dict[str, Any]:
    return dict(DEFAULT_SECTION_DATA.get(section, {}))


def merge_section(section: str, stored: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """
    Layer an update onto stored values on top of the defaults, so a partial payload
    updates only the keys it names instead of replacing the whole section.
    """
    merged = defaults_for(section)
    if stored:
        merged.update(stored)
    if incoming:
        merged.update(incoming)
    return merged
