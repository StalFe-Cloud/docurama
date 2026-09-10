import pytest

from app.services import mail_deliverability


async def test_full_pass(client, monkeypatch):
    async def fake_txt(name):
        return {
            "example.com": ["v=spf1 include:_spf.example.com ~all"],
            "_dmarc.example.com": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"],
        }.get(name, [])

    async def fake_mx(domain):
        return True

    monkeypatch.setattr(mail_deliverability, "_txt_records", fake_txt)
    monkeypatch.setattr(mail_deliverability, "_has_mx", fake_mx)

    result = await mail_deliverability.check_domain("example.com")
    assert result["ok"] is True
    assert result["spf"]["present"] is True
    assert result["dmarc"]["policy"] == "quarantine"
    assert result["mx_present"] is True


async def test_missing_dmarc_is_reported(client, monkeypatch):
    async def fake_txt(name):
        return {"example.com": ["v=spf1 ~all"]}.get(name, [])

    async def fake_mx(domain):
        return True

    monkeypatch.setattr(mail_deliverability, "_txt_records", fake_txt)
    monkeypatch.setattr(mail_deliverability, "_has_mx", fake_mx)

    result = await mail_deliverability.check_domain("example.com")
    assert result["ok"] is False
    assert any("DMARC" in f for f in result["findings"])


async def test_endpoint_requires_session(client):
    resp = await client.post("/api/settings/deliverability", json={"domain": "example.com"})
    assert resp.status_code == 401
