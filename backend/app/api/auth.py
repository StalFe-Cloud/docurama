import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.config import settings
from app.core.rate_limit import limiter
from app.services.tenant_resolver import parse_tenant_host, PLATFORM
from app.core.security import (
    verify_and_upgrade_password, get_password_hash,
    create_access_token, decode_access_token,
)
from app.models import (
    User, Account, AccountMembership, DomainVerification, ApiKey, PasswordResetToken,
    DomainJoinRequest, EmailSendLog,
)
from app.schemas import (
    UserCreate, UserLogin, UserOut, TokenResponse, CompanyOut,
    PasswordChangeRequest, PasswordChangeResponse,
    PasswordResetRequest, PasswordResetConfirm, GenericAckResponse,
    TotpEnrolStart, TotpEnrolConfirm, TotpEnrolResult, TotpStatus, TotpDisableRequest,
    LoginChallengeResponse, TotpLoginRequest,
)
from app.services import api_keys as api_key_service
from app.services import password_reset as reset_service
from app.services import mailer, smtp_config
from app.services import totp as totp_service
from app.services import audit_chain
from app.core.secrets import decrypt_secret, encrypt_secret
from app.services.qr_generator import generate_qr_base64

logger = logging.getLogger("docurama.auth")

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
        is_platform_admin=bool(getattr(user, "is_platform_admin", False)),
        account_id=user.account_id,
        account_name=account_name,
        companies=companies_list,
        domain_verified=domain_verified,
        verified_domain=verified_domain,
        auth_assurance_level=auth_assurance_level,
        created_at=user.created_at
    )

async def _user_from_api_key(presented: str, request: Request, db: AsyncSession) -> Optional[User]:
    """
    Resolve an issued API key to the user who created it.

    The key's prefix is stored in clear and indexed, so lookup is a single indexed
    query; the secret itself is compared against a stored hash in constant time.
    """
    prefix = api_key_service.parse_prefix(presented)
    if not prefix:
        return None

    candidates = (await db.execute(
        select(ApiKey).where(ApiKey.key_prefix == prefix)
    )).scalars().all()

    for key in candidates:
        if not api_key_service.verify_api_key(presented, key.hashed_key):
            continue
        if not api_key_service.is_usable(key.is_active, key.revoked_at, key.expires_at):
            return None

        owner = (await db.execute(
            select(User).where(User.id == key.created_by_user_id)
        )).scalar_one_or_none()
        if not owner or not owner.is_active:
            return None

        # A key authorises only what its scopes allow. Fail closed: a key with no
        # scopes can do nothing, which is the only safe meaning of an empty list.
        scopes = key.scopes or []
        mutating = request.method.upper() not in ("GET", "HEAD", "OPTIONS")
        if mutating and "write" not in scopes:
            raise HTTPException(status_code=403, detail="This API key is read-only")
        if not mutating and "read" not in scopes:
            raise HTTPException(status_code=403, detail="This API key has no read scope")

        key.last_used_at = datetime.now(timezone.utc)
        await db.commit()

        # Mark how this request authenticated so interactive-only endpoints can
        # refuse machine credentials before their mutation no-ops on a detached
        # owner (see require_interactive_session below).
        request.state.auth_via = "api_key"

        # Detach the owner before rebinding the account so the binding is request
        # scoped only. Previously every key call rewrote the owner's active company
        # in the database, which made machine traffic corrupt interactive sessions.
        db.expunge(owner)
        owner.account_id = key.account_id
        return owner

    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> User:
    # Issued API keys authenticate machine callers against the documented API.
    api_key = request.headers.get("X-Api-Key")
    if api_key:
        key_user = await _user_from_api_key(api_key.strip(), request, db)
        if key_user:
            # Cloud mode: every authenticated call must belong to the host's
            # workspace. Late import: this module is imported by app.api.tenant
            # at load time.
            from app.api.tenant import binding_rejection

            rejection = await binding_rejection(db, request, key_user)
            if rejection is not None:
                raise rejection

            return key_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, revoked, or expired API key",
        )

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

    # Token-purpose enforcement. The MFA challenge token is minted with
    # purpose="mfa_challenge" and must only authorise submitting a TOTP code
    # (see /auth/totp/verify). Accepting it here would let anyone who knows the
    # password bypass the second factor entirely by replaying the challenge
    # token as a session credential.
    if payload.get("purpose") not in (None, "session"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session token",
        )
        
    user_id = payload.get("sub")
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")

    # Token-version revocation. A session JWT embeds the user's token_version at
    # mint time; password changes, TOTP disables and sign-outs bump the stored
    # value, which instantly orphans every token issued before them. Tokens minted
    # before this column existed carry no version and are honoured as version 0,
    # so a deployment does not sign everyone out on upgrade.
    try:
        token_version = int(payload.get("ver", 0))
    except (TypeError, ValueError):
        token_version = -1
    if token_version != int(user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session revoked. Sign in again.",
        )

    # Cloud mode: every authenticated call must belong to the host's workspace.
    # Late import: this module is imported by app.api.tenant at load time.
    from app.api.tenant import binding_rejection

    rejection = await binding_rejection(db, request, user)
    if rejection is not None:
        raise rejection

    return user


async def require_interactive_session(request: Request) -> None:
    """Account-management endpoints mutate the signed-in user; an API key is a
    machine credential and its owner object is request-scoped, so mutations
    silently no-op. Refuse instead of pretending to succeed."""
    if getattr(request.state, "auth_via", None) == "api_key":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires an interactive session, not an API key.",
        )


def _platform_signup_url() -> str:
    """
    The sign-up link to hand a user who landed on a tenant host: APP_URL's own
    origin when it is a platform host under the cloud domain, otherwise the
    conventional app.<cloud domain> host (a reserved subdomain, so it always
    resolves to the platform) carrying APP_URL's scheme.
    """
    parsed = urlparse(settings.APP_URL)
    scheme = parsed.scheme or "https"
    host = (parsed.hostname or "").strip()
    if parse_tenant_host(host, settings.CLOUD_DOMAIN)[0] != PLATFORM:
        host = f"app.{settings.CLOUD_DOMAIN}"
    return f"{scheme}://{host}/sign_up"


async def _send_domain_join_activation(user: User, join_token: str) -> str:
    """
    Deliver the activation link for a domain-joined signup. Best-effort and
    never raising: registration has already succeeded, and a mail outage must
    not strand the row or 500 the signup. Every attempt lands in email_send_logs
    so 'did the activation mail go out?' has a factual answer (§17).
    """
    from app.services import smtp_config, mailer

    base = str(settings.APP_URL).rstrip("/")
    link = f"{base}/activate?token={join_token}"
    subject = "Activate your Docurama account"
    html = (
        f"<p>Welcome to Docurama.</p>"
        f"<p>Confirm your email address to activate your account:</p>"
        f"<p><a href=\"{link}\">Activate my account</a></p>"
        f"<p>This link works once and expires in 48 hours.</p>"
    )
    text = f"Welcome to Docurama. Confirm your email to activate: {link} (single use, 48h)"
    status_label = "sent"
    error_detail = ""
    try:
        smtp = await smtp_config.resolve(db, user.account_id)
        result = await asyncio.to_thread(
            mailer.send_email, smtp, user.email, "", subject, html, text
        )
        if not getattr(result, "sent", True):
            status_label = "failed"
            error_detail = str(getattr(result, "error", ""))[:490]
    except Exception as exc:
        status_label = "failed"
        error_detail = repr(exc)[:490]

    try:
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as log_db:
            log_db.add(EmailSendLog(
                kind="domain_join_activation",
                recipient=user.email,
                subject=subject,
                status=status_label,
                error=error_detail,
                related_id=user.id,
            ))
            await log_db.commit()
    except Exception:
        pass  # logging must never break registration
    return status_label


async def _notify_workspace_admins(
    db,
    account_id: str,
    subject: str,
    html: str,
    text: str,
    kind: str,
    related_id: str,
) -> str:
    """
    Sprint 8: alert every admin of a workspace about a domain-join event.

    Best-effort by the same contract as the activation mail: an SMTP outage
    must never strand the join itself, and every attempt is accountable in
    email_send_logs with per-recipient status. Unlike the activation mail,
    the log rows are written on the REQUEST session and commit with the join
    event itself: the alert is part of the join's story, and if the join
    rolls back there is no event to have alerted about.
    """
    from app.services import smtp_config, mailer

    admins = (await db.execute(
        select(User).where(
            User.account_id == account_id,
            User.role == "admin",
            User.is_active == True,  # noqa: E712 - deliberate SQLAlchemy style
        )
    )).scalars().all()
    if not admins:
        return "no_admins"

    overall = "sent"
    for admin in admins:
        status_label = "sent"
        error_detail = ""
        try:
            smtp = await smtp_config.resolve(db, account_id)
            result = await asyncio.to_thread(
                mailer.send_email, smtp, admin.email, "", subject, html, text
            )
            if not getattr(result, "sent", True):
                status_label = "failed"
                error_detail = str(getattr(result, "error", ""))[:490]
        except Exception as exc:
            status_label = "failed"
            error_detail = repr(exc)[:490]
        if status_label != "sent":
            overall = "failed"
        db.add(EmailSendLog(
            kind=kind,
            recipient=admin.email,
            subject=subject,
            status=status_label,
            error=error_detail,
            related_id=related_id,
        ))
    return overall


@router.post("/domain-join/activate")
@limiter.limit("10/minute")
async def domain_join_activate(
    request: Request,
    payload: Dict[str, str],
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Activate a domain-joined account (email confirmation + tenant join).

    The activation token carries purpose=domain_join: it is never accepted as
    a session by get_current_user, and it is single-use - activation bumps the
    user's token_version, so a replayed token fails the version check even
    within its 48-hour window. In approval mode the user is confirmed but waits
    for a workspace admin; in auto_join mode membership is granted here.
    """
    token = (payload or {}).get("token", "").strip()
    if not token:
        raise HTTPException(status_code=422, detail="Activation token is required.")

    claims = decode_access_token(token)
    if not claims or claims.get("purpose") != "domain_join":
        raise HTTPException(status_code=400, detail="Invalid or expired activation token.")

    user = (await db.execute(
        select(User).where(User.id == str(claims.get("sub")))
    )).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    # Single-use enforcement via token_version: the token embeds the version
    # at mint time; activation bumps it, orphaning itself immediately.
    try:
        token_ver = int(claims.get("ver", -1))
    except (TypeError, ValueError):
        token_ver = -1
    if token_ver != int(user.token_version or 0):
        raise HTTPException(
            status_code=400,
            detail="This activation link has already been used. Sign in instead.",
        )

    # Re-resolve the domain row: join mode is read live, so an admin changing
    # the mode between registration and activation is honoured.
    email_domain = user.email.rsplit("@", 1)[-1].strip().lower()
    domain_row = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.account_id == user.account_id,
            DomainVerification.domain == email_domain,
            DomainVerification.join_mode.in_(["auto_join", "approval"]),
        )
    )).scalar_one_or_none()
    join_mode = domain_row.join_mode if domain_row is not None else "auto_join"

    user.is_active = True
    membership_state = "active"

    existing_membership = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == user.id,
            AccountMembership.account_id == user.account_id,
        )
    )).scalar_one_or_none()

    if join_mode == "approval":
        pending = (await db.execute(
            select(DomainJoinRequest).where(
                DomainJoinRequest.user_id == user.id,
                DomainJoinRequest.status == "pending",
            )
        )).scalar_one_or_none()
        if pending is None:
            new_request = DomainJoinRequest(
                account_id=user.account_id,
                domain_id=domain_row.id if domain_row is not None else "",
                user_id=user.id,
                user_email=user.email,
                status="pending",
            )
            db.add(new_request)
            await db.flush()
            # Sprint 8: admins learn about the pending join by email —
            # the queue is only useful if someone knows it has entries.
            await _notify_workspace_admins(
                db,
                user.account_id,
                "Docurama: a new member is waiting for your approval",
                f"<p>{user.email} activated their account via your verified domain and is waiting in the join queue.</p>"
                f"<p><a href=\"{str(settings.APP_URL).rstrip('/')}/admin\">Review the pending join</a></p>",
                f"{user.email} activated via your verified domain and is waiting in the join queue. Review it in the admin console.",
                "domain_join_admin_alert",
                new_request.id,
            )
        membership_state = "pending_approval"
    else:
        if existing_membership is None:
            db.add(AccountMembership(
                user_id=user.id,
                account_id=user.account_id,
                role="member",
                is_active=True,
            ))
            await _notify_workspace_admins(
                db,
                user.account_id,
                "Docurama: a new member joined your workspace",
                f"<p>{user.email} joined your workspace through your verified domain (auto-join).</p>",
                f"{user.email} joined your workspace through your verified domain (auto-join).",
                "domain_join_admin_alert",
                user.id,
            )
        elif not existing_membership.is_active:
            existing_membership.is_active = True

    # Single-use bump LAST: it orphans this activation token (and any session
    # minted before), exactly like a credential rotation.
    user.token_version = (user.token_version or 0) + 1
    await db.commit()

    return {
        "status": "activated",
        "join_mode": join_mode,
        "membership": membership_state,
    }


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
async def register(
    request: Request,
    user_in: UserCreate,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    if not settings.registration_open:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Registration is closed on this deployment. "
                "Ask an existing administrator to invite you."
            ),
        )

    # Cloud mode: a signup is only meaningful on the platform host. Accepted on
    # a tenant subdomain, the new account would not match the host's tenant, so
    # the universal tenant guard would 403 every authenticated call and strand
    # the user mid-onboarding. Turn them away before an account is created.
    if settings.DEPLOYMENT_MODE.strip().lower() == "cloud":
        kind, _, _ = parse_tenant_host(
            request.headers.get("host") or "", settings.CLOUD_DOMAIN
        )
        if kind != PLATFORM:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Registration is available on the Docurama platform. "
                    f"Sign up at {_platform_signup_url()}."
                ),
            )

    # Neutral age gate (P1-7), checked after host eligibility. The platform
    # records the statement; it does not police identity. Operators who serve
    # contexts where the statement itself is wrong to ask switch it off with
    # DOCURAMA_AGE_GATE_REQUIRED=false.
    if settings.AGE_GATE_REQUIRED and not user_in.age_gate_confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please confirm the age statement to create an account.",
        )

    query = select(User).where(User.email == user_in.email)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    # Marketing consent (GDPR Art. 7) is recorded in both branches below:
    # consent exists only when it was explicitly given, with its timestamp.
    consent_at = (
        datetime.now(timezone.utc) if user_in.marketing_consent else None
    )

    # ------------------------------------------------------------------
    # Enterprise domain activation (§18). A signup whose email domain belongs
    # to a VERIFIED workspace domain with a join mode does not create a new
    # workspace - it joins the existing tenant:
    #   auto_join: membership is granted at activation (email confirmation).
    #   approval:  activation queues a join request for a workspace admin.
    # The account is created inactive and role=member; it becomes usable only
    # through POST /auth/domain-join/activate, whose token is single-use.
    # ------------------------------------------------------------------
    email_domain = user_in.email.rsplit("@", 1)[-1].strip().lower()
    joinable_domain = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.domain == email_domain,
            DomainVerification.status == "verified",
            DomainVerification.join_mode.in_(["auto_join", "approval"]),
        )
    )).scalar_one_or_none()

    if joinable_domain is not None:
        user = User(
            account_id=joinable_domain.account_id,
            email=user_in.email,
            hashed_password=get_password_hash(user_in.password),
            first_name=user_in.first_name,
            last_name=user_in.last_name,
            role="member",
            is_active=False,
            marketing_consent=user_in.marketing_consent,
            marketing_consent_at=consent_at,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        join_token = create_access_token(
            subject=user.id,
            expires_delta=timedelta(hours=48),
            claims={"purpose": "domain_join", "email": user.email,
                    "ver": user.token_version or 0},
        )
        delivery = await _send_domain_join_activation(user, join_token)
        return JSONResponse(status_code=status.HTTP_200_OK, content={
            "status": "pending_activation",
            "join_mode": joinable_domain.join_mode,
            "account_id": joinable_domain.account_id,
            "email_delivery": delivery,
            # The token surfaces in the response only in development, where no
            # SMTP exists to deliver it - the demo flow must stay usable.
            "activation_token": (
                join_token if settings.is_development else None
            ),
        })

    # Create default Account (14-day Plus Trial, no card, in Cloud mode;
    # Unlimited in self-host mode, which is an Enterprise deployment).
    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"
    now = datetime.now(timezone.utc)
    if is_cloud:
        from app.services.pricing import TRIAL_DAYS

        account = Account(
            name=f"{user_in.first_name or 'User'}'s Organization",
            plan="plus",
            is_trial=True,
            trial_ends_at=now + timedelta(days=TRIAL_DAYS),
            billing_interval="monthly",
        )
    else:
        account = Account(
            name=f"{user_in.first_name or 'User'}'s Organization",
            plan="unlimited",
            is_trial=False,
        )
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
        marketing_consent=user_in.marketing_consent,
        marketing_consent_at=consent_at,
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
    
    token = create_access_token(subject=user.id, claims={"purpose": "session", "role": user.role, "email": user.email, "account_id": user.account_id, "ver": user.token_version or 0})
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    enriched_user = await build_user_out(user, db)
    return TokenResponse(access_token=token, user=enriched_user)

# Returns TokenResponse normally, or LoginChallengeResponse when a second factor is
# enrolled, so no single response_model applies.
@router.post("/login")
@limiter.limit("10/minute")
async def login(
    request: Request,
    credentials: UserLogin,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    query = select(User).where(User.email == credentials.email)
    user = (await db.execute(query)).scalar_one_or_none()

    if not user:
        # Unknown identity: record the attempt against the presented address so
        # the ledger shows password guessing even when it misses.
        await audit_chain.safe_append(
            db, event_type="login_failed", severity="warning",
            actor_email=credentials.email,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("User-Agent"),
            description="Sign-in failed: unknown identity",
        )
        await db.commit()
        raise HTTPException(status_code=400, detail="Incorrect email or password.")

    # Passwords hashed under the superseded bcrypt scheme are migrated to argon2 on
    # the first successful sign-in, so the old hashes drain away without a reset.
    password_ok, upgraded_hash = verify_and_upgrade_password(
        credentials.password, user.hashed_password
    )
    if not password_ok:
        await audit_chain.safe_append(
            db, event_type="login_failed", severity="warning",
            account_id=user.account_id, actor_user_id=user.id, actor_email=user.email,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("User-Agent"),
            description="Sign-in failed: incorrect password",
        )
        await db.commit()
        raise HTTPException(status_code=400, detail="Incorrect email or password.")

    # An administratively pending (domain-join awaiting activation) or disabled
    # account must not authenticate, even with a correct password.
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is pending activation or has been disabled. Confirm your email or contact your workspace administrator.",
        )

    if upgraded_hash:
        user.hashed_password = upgraded_hash
        await db.commit()
        await db.refresh(user)

    # A correct password is not a session when a second factor is enrolled. Return a
    # short-lived challenge instead, carrying no user detail: the caller has proved
    # one factor, and nothing about the account is disclosed until they prove the other.
    if getattr(user, "totp_enabled", False):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=LoginChallengeResponse(
                challenge_token=_issue_mfa_challenge(user),
                message="Enter the code from your authenticator app.",
            ).model_dump(),
        )

    token = create_access_token(subject=user.id, claims={"purpose": "session", "role": user.role, "email": user.email, "account_id": user.account_id, "ver": user.token_version or 0})
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    enriched_user = await build_user_out(user, db)
    await audit_chain.safe_append(
        db, event_type="login_success",
        account_id=user.account_id, actor_user_id=user.id, actor_email=user.email,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
        description="Sign-in succeeded (password factor)",
    )
    await db.commit()
    return TokenResponse(access_token=token, user=enriched_user)

@router.get("/me", response_model=UserOut)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await build_user_out(current_user, db)

@router.post("/change-password", response_model=PasswordChangeResponse)
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Change the signed-in user's password.

    The Profile screen has always shown a password form, but there was no endpoint behind
    it: the button reported "Password changed successfully" and nothing happened. Someone
    changing a password because they believe it is exposed is exactly the person who must
    not be told a rotation succeeded when it did not.

    The current password is required and verified. Knowing a live session is not enough
    to take a credential over, and a wrong current password is rejected rather than
    quietly ignored.
    """
    # verify_and_upgrade_password rather than a bare check, matching sign-in: the stored
    # hash may still be bcrypt from before argon2 became the default, and the returned
    # replacement is discarded here only because the hash is about to be rewritten anyway.
    current_ok, _rehash = verify_and_upgrade_password(
        payload.current_password, current_user.hashed_password
    )
    if not current_ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your current password is incorrect.",
        )

    new_password = payload.new_password or ""
    if len(new_password) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a password of at least 12 characters.",
        )
    if new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password must differ from the current one.",
        )

    current_user.hashed_password = get_password_hash(new_password)
    current_user.updated_at = datetime.now(timezone.utc)
    # Rotating the credential must kill the sessions minted under the old one,
    # including this one: whoever changed the password re-authenticates.
    current_user.token_version = (current_user.token_version or 0) + 1
    await db.commit()

    return PasswordChangeResponse(
        success=True,
        message="Your password has been changed. Use it the next time you sign in.",
    )


# A pending sign-in that has cleared the password but not the second factor. Short
# lived and single purpose: it authorises submitting a code, nothing else.
MFA_CHALLENGE_MINUTES = 5


def _issue_mfa_challenge(user: User) -> str:
    return create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=MFA_CHALLENGE_MINUTES),
        claims={"purpose": "mfa_challenge", "email": user.email},
    )


def _user_id_from_challenge(token: str) -> Optional[str]:
    payload = decode_access_token(token or "")
    if not payload or payload.get("purpose") != "mfa_challenge":
        return None
    return payload.get("sub")


def _totp_secret_for(user: User) -> Optional[str]:
    encrypted = getattr(user, "totp_secret_encrypted", None)
    if not encrypted:
        return None
    try:
        return decrypt_secret(encrypted)
    except Exception:
        # A secret encrypted under a rotated DOCURAMA_SECRET_KEY cannot be read. Treat
        # it as absent rather than as a factor that can never be satisfied.
        return None


@router.get("/totp/status", response_model=TotpStatus)
async def totp_status(current_user: User = Depends(get_current_user)):
    return TotpStatus(
        enabled=bool(getattr(current_user, "totp_enabled", False)),
        confirmed_at=getattr(current_user, "totp_confirmed_at", None),
        recovery_codes_remaining=len(getattr(current_user, "totp_recovery_codes", None) or []),
    )


@router.post("/totp/enrol", response_model=TotpEnrolStart)
async def start_totp_enrolment(
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Begin enrolment: mint a secret and return it with a scannable QR.

    Deliberately does not enable the factor. Enabling on generation would lock the
    user out the moment they closed the dialog without finishing, so totp_enabled is
    only set once a submitted code proves the app is configured.
    """
    if getattr(current_user, "totp_enabled", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Two-factor authentication is already enabled. Disable it first to re-enrol.",
        )

    secret = totp_service.generate_secret()
    current_user.totp_secret_encrypted = encrypt_secret(secret)
    current_user.totp_enabled = False
    current_user.totp_confirmed_at = None
    await db.commit()

    uri = totp_service.provisioning_uri(secret, current_user.email)
    return TotpEnrolStart(
        secret=secret,
        provisioning_uri=uri,
        qr_base64=generate_qr_base64(uri, box_size=6, border=2),
    )


@router.post("/totp/confirm", response_model=TotpEnrolResult)
async def confirm_totp_enrolment(
    payload: TotpEnrolConfirm,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Finish enrolment by proving the authenticator works, then hand over recovery codes.
    """
    secret = _totp_secret_for(current_user)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start enrolment first, then enter the code your app shows.",
        )

    if not totp_service.verify_code(secret, payload.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not valid. Check your authenticator app and try again.",
        )

    plaintext_codes, hashed_codes = totp_service.generate_recovery_codes()
    current_user.totp_enabled = True
    current_user.totp_confirmed_at = datetime.now(timezone.utc)
    current_user.totp_recovery_codes = hashed_codes
    await audit_chain.safe_append(
        db, event_type="totp_enabled", severity="warning",
        account_id=current_user.account_id, actor_user_id=current_user.id,
        actor_email=current_user.email,
        description="TOTP second factor enrolled and confirmed",
    )
    await db.commit()

    return TotpEnrolResult(
        enabled=True,
        recovery_codes=plaintext_codes,
        message=(
            "Two-factor authentication is on. Save these recovery codes now; each works "
            "once and they are not shown again."
        ),
    )


@router.post("/totp/disable", response_model=GenericAckResponse)
async def disable_totp(
    payload: TotpDisableRequest,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Turn the factor off, re-authenticating with the password first.

    A live session is not sufficient: otherwise anyone who walks up to an unlocked
    machine can strip the second factor without knowing the password.
    """
    ok, _rehash = verify_and_upgrade_password(payload.password, current_user.hashed_password)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your password is incorrect.",
        )

    current_user.totp_enabled = False
    current_user.totp_secret_encrypted = None
    current_user.totp_confirmed_at = None
    current_user.totp_recovery_codes = []
    # Dropping the second factor is a credential event: any session minted while
    # the factor was on must not survive it.
    current_user.token_version = (current_user.token_version or 0) + 1
    await audit_chain.safe_append(
        db, event_type="totp_disabled", severity="critical",
        account_id=current_user.account_id, actor_user_id=current_user.id,
        actor_email=current_user.email,
        description="TOTP second factor disabled after password re-authentication",
    )
    await db.commit()

    return GenericAckResponse(success=True, message="Two-factor authentication is off.")


@router.post("/totp/verify", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_totp_login(
    request: Request,
    payload: TotpLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Second step of sign-in: exchange a challenge plus a code for a session.

    Accepts either a current TOTP code or a recovery code, and a recovery code is
    burned on use.
    """
    user_id = _user_id_from_challenge(payload.challenge_token)
    rejected = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="That sign-in attempt has expired. Start again.",
    )
    if not user_id:
        raise rejected

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active or not getattr(user, "totp_enabled", False):
        raise rejected

    submitted = (payload.code or "").strip()
    secret = _totp_secret_for(user)
    accepted = bool(secret) and totp_service.verify_code(secret, submitted)

    if not accepted:
        # Fall back to a recovery code, which is burned whether or not the rest of
        # the sign-in succeeds.
        used, remaining = totp_service.consume_recovery_code(
            submitted, getattr(user, "totp_recovery_codes", None) or []
        )
        if used:
            user.totp_recovery_codes = remaining
            await db.commit()
            accepted = True

    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not valid.",
        )

    token = create_access_token(
        subject=user.id,
        claims={"purpose": "session", "role": user.role, "email": user.email, "account_id": user.account_id, "ver": user.token_version or 0},
    )
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return TokenResponse(access_token=token, user=await build_user_out(user, db))

@router.post("/request-password-reset", response_model=GenericAckResponse)
@limiter.limit("5/minute")
async def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Begin a password reset.

    Answers identically whether or not the address is registered. A response that
    differed would let anyone test which addresses have accounts, and the whole point
    of this endpoint is that it is callable by someone who is not signed in.

    A failure to send mail is logged but not disclosed, for the same reason.
    """
    email = (payload.email or "").strip().lower()
    acknowledgement = GenericAckResponse(
        success=True,
        message=(
            "If that address has an account, a reset link is on its way. "
            "The link works once and expires shortly."
        ),
    )

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not user.is_active:
        return acknowledgement

    plaintext, hashed = reset_service.generate_token()
    db.add(PasswordResetToken(
        user_id=user.id,
        hashed_token=hashed,
        expires_at=reset_service.expiry_from_now(),
        requested_ip=request.client.host if request.client else None,
    ))
    await db.commit()

    config = await smtp_config.resolve(db, user.account_id)
    link = reset_service.reset_url(settings.APP_URL, plaintext)
    subject, html, text = mailer.password_reset(
        user.first_name or user.email, link, reset_service.TOKEN_TTL_MINUTES
    )
    result = await asyncio.to_thread(
        mailer.send_email, config, user.email, user.first_name or user.email, subject, html, text
    )
    if not result.sent:
        # Visible to the operator in the logs, invisible to the caller.
        logger.warning("password reset mail not delivered to %s: %s", user.email, result.error)

    return acknowledgement


@router.post("/reset-password", response_model=PasswordChangeResponse)
async def reset_password(
    payload: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db),
):
    """
    Redeem a reset token and set a new password.

    The token is looked up by hash, checked for expiry and prior use, and burned in
    the same transaction that changes the password, so a link cannot be replayed.
    """
    submitted = (payload.token or "").strip()
    hashed = reset_service.hash_token(submitted)

    row = (await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.hashed_token == hashed)
    )).scalar_one_or_none()

    # One message for every failure mode. Distinguishing "unknown" from "expired"
    # tells an attacker whether a guessed token ever existed.
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Request a new one.",
    )
    if row is None or not reset_service.is_redeemable(row.expires_at, row.used_at):
        raise invalid

    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise invalid

    rejection = reset_service.validate_new_password(payload.new_password)
    if rejection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=rejection)

    now = datetime.now(timezone.utc)
    user.hashed_password = get_password_hash(payload.new_password)
    user.updated_at = now
    # A reset link redeemable by whoever holds the email is a credential rotation:
    # sessions issued before it must not outlive it.
    user.token_version = (user.token_version or 0) + 1
    row.used_at = now

    # Any other outstanding link for this account is now stale. Leaving them live
    # would mean an older email could still take the account over afterwards.
    others = (await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
    )).scalars().all()
    for other in others:
        other.used_at = now

    await audit_chain.safe_append(
        db, event_type="password_changed", severity="warning",
        account_id=user.account_id, actor_user_id=user.id, actor_email=user.email,
        description="Password reset via emailed link; sessions revoked",
    )
    await db.commit()

    config = await smtp_config.resolve(db, user.account_id)
    subject, html, text = mailer.password_changed_notice(
        user.first_name or user.email, now.strftime("%Y-%m-%d %H:%M UTC")
    )
    await asyncio.to_thread(
        mailer.send_email, config, user.email, user.first_name or user.email, subject, html, text
    )

    return PasswordChangeResponse(
        success=True,
        message="Your password has been reset. Sign in with your new password.",
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Sign out. Always succeeds and always clears the cookie, even without a live
    session; when a session is presented its user's token version is bumped, so
    every token issued before this sign-out stops resolving server-side as well
    (a stolen cookie copy cannot outlive the logout). Other devices are signed
    out too: with stateless tokens the per-user version is the revocation unit,
    and for a signing product failing closed is the right trade.
    """
    response.delete_cookie(key=settings.SESSION_COOKIE_NAME)

    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    if not token:
        token = request.cookies.get(settings.SESSION_COOKIE_NAME)

    payload = decode_access_token(token or "")
    if payload and payload.get("purpose") in (None, "session"):
        user = (await db.execute(
            select(User).where(User.id == payload.get("sub"))
        )).scalar_one_or_none()
        if user is not None:
            user.token_version = (user.token_version or 0) + 1
            await audit_chain.safe_append(
                db, event_type="logout",
                account_id=user.account_id, actor_user_id=user.id,
                actor_email=user.email,
                description="Sign-out; token version bumped",
            )
            await db.commit()

    return {"message": "Logged out successfully"}
