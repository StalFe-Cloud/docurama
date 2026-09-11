"""
Onboarding: the signup questionnaire persists and materializes starter folders
for the chosen vertical, once.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, TemplateFolder, User
from app.services.onboarding import VERTICAL_PACKS

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def owner_world(db_session):
    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner@example.com",
                 hashed_password=get_password_hash(PASSWORD), role="admin",
                 is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()
    return account, owner


async def _login(client, email):
    resp = await client.post("/api/auth/login",
                             json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


def test_vertical_packs_exist():
    for key in ("hr", "sales", "legal", "real_estate", "finance"):
        assert key in VERTICAL_PACKS and VERTICAL_PACKS[key], key


async def test_apply_creates_folders_for_vertical(db_session, owner_world):
    from app.services.onboarding import apply_onboarding

    account, owner = owner_world
    answers = await apply_onboarding(db_session, account.id, {
        "role": "ops", "use_case": "contracts", "monthly_volume": "10-50",
        "team_size": "2-10", "vertical": "hr", "completed": True,
    })
    assert answers["completed"] is True

    folders = (await db_session.execute(
        select(TemplateFolder.name).where(TemplateFolder.account_id == account.id)
    )).scalars().all()
    for expected in VERTICAL_PACKS["hr"]:
        assert expected in folders


from sqlalchemy.future import select  # noqa: E402


async def test_apply_is_idempotent_on_folders(db_session, owner_world):
    from app.services.onboarding import apply_onboarding

    account, owner = owner_world
    answers = {"vertical": "sales", "completed": True}
    await apply_onboarding(db_session, account.id, dict(answers))
    await apply_onboarding(db_session, account.id, dict(answers))

    count = len((await db_session.execute(
        select(TemplateFolder).where(TemplateFolder.account_id == account.id)
    )).scalars().all())
    assert count == len(VERTICAL_PACKS["sales"])


async def test_endpoint_stores_and_returns_answers(client, db_session, owner_world):
    account, owner = owner_world
    await _login(client, "owner@example.com")
    resp = await client.post("/api/onboarding", json={
        "role": "founder", "use_case": "ndas", "monthly_volume": "1-10",
        "team_size": "just-me", "vertical": "legal", "completed": True,
    })
    assert resp.status_code == 200
    assert resp.json()["vertical"] == "legal"

    stored = await client.get("/api/settings/onboarding")
    assert stored.status_code == 200
    assert stored.json()["data"]["use_case"] == "ndas"


async def test_endpoint_refuses_api_keys(client, db_session, owner_world):
    from app.models import ApiKey
    from app.services import api_keys as api_key_service

    account, owner = owner_world
    plaintext, prefix, hashed = api_key_service.generate_api_key()
    db_session.add(ApiKey(account_id=account.id, created_by_user_id=owner.id,
                          name="k", key_prefix=prefix, hashed_key=hashed,
                          scopes=["read", "write"], is_active=True))
    await db_session.commit()

    await _login(client, "owner@example.com")
    resp = await client.post("/api/onboarding", json={"vertical": "hr"},
                             headers={"X-Api-Key": plaintext})
    assert resp.status_code == 403


async def test_duplicate_folder_names_are_rejected_by_schema(db_session, owner_world):
    from sqlalchemy.exc import IntegrityError

    from app.models import TemplateFolder

    account, owner = owner_world
    db_session.add(TemplateFolder(account_id=account.id, name="Employment & HR"))
    await db_session.commit()
    db_session.add(TemplateFolder(account_id=account.id, name="Employment & HR"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
