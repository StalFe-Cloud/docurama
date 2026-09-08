import pytest
import uuid
from app.models import User, Account, AccountMembership, DomainVerification
from app.schemas import CompanyCreate, CompanyOut, DomainAuthValidateRequest

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
