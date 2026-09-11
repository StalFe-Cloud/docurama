"""
Host-to-tenant resolution: the pure parser decides what kind of host this is;
the DB lookup decides which account (if any) owns it.
"""
from app.services.tenant_resolver import parse_tenant_host


def test_cloud_domain_itself_is_platform():
    assert parse_tenant_host("docurama.eu", "docurama.eu") == ("platform", None, None)


def test_reserved_and_app_hosts_are_platform():
    for host in ("www.docurama.eu", "app.docurama.eu", "api.docurama.eu",
                 "verify.docurama.eu", "trust.docurama.eu"):
        assert parse_tenant_host(host, "docurama.eu")[0] == "platform", host


def test_free_subdomain_is_a_tenant_label():
    assert parse_tenant_host("acme.docurama.eu", "docurama.eu") == (
        "subdomain", "acme", None
    )


def test_multi_level_host_is_not_a_tenant_label():
    # a.b.docurama.eu is not a valid tenant hostname; treat as custom/unknown.
    kind, label, _ = parse_tenant_host("a.b.docurama.eu", "docurama.eu")
    assert kind == "custom"
    assert label is None


def test_unrelated_host_is_a_custom_domain_candidate():
    assert parse_tenant_host("sign.acme.com", "docurama.eu") == (
        "custom", None, "sign.acme.com"
    )


def test_case_and_port_are_normalized():
    assert parse_tenant_host("ACME.Docurama.EU:443", "docurama.eu") == (
        "subdomain", "acme", None
    )


def test_empty_host_is_platform():
    assert parse_tenant_host("", "docurama.eu")[0] == "platform"


async def test_resolve_subdomain_tenant(client, db_session):
    from app.models import Account
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Acme", subdomain="acme")
    db_session.add(account)
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "acme.docurama.eu")
    assert ctx.kind == "subdomain"
    assert ctx.account_id == account.id


async def test_resolve_deleted_subdomain_is_unknown(client, db_session):
    from datetime import datetime, timezone

    from app.models import Account
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Gone", subdomain="gone",
                      deleted_at=datetime.now(timezone.utc))
    db_session.add(account)
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "gone.docurama.eu")
    assert ctx.kind == "unknown"
    assert ctx.account_id is None


async def test_resolve_verified_custom_domain(client, db_session):
    from app.models import Account, DomainVerification
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    db_session.add(DomainVerification(
        account_id=account.id, domain="sign.acme.com", status="verified",
        verification_token="dcr_vfy_test", verification_method="dns_txt",
        txt_record_host="_docurama-challenge.sign.acme.com",
        txt_record_value="docurama-verification=dcr_vfy_test",
        cname_record_host="unused", cname_target="unused",
    ))
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "sign.acme.com")
    assert ctx.kind == "custom_domain"
    assert ctx.account_id == account.id


async def test_resolve_unclaimed_custom_domain_is_unknown(client, db_session):
    from app.services.tenant_resolver import resolve_tenant

    ctx = await resolve_tenant(db_session, "stranger.example")
    assert ctx.kind == "unknown"
