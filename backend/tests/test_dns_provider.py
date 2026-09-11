"""
DNS provider detection: NS records tell us where the customer manages DNS, so
the instructions can name the exact screens instead of generic DNS advice.
"""
import pytest

from app.services import dns_provider


def _ns_answers(hosts):
    return [{"data": h} for h in hosts]


async def test_cloudflare_detected_by_nameservers(monkeypatch):
    async def fake_doh(name, rtype):
        return _ns_answers(["ns1.cloudflare.com", "ns2.cloudflare.com"])

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] == "cloudflare"
    assert result["steps"] and "Cloudflare" in result["steps"][0]
    assert any("_docurama-challenge" in s for s in result["steps"])


async def test_unknown_provider_gets_generic_steps(monkeypatch):
    async def fake_doh(name, rtype):
        return _ns_answers(["ns1.some-obscure-dns.example"])

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] is None
    assert result["steps"] == dns_provider.GENERIC_STEPS


async def test_failed_lookup_is_reported_not_guessed(monkeypatch):
    async def fake_doh(name, rtype):
        return []

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] is None
    assert result["nameservers"] == []
    assert result["steps"] == dns_provider.GENERIC_STEPS


def test_tutorials_reference_the_challenge_host_pattern():
    for key, steps in dns_provider.PROVIDER_TUTORIALS.items():
        assert steps, key
        assert any("TXT" in s for s in steps), key
        assert any("_docurama-challenge" in s or "challenge host" in s for s in steps), key
