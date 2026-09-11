"""
Capability registry: what a deployment mode switches on.

Cloud-only machinery (billing, quotas, tenant routing) must be impossible to
reach by accident on a self-host, and visible in one place instead of scattered
mode-string comparisons.
"""
from app.core.capabilities import capabilities_for, current_capabilities
from app.core import config


def test_cloud_mode_enables_platform_capabilities():
    caps = capabilities_for("cloud")
    assert caps.tenant_subdomains is True
    assert caps.custom_domain_routing is True
    assert caps.billing is True
    assert caps.quotas is True


def test_selfhost_mode_disables_platform_capabilities():
    caps = capabilities_for("selfhost")
    assert caps.tenant_subdomains is False
    assert caps.custom_domain_routing is False
    assert caps.billing is False
    assert caps.quotas is False


def test_unknown_mode_is_treated_as_selfhost():
    assert capabilities_for("typo").billing is False


def test_current_capabilities_reads_live_settings(monkeypatch):
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    assert current_capabilities().billing is True
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    assert current_capabilities().billing is False


async def test_grant_platform_admin(db_session):
    from app.core.security import get_password_hash
    from app.models import User
    from app.services.platform_admin import grant_platform_admin

    user = User(
        account_id=None,
        email="ops@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    assert await grant_platform_admin(db_session, "ops@example.com") is True
    await db_session.refresh(user)
    assert user.is_platform_admin is True


async def test_grant_platform_admin_unknown_email_is_false(db_session):
    from app.services.platform_admin import grant_platform_admin

    assert await grant_platform_admin(db_session, "nobody@example.com") is False
