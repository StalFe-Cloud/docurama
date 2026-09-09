"""
The settings screen must not report work it did not do.

`SettingsPage.tsx` had 46 success toasts and 18 real save calls. The other 28 controls
showed a green confirmation and persisted nothing, so a preference appeared to save and
was gone on reload. The worst was a complete password-change form whose button showed
"Password changed successfully" while no password-change endpoint existed at all: someone
rotating a credential they believed was exposed was told it had worked.

This is the same unchecked-claim defect as reporting a document sealed when it was not,
in the UI layer. These tests are a static guard over the component, in the spirit of the
event-loop guard in test_trust_integrity.py: they read the source rather than run a
browser, because the property being protected is "no success message without a save",
which is visible in the text.
"""
import pathlib
import re

import pytest

SETTINGS_PAGE = (
    pathlib.Path(__file__).resolve().parent.parent.parent
    / "frontend" / "src" / "pages" / "SettingsPage.tsx"
)

# The runtime image ships only the backend, so the component is absent there.
pytestmark = pytest.mark.skipif(
    not SETTINGS_PAGE.exists(),
    reason="frontend sources are not part of the runtime image; run this suite on the host",
)


@pytest.fixture(scope="module")
def source() -> str:
    return SETTINGS_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def lines(source) -> list:
    return source.split("\n")


# Helpers that do persist. A triggerSave sitting near one of these is honest.
PERSISTING_CALLS = (
    "await api.",
    "saveSection(",
    "saveSigningSetting(",
    "saveComplianceSetting(",
    "saveProfileSetting(",
    "saveNotificationSettings(",
    "saveSmsSettings(",
    "handleSaveOrganisation",
)

# How far back to look for the persisting call that a toast belongs to.
LOOKBACK = 18


def _unbacked_toasts(lines) -> list:
    """Every triggerSave with no persisting call in the enclosing handler."""
    offenders = []
    for i, line in enumerate(lines):
        if "triggerSave(" not in line:
            continue
        # The definition itself, and the notAvailable helper, are not controls.
        if "const triggerSave" in line:
            continue
        window = "\n".join(lines[max(0, i - LOOKBACK):i + 1])
        if not any(call in window for call in PERSISTING_CALLS):
            message = re.search(r"triggerSave\('([^']*)'", line)
            offenders.append((i + 1, message.group(1) if message else line.strip()[:60]))
    return offenders


def test_no_control_claims_success_without_saving(lines):
    """
    A green confirmation must correspond to a request that actually happened.

    If this fails, a control was added that reports success without persisting. Either
    wire it to a save, or call notAvailable() so the screen says the feature is not
    built rather than pretending it worked.
    """
    offenders = _unbacked_toasts(lines)
    assert offenders == [], (
        "These controls report success without persisting anything:\n"
        + "\n".join(f"  line {n}: {msg}" for n, msg in offenders)
    )


def test_unbuilt_features_say_so_rather_than_confirming(source):
    """
    Features with no backend use the not-available notice, and it must be visually
    distinct from a save. Reusing the success styling is how the original defect read
    as working software.
    """
    assert "const notAvailable = (" in source, "the not-available helper is missing"
    assert "is not available yet" in source

    # Rendered separately from saveNotice, not through it.
    assert "unavailableNotice" in source
    assert "setUnavailableNotice" in source


def test_the_password_form_is_bound_and_submits(source):
    """
    The inputs were not connected to any state, so even typed values went nowhere, and
    the button only showed a toast. This is the most consequential instance: a user is
    entitled to believe a password change either happened or visibly failed.
    """
    assert "api.changePassword(" in source, "the password form must call the endpoint"
    assert "onClick={handleChangePassword}" in source

    for binding in ("value={currentPassword}", "value={newPassword}", "value={confirmPassword}"):
        assert binding in source, f"password input not bound: {binding}"

    # A failure has to reach the user rather than being swallowed.
    assert "passwordError" in source


def test_failures_are_surfaced_not_swallowed(source):
    """A save that fails must show why, otherwise it is indistinguishable from success."""
    assert "setSectionError(" in source
    assert "sectionError &&" in source, "the section error is never rendered"


def test_guard_detects_a_reintroduced_fake_save(lines):
    """
    The guard has to actually catch the thing it exists for, otherwise it is decoration.
    Feed it a control of the shape that caused this and confirm it is reported.
    """
    injected = list(lines) + [
        "                <button onClick={() => {",
        "                  setSomething(true);",
        "                  triggerSave('Definitely saved.');",
        "                }}>Save</button>",
    ]
    offenders = _unbacked_toasts(injected)

    assert any(msg == "Definitely saved." for _n, msg in offenders), (
        "the guard failed to flag a control that reports success without saving"
    )
