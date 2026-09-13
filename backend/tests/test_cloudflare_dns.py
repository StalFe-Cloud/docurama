"""
Cloudflare one-click: a DNS-scoped API token the customer pastes is used once to
create the challenge TXT record, then discarded. The token is never stored.
"""
import pytest

from app.services import cloudflare_dns


class _Resp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(
                "error", request=httpx.Request("GET", "https://x"), response=self)


async def test_creates_txt_record(monkeypatch):
    calls = []

    async def fake_get(self, url, **kw):
        calls.append(("GET", url, kw))
        return _Resp(200, {"success": True, "result": [{"id": "zone123"}]})

    async def fake_post(self, url, **kw):
        calls.append(("POST", url, kw.get("json")))
        return _Resp(200, {"success": True, "result": {"id": "rec456"}})

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "post", fake_post)

    result = await cloudflare_dns.create_challenge_record(
        "tok", "acme.example", "_docurama-challenge.acme.example",
        "docurama-verification=abc")
    assert result["ok"] is True
    assert result["record_id"] == "rec456"
    get_call = next(c for c in calls if c[0] == "GET")
    assert "zones" in get_call[1]
    assert get_call[2].get("params", {}).get("name") == "acme.example"
    post_call = next(c for c in calls if c[0] == "POST")
    assert post_call[2]["type"] == "TXT"
    assert post_call[2]["name"] == "_docurama-challenge.acme.example"


async def test_unknown_zone_fails_cleanly(monkeypatch):
    async def fake_get(self, url, **kw):
        return _Resp(200, {"success": True, "result": []})

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get", fake_get)

    result = await cloudflare_dns.create_challenge_record(
        "tok", "not-there.example", "x", "y")
    assert result["ok"] is False
    assert result["record_id"] is None
    assert "not found" in (result["error"] or "").lower()


async def test_bad_token_fails_without_echoing_it(monkeypatch):
    async def fake_get(self, url, **kw):
        resp = _Resp(403, {"success": False, "errors": [{"message": "Authentication error"}]})
        return resp

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get", fake_get)

    result = await cloudflare_dns.create_challenge_record(
        "sekrit-token", "acme.example", "x", "y")
    assert result["ok"] is False
    assert "sekrit-token" not in str(result)
