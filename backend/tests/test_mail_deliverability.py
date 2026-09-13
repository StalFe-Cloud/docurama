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


async def test_dns_failure_is_reported_not_guessed(client, monkeypatch):
    """
    When every DoH endpoint is unreachable, the check must say it could not
    look anything up rather than reporting each record as missing.
    """
    async def failing_txt(name):
        return None

    async def failing_mx(domain):
        return None

    monkeypatch.setattr(mail_deliverability, "_txt_records", failing_txt)
    monkeypatch.setattr(mail_deliverability, "_has_mx", failing_mx)

    result = await mail_deliverability.check_domain("example.com")
    assert result["ok"] is False
    assert any("DNS lookup failed" in f for f in result["findings"])
    assert not any("SPF: no record found" in f for f in result["findings"])


async def _seed_owner_and_login(client, db_session):
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    account = Account(name="Owner Co")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner@ownerco.example",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="owner", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "owner@ownerco.example",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200, login.text


@pytest.mark.parametrize("bad_domain", ["]", "[example.com", "example.com]"])
async def test_endpoint_rejects_unbalanced_brackets(client, db_session, bad_domain):
    """
    urlparse raises ValueError("Invalid IPv6 URL") on these inputs; the endpoint
    must turn that into a 400 instead of an unhandled 500.
    """
    await _seed_owner_and_login(client, db_session)

    resp = await client.post("/api/settings/deliverability", json={"domain": bad_domain})
    assert resp.status_code == 400, resp.text


async def test_endpoint_requires_session(client):
    resp = await client.post("/api/settings/deliverability", json={"domain": "example.com"})
    assert resp.status_code == 401
