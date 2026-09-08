"""
Account settings policy.

Which setting sections exist and what each defaults to is domain knowledge rather
than routing detail, so it lives here and the API layer consumes it. Keeping it out
of the API module also lets the rules be exercised without the web framework.
"""
from typing import Any, Dict

# Sections the settings screen persists. Restricted so a caller cannot use the
# settings store as arbitrary key-value storage.
VALID_SECTIONS = ["notifications", "sms", "mcp", "branding", "compliance"]

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
