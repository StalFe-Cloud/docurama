"""
Trust integrity tests.

The defect these cover: the platform used to report every document as
cryptographically verified regardless of what it actually contained. An unsigned
PDF returned is_valid=True with "RFC 3161 Timestamped" and pades_ltv_verified=True.
These tests pin the rule that no failure path may produce a positive assertion.
"""
import os
import tempfile

import pytest

from app.services.crypto_engine import (
    PADES_B_B,
    PADES_B_LT,
    PADES_B_LTA,
    PADES_B_T,
    calculate_bytes_sha256,
    calculate_file_sha256,
    sign_pdf_with_pades,
    verify_document_integrity,
)

# Smallest structurally valid PDF, carrying no signature of any kind.
UNSIGNED_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)


@pytest.fixture
def unsigned_pdf_path():
    fd, path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(UNSIGNED_PDF)
    yield path
    if os.path.exists(path):
        os.remove(path)


def test_unsigned_pdf_is_not_reported_as_verified(unsigned_pdf_path):
    """An unsigned document must never come back as valid or LTV verified."""
    result = verify_document_integrity(unsigned_pdf_path)

    assert result["is_valid"] is False
    assert result["has_digital_signature"] is False
    assert result["pades_ltv_verified"] is False
    assert result["signature_intact"] is False
    assert result["has_timestamp"] is False
    assert result["pades_level"] is None


def test_unsigned_pdf_makes_no_certificate_claims(unsigned_pdf_path):
    """No signer identity may be invented for a document that carries no signature."""
    result = verify_document_integrity(unsigned_pdf_path)

    assert result["signer_subject"] is None
    assert result["signer_issuer"] is None
    assert result["timestamp_utc"] is None
    # The message must not assert authenticity.
    assert "authentic" not in result["message"].lower()
    assert "verified" not in result["message"].lower()


def test_missing_file_is_not_valid():
    result = verify_document_integrity("/nonexistent/path/to/document.pdf")

    assert result["is_valid"] is False
    assert result["has_digital_signature"] is False
    assert result["pades_ltv_verified"] is False


def test_empty_path_is_not_valid():
    result = verify_document_integrity("")

    assert result["is_valid"] is False
    assert result["pades_ltv_verified"] is False


def test_verify_still_reports_the_real_digest(unsigned_pdf_path):
    """Verification fails, but the digest it reports must still be the true one."""
    result = verify_document_integrity(unsigned_pdf_path)

    assert result["sha256"] == calculate_bytes_sha256(UNSIGNED_PDF)
    assert result["sha256"] == calculate_file_sha256(unsigned_pdf_path)


def test_sealing_without_a_certificate_reports_failure(unsigned_pdf_path, monkeypatch):
    """
    When the signing certificate is absent, sealing must report sealed=False.
    The old implementation copied the file and still returned success=True with a
    'PAdES-LTV (Docurama Sealed)' label.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "P12_PATH", "/nonexistent/missing.p12")

    out_fd, out_path = tempfile.mkstemp(suffix=".pdf")
    os.close(out_fd)
    try:
        result = sign_pdf_with_pades(unsigned_pdf_path, out_path)

        assert result["success"] is False
        assert result["sealed"] is False
        assert result["pades_level"] is None
        assert result["error"]
        # The document is still produced so the completed envelope stays downloadable.
        assert os.path.exists(out_path)
        assert result["sha256"] == calculate_file_sha256(out_path)
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)


def test_unsealed_output_does_not_verify(unsigned_pdf_path, monkeypatch):
    """The copy produced by a failed seal must not verify as sealed either."""
    from app.core import config

    monkeypatch.setattr(config.settings, "P12_PATH", "/nonexistent/missing.p12")

    out_fd, out_path = tempfile.mkstemp(suffix=".pdf")
    os.close(out_fd)
    try:
        sign_pdf_with_pades(unsigned_pdf_path, out_path)
        verified = verify_document_integrity(out_path)

        assert verified["is_valid"] is False
        assert verified["has_digital_signature"] is False
        assert verified["pades_ltv_verified"] is False
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)


def test_pades_levels_are_ordered_and_distinct():
    """The four conformance levels must stay distinct so a lower one cannot pass as LTV."""
    levels = [PADES_B_B, PADES_B_T, PADES_B_LT, PADES_B_LTA]
    assert len(set(levels)) == 4
    # Only LT and LTA carry embedded revocation information.
    assert PADES_B_B != PADES_B_LT
    assert PADES_B_T != PADES_B_LTA


def test_routing_order_blocking_rule():
    """
    Sequential routing: a signer is blocked while any earlier-ordered signer is
    still outstanding. Mirrors the guard in the submit endpoint.
    """
    class R:
        def __init__(self, name, order, status, role="signer"):
            self.name = name
            self.routing_order = order
            self.status = status
            self.role = role

    recipients = [
        R("First", 1, "sent"),
        R("Second", 2, "sent"),
    ]
    signer = recipients[1]

    blocking = [
        r for r in recipients
        if r.role == "signer"
        and r.status not in ["signed", "declined", "delegated"]
        and (r.routing_order or 1) < (signer.routing_order or 1)
    ]
    assert len(blocking) == 1
    assert blocking[0].name == "First"

    # Once the first signer completes, the second is free to sign.
    recipients[0].status = "signed"
    blocking = [
        r for r in recipients
        if r.role == "signer"
        and r.status not in ["signed", "declined", "delegated"]
        and (r.routing_order or 1) < (signer.routing_order or 1)
    ]
    assert blocking == []


def test_declined_and_delegated_recipients_do_not_block():
    """A declined or delegated recipient must not deadlock the routing chain."""
    class R:
        def __init__(self, order, status, role="signer"):
            self.routing_order = order
            self.status = status
            self.role = role

    recipients = [R(1, "declined"), R(2, "delegated"), R(3, "sent")]
    signer = recipients[2]

    blocking = [
        r for r in recipients
        if r.role == "signer"
        and r.status not in ["signed", "declined", "delegated"]
        and (r.routing_order or 1) < (signer.routing_order or 1)
    ]
    assert blocking == []


# ---------------------------------------------------------------------------
# Branch coverage with pyHanko stubbed in.
#
# pyHanko is a container-only dependency, so without these stubs the tests above
# exercise the "validation unavailable" path rather than the real inspection path.
# Both must yield negative results; these pin the inspection path specifically.
# ---------------------------------------------------------------------------
import sys
import types


def _install_pyhanko_stub(monkeypatch, embedded_signatures, status=None):
    """Install a minimal fake pyHanko exposing the two symbols the engine imports."""
    class FakeReader:
        def __init__(self, stream):
            self.embedded_signatures = embedded_signatures

    reader_mod = types.ModuleType("pyhanko.pdf_utils.reader")
    reader_mod.PdfFileReader = FakeReader

    validation_mod = types.ModuleType("pyhanko.sign.validation")
    validation_mod.validate_pdf_signature = lambda sig, signer_validation_context=None: status

    pdf_utils_mod = types.ModuleType("pyhanko.pdf_utils")
    sign_mod = types.ModuleType("pyhanko.sign")
    root_mod = types.ModuleType("pyhanko")

    for name, mod in [
        ("pyhanko", root_mod),
        ("pyhanko.pdf_utils", pdf_utils_mod),
        ("pyhanko.pdf_utils.reader", reader_mod),
        ("pyhanko.sign", sign_mod),
        ("pyhanko.sign.validation", validation_mod),
    ]:
        monkeypatch.setitem(sys.modules, name, mod)


def test_document_without_embedded_signature_reports_none(unsigned_pdf_path, monkeypatch):
    """The real inspection path: a readable PDF with zero signatures is not verified."""
    _install_pyhanko_stub(monkeypatch, embedded_signatures=[])

    result = verify_document_integrity(unsigned_pdf_path)

    assert result["is_valid"] is False
    assert result["has_digital_signature"] is False
    assert result["pades_ltv_verified"] is False
    assert "no embedded digital signature" in result["message"]


def test_tampered_document_is_reported_as_altered(unsigned_pdf_path, monkeypatch):
    """A signature present but not intact must report alteration, not validity."""
    class FakeStatus:
        intact = False
        valid = False
        trusted = False
        signing_cert = None
        timestamp_validity = None

    _install_pyhanko_stub(monkeypatch, embedded_signatures=[object()], status=FakeStatus())

    result = verify_document_integrity(unsigned_pdf_path)

    assert result["is_valid"] is False
    assert result["signature_intact"] is False
    assert result["pades_ltv_verified"] is False
    assert "altered" in result["message"]


def test_untrusted_signature_is_not_claimed_as_trusted(unsigned_pdf_path, monkeypatch):
    """
    Intact and valid but not chaining to a trusted root is a real state, and the
    message must say so rather than presenting the document as fully certified.
    """
    class FakeStatus:
        intact = True
        valid = True
        trusted = False
        signing_cert = None
        timestamp_validity = None

    _install_pyhanko_stub(monkeypatch, embedded_signatures=[object()], status=FakeStatus())

    result = verify_document_integrity(unsigned_pdf_path)

    assert result["is_valid"] is True
    assert result["signature_trusted"] is False
    # No timestamp was validated, so no timestamp claim and no LTV claim.
    assert result["has_timestamp"] is False
    assert result["pades_ltv_verified"] is False
    assert result["pades_level"] == PADES_B_B
    assert "trusted root" in result["message"]


def test_signature_without_timestamp_cannot_reach_b_t(unsigned_pdf_path, monkeypatch):
    """Level B-T requires a validated timestamp; absent one the level stays B-B."""
    class FakeTimestamp:
        intact = False

    class FakeStatus:
        intact = True
        valid = True
        trusted = True
        signing_cert = None
        timestamp_validity = FakeTimestamp()

    _install_pyhanko_stub(monkeypatch, embedded_signatures=[object()], status=FakeStatus())

    result = verify_document_integrity(unsigned_pdf_path)

    assert result["has_timestamp"] is False
    assert result["pades_level"] == PADES_B_B
    assert result["pades_ltv_verified"] is False


# ---------------------------------------------------------------------------
# PAdES level ladder and the LTV claim gate.
#
# Verified against real pyhanko 0.37 with a self-signed CA: a genuine seal reaches
# B-LTA, and flipping a byte in the signed stream drops is_valid and the LTV claim
# while the DSS and document timestamp structurally survive.
# ---------------------------------------------------------------------------

from app.services.crypto_engine import _assess_ltv


class FakeReader:
    """Stands in for a PdfFileReader, exposing only what the assessment reads."""

    def __init__(self, dss_certs=(), doc_timestamps=()):
        self._dss_certs = list(dss_certs)
        self.embedded_timestamp_signatures = list(doc_timestamps)

    # DocumentSecurityStore.read_dss is patched per-test to consult this.
    @property
    def dss_certs(self):
        return self._dss_certs


def _patch_dss(monkeypatch, present: bool):
    from app.services import crypto_engine

    monkeypatch.setattr(
        crypto_engine, "_dss_carries_revocation_info", lambda reader: present
    )


def test_no_timestamp_means_basic_level(monkeypatch):
    _patch_dss(monkeypatch, True)
    ltv, level = _assess_ltv(FakeReader(), has_timestamp=False, signature_ok=True)

    assert ltv is False
    assert level == PADES_B_B


def test_timestamp_without_revocation_info_stops_at_b_t(monkeypatch):
    _patch_dss(monkeypatch, False)
    ltv, level = _assess_ltv(FakeReader(), has_timestamp=True, signature_ok=True)

    assert ltv is False
    assert level == PADES_B_T


def test_revocation_info_without_document_timestamp_is_lt(monkeypatch):
    _patch_dss(monkeypatch, True)
    ltv, level = _assess_ltv(FakeReader(), has_timestamp=True, signature_ok=True)

    assert ltv is True
    assert level == PADES_B_LT


def test_revocation_info_with_document_timestamp_is_lta(monkeypatch):
    _patch_dss(monkeypatch, True)
    reader = FakeReader(doc_timestamps=[object()])
    ltv, level = _assess_ltv(reader, has_timestamp=True, signature_ok=True)

    assert ltv is True
    assert level == PADES_B_LTA


def test_ltv_is_not_claimed_for_an_altered_document(monkeypatch):
    """
    The DSS and document timestamp survive in a tampered file, so the structural
    level still reads LTA. The LTV claim must not, or a document that failed its
    integrity check would still advertise long-term validation.
    """
    _patch_dss(monkeypatch, True)
    reader = FakeReader(doc_timestamps=[object()])
    ltv, level = _assess_ltv(reader, has_timestamp=True, signature_ok=False)

    assert ltv is False
    # The observation itself is still reported; it is true and aids diagnosis.
    assert level == PADES_B_LTA


def test_regular_signatures_exclude_document_timestamps():
    """
    embedded_signatures mixes signatures and /DocTimeStamp entries, so indexing it
    can hand back a timestamp instead of the signature on an LTA-sealed file.
    """
    from app.services.crypto_engine import _regular_signatures

    sig, doc_ts = object(), object()

    class Reader:
        embedded_regular_signatures = [sig]
        embedded_signatures = [doc_ts, sig]

    assert _regular_signatures(Reader()) == [sig]

    # Older readers without the split property fall back to the combined list.
    class LegacyReader:
        embedded_signatures = [sig]

    assert _regular_signatures(LegacyReader()) == [sig]


# ---------------------------------------------------------------------------
# Event-loop safety.
#
# pyHanko's sign_pdf() and validate_pdf_signature() call asyncio.run() internally.
# Calling them directly from an async endpoint raises "asyncio.run() cannot be called
# from a running event loop", which the old code swallowed and reported as a successful
# seal. Sealing therefore never worked in the request path even with a certificate
# installed. Both call sites must hand the work to a worker thread.
# ---------------------------------------------------------------------------

def test_sealing_and_verification_run_off_the_event_loop():
    """The endpoints must not call the blocking pyHanko helpers inline."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parent.parent / "app" / "api"

    signing = (root / "signing.py").read_text(encoding="utf-8")
    assert "asyncio.to_thread(\n            sign_pdf_with_pades" in signing.replace("\r\n", "\n"), \
        "sign_pdf_with_pades must be dispatched to a thread, not awaited inline"
    assert not re.search(r"^\s*crypto_res = sign_pdf_with_pades\(", signing, re.M), \
        "sign_pdf_with_pades is being called directly inside an async endpoint"

    verify = (root / "verify.py").read_text(encoding="utf-8")
    assert "asyncio.to_thread(verify_document_integrity" in verify, \
        "verify_document_integrity must be dispatched to a thread"
    assert not re.search(r"^\s*crypto_check = verify_document_integrity\(", verify, re.M), \
        "verify_document_integrity is being called directly inside an async endpoint"


@pytest.mark.asyncio
async def test_blocking_helper_survives_a_running_event_loop():
    """
    Reproduces the failure mode directly: a helper that calls asyncio.run() blows up
    inside a running loop, and works when handed to a thread. This is what pyHanko
    does internally.
    """
    import asyncio

    def blocking_helper_like_pyhanko():
        async def _inner():
            return "sealed"
        return asyncio.run(_inner())

    with pytest.raises(RuntimeError, match="cannot be called from a running event loop"):
        blocking_helper_like_pyhanko()

    assert await asyncio.to_thread(blocking_helper_like_pyhanko) == "sealed"
