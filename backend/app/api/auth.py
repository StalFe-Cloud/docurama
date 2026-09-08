from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.config import settings
from app.core.security import verify_password, get_password_hash, create_access_token, decode_access_token
from app.models import User, Account, AccountMembership, DomainVerification
from app.schemas import UserCreate, UserLogin, UserOut, TokenResponse, CompanyOut

router = APIRouter(prefix="/auth", tags=["auth"])

async def build_user_out(user: User, db: AsyncSession) -> UserOut:
    """Enrich User model with active company, companies list, and DNS domain verification status."""
    # Ensure AccountMembership exists for backward compatibility
    if user.account_id:
        mem_q = select(AccountMembership).where(
            AccountMembership.user_id == user.id,
            AccountMembership.account_id == user.account_id
        )
        existing_mem = (await db.execute(mem_q)).scalar_one_or_none()
        if not existing_mem:
            new_mem = AccountMembership(
                user_id=user.id,
                account_id=user.account_id,
                role="owner" if user.role == "admin" else "member",
                is_active=True
            )
            db.add(new_mem)
            await db.commit()

    # Get active account name
    account_name = "Docurama Organization"
    if user.account_id:
        act_q = select(Account).where(Account.id == user.account_id)
        act = (await db.execute(act_q)).scalar_one_or_none()
        if act:
            account_name = act.name

    # Load all user companies
    comp_q = (
        select(AccountMembership)
        .where(
            AccountMembership.user_id == user.id,
            AccountMembership.is_active == True
        )
        .options(selectinload(AccountMembership.account))
    )
    comp_res = await db.execute(comp_q)
    memberships = comp_res.scalars().all()

    companies_list = []
    for m in memberships:
        if m.account:
            # Check domain verification for this company
            dom_q = select(DomainVerification).where(
                DomainVerification.account_id == m.account.id
            ).order_by(DomainVerification.created_at.desc())
            dom_rec = (await db.execute(dom_q)).scalars().first()

            # Member count
            cnt_q = select(func.count()).select_from(AccountMembership).where(
                AccountMembership.account_id == m.account.id,
                AccountMembership.is_active == True
            )
            member_count = (await db.execute(cnt_q)).scalar() or 1

            companies_list.append(CompanyOut(
                id=m.account.id,
                name=m.account.name,
                subdomain=m.account.subdomain,
                timezone=getattr(m.account, "timezone", "(GMT+00:00) UTC"),
                enforce_domain_auth=bool(getattr(m.account, "enforce_domain_auth", False)),
                is_active_company=(m.account.id == user.account_id),
                role=m.role,
                members_count=member_count,
                verified_domain=dom_rec.domain if dom_rec else None,
                domain_verification_status=dom_rec.status if dom_rec else "unverified",
                created_at=m.account.created_at
            ))

    # Check active company's domain verification for additional authentication validation
    domain_verified = False
    verified_domain = None
    auth_assurance_level = "standard"

    if user.account_id:
        active_dom_q = select(DomainVerification).where(
            DomainVerification.account_id == user.account_id,
            DomainVerification.status == "verified"
        )
        active_dom = (await db.execute(active_dom_q)).scalars().first()
        if active_dom:
            domain_verified = True
            verified_domain = active_dom.domain
            auth_assurance_level = "enterprise_domain_verified"

    return UserOut(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        is_active=user.is_active,
        account_id=user.account_id,
        account_name=account_name,
        companies=companies_list,
        domain_verified=domain_verified,
        verified_domain=verified_domain,
        auth_assurance_level=auth_assurance_level,
        created_at=user.created_at
    )

async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> User:
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    if not token:
        token = request.cookies.get(settings.SESSION_COOKIE_NAME)
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
        )
        
    user_id = payload.get("sub")
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")
    return user

@router.post("/register", response_model=TokenResponse)
async def register(
    user_in: UserCreate,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    query = select(User).where(User.email == user_in.email)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
        
    # Create default Account
    account = Account(name=f"{user_in.first_name or 'User'}'s Organization")
    db.add(account)
    await db.flush()
    
    user = User(
        account_id=account.id,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        role="admin",
        is_active=True,
    )
    db.add(user)
    await db.flush()

    # Create initial owner membership
    membership = AccountMembership(
        user_id=user.id,
        account_id=account.id,
        role="owner",
        is_active=True
    )
    db.add(membership)
    await db.commit()
    await db.refresh(user)
    
    token = create_access_token(subject=user.id, claims={"role": user.role, "email": user.email, "account_id": user.account_id})
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    enriched_user = await build_user_out(user, db)
    return TokenResponse(access_token=token, user=enriched_user)

@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    query = select(User).where(User.email == credentials.email)
    user = (await db.execute(query)).scalar_one_or_none()
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password.")
        
    token = create_access_token(subject=user.id, claims={"role": user.role, "email": user.email, "account_id": user.account_id})
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    enriched_user = await build_user_out(user, db)
    return TokenResponse(access_token=token, user=enriched_user)

@router.get("/me", response_model=UserOut)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await build_user_out(current_user, db)

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key=settings.SESSION_COOKIE_NAME)
    return {"message": "Logged out successfully"}
