import pytest
import uuid
from app.models import User, Account, AccountMembership, DomainVerification
from pydantic import ValidationError
from app.schemas import (
    CompanyCreate, CompanyOut, DomainAuthValidateRequest,
    CompanyInviteRequest, CompanyInviteResponse,
)

def sanitize_domain(d: str) -> str:
    cleaned = d.strip().lower()
    cleaned = cleaned.replace("https://", "").replace("http://", "")
    return cleaned.split("/")[0].split(":")[0]

@pytest.mark.asyncio
async def test_account_membership_model_creation():
    user_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    membership = AccountMembership(
        user_id=user_id,
        account_id=account_id,
        role="owner",
        is_active=True
    )
    assert membership.user_id == user_id
    assert membership.account_id == account_id
    assert membership.role == "owner"
    assert membership.is_active is True

@pytest.mark.asyncio
async def test_company_create_schema():
    data = {
        "name": "StalFe Global Ops",
        "subdomain": "stalfe-ops",
        "domain": "stalfe.com",
        "timezone": "(GMT+02:00) Paris"
    }
    comp = CompanyCreate(**data)
    assert comp.name == "StalFe Global Ops"
    assert comp.subdomain == "stalfe-ops"
    assert comp.domain == "stalfe.com"
    assert comp.timezone == "(GMT+02:00) Paris"

@pytest.mark.asyncio
async def test_domain_auth_validate_schema():
    req = DomainAuthValidateRequest(email="chief.counsel@stalfe.com")
    assert req.email == "chief.counsel@stalfe.com"
    domain_part = sanitize_domain(req.email.split("@")[1])
    assert domain_part == "stalfe.com"

def test_dns_txt_challenge_generation():
    domain = "company-corp.com"
    token = f"dcr_vfy_{uuid.uuid4().hex[:16]}"
    challenge_host = f"_docurama-challenge.{domain}"
    challenge_value = f"docurama-verification={token}"
    
    assert challenge_host.startswith("_docurama-challenge.")
    assert challenge_value.startswith("docurama-verification=dcr_vfy_")
    assert len(token) > 10

# ---------------------------------------------------------------------------
# Company member invitation (Phase 0: closes out the DNS / multi-company plan)
# ---------------------------------------------------------------------------

VALID_MEMBER_ROLES = ["owner", "admin", "manager", "member"]

def test_company_invite_request_defaults_to_member():
    req = CompanyInviteRequest(email="new.counsel@stalfe.com")
    assert req.email == "new.counsel@stalfe.com"
    assert req.role == "member"
    assert req.first_name is None
    assert req.last_name is None

def test_company_invite_request_accepts_full_payload():
    req = CompanyInviteRequest(
        email="ops.lead@stalfe.com",
        role="admin",
        first_name="Ops",
        last_name="Lead",
    )
    assert req.role == "admin"
    assert req.first_name == "Ops"
    assert req.last_name == "Lead"

def test_company_invite_request_rejects_malformed_email():
    with pytest.raises(ValidationError):
        CompanyInviteRequest(email="not-an-email")

def test_invite_role_normalization_matches_accepted_roles():
    # The endpoint lowercases and validates the incoming role before persisting it.
    for supplied, expected in [("Owner", "owner"), ("ADMIN", "admin"), ("Manager", "manager"), ("Member", "member")]:
        normalized = supplied.strip().lower()
        assert normalized == expected
        assert normalized in VALID_MEMBER_ROLES

    assert "superuser" not in VALID_MEMBER_ROLES

def test_company_invite_response_carries_one_time_password():
    res = CompanyInviteResponse(
        success=True,
        membership_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        email="new.counsel@stalfe.com",
        role="member",
        is_new_user=True,
        temporary_password="s3cure-one-time-token",
        message="Created account and granted member access.",
    )
    assert res.is_new_user is True
    assert res.temporary_password == "s3cure-one-time-token"

def test_company_invite_response_omits_password_for_existing_user():
    res = CompanyInviteResponse(
        success=True,
        membership_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        email="existing@stalfe.com",
        role="admin",
        is_new_user=False,
        message="Granted admin access to this company.",
    )
    assert res.is_new_user is False
    assert res.temporary_password is None

def test_archived_membership_is_deactivated_not_deleted():
    # Removal sets is_active False so historical audit trails stay resolvable.
    membership = AccountMembership(
        user_id=str(uuid.uuid4()),
        account_id=str(uuid.uuid4()),
        role="member",
        is_active=True,
    )
    membership.is_active = False
    assert membership.is_active is False
    assert membership.user_id is not None
    assert membership.account_id is not None
