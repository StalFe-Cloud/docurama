"""
Sprint 1 regression tests: domain verification hardening (P1-2).

- web_confirmation requires THIS domain's exact token (a page merely containing
  the "docurama-verification" marker no longer passes).
- Verification fetches never follow redirects and refuse private addresses.
"""
import httpx
import pytest

import app.services.domain_verifier as dv


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=False, timeout=5.0
    )


@pytest.mark.asyncio
async def test_web_confirmation_rejects_marker_only_page(monkeypatch):
    """Any 200 page containing just the marker must NOT verify the domain."""
    async def fake_doh(name, rtype):
        return []  # no DNS answers; fetch still happens and returns the page

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    monkeypatch.setattr(
        dv, "_verification_http_client",
        lambda: _mock_client(lambda req: httpx.Response(200, text="See docurama-verification docs")),
    )

    verified, method, _details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is False and method == "none"


@pytest.mark.asyncio
async def test_web_confirmation_accepts_exact_token(monkeypatch):
    async def fake_doh(name, rtype):
        return []

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    monkeypatch.setattr(
        dv, "_verification_http_client",
        lambda: _mock_client(lambda req: httpx.Response(200, text="tok-123")),
    )

    verified, method, _details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is True and method == "web_confirmation"


@pytest.mark.asyncio
async def test_private_address_is_not_fetched(monkeypatch):
    """A domain resolving to a private address must be refused before any fetch."""
    fetches = []

    async def fake_doh(name, rtype):
        if rtype == "A":
            return [{"data": "192.168.1.10"}]
        return []

    def handler(request):
        fetches.append(str(request.url))
        return httpx.Response(200, text="tok-123")

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    monkeypatch.setattr(dv, "_verification_http_client", lambda: _mock_client(handler))

    verified, method, details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is False and method == "none"
    assert fetches == [], "no HTTP fetch may be made against a private address"


@pytest.mark.asyncio
async def test_redirect_is_not_followed(monkeypatch):
    """A 302 pointing at the token must not be chased to a second origin."""
    async def fake_doh(name, rtype):
        return []

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    monkeypatch.setattr(
        dv, "_verification_http_client",
        lambda: _mock_client(
            lambda req: httpx.Response(302, headers={"Location": "https://evil.test/tok-123"})
        ),
    )

    verified, method, _details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is False and method == "none"


@pytest.mark.asyncio
async def test_txt_requires_full_marker_with_token(monkeypatch):
    """A TXT record carrying the bare marker without the token proves nothing."""
    async def fake_doh(name, rtype):
        if rtype == "TXT":
            return [{"name": name, "data": '"docurama-verification"'}]
        return []

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    verified, method, _details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is False and method == "none"


@pytest.mark.asyncio
async def test_txt_with_full_marker_verifies(monkeypatch):
    async def fake_doh(name, rtype):
        if rtype == "TXT":
            return [{"name": name, "data": '"docurama-verification=tok-123"'}]
        return []

    monkeypatch.setattr(dv, "doh_query", fake_doh)
    verified, method, _details, _msg = await dv.verify_client_domain("acme.test", "tok-123")
    assert verified is True and method == "dns_txt"
