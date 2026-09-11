import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

# Sentinel values that ship with the repository. They are usable for local development
# only; the production guard below refuses to start when any of them survives into a
# deployed environment.
DEV_SECRET_KEY = "docurama-development-secret-key-not-for-production"
DEV_P12_PASSWORD = "docurama_dev_cert_pass"

# Values that have shipped inside repository files. A secret that was ever printed
# in a compose file or README is public knowledge, so production refuses each of
# them exactly like the development default.
KNOWN_WEAK_SECRET_KEYS = {
    "docurama-production-secret-key-2026-crypto",
}


class Settings(BaseSettings):
    PROJECT_NAME: str = "Docurama"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api"

    # Deployment environment. Anything other than "development" enables production guards.
    ENV: str = os.getenv("DOCURAMA_ENV", "production")

    # Deployment mode. selfhost: one operator, registration closed unless opened
    # deliberately. cloud: the public multi-tenant platform, registration open.
    DEPLOYMENT_MODE: str = os.getenv("DOCURAMA_DEPLOYMENT_MODE", "selfhost")

    # Cloud platform domain. Tenant subdomains live under it (acme.docurama.eu).
    CLOUD_DOMAIN: str = os.getenv("DOCURAMA_CLOUD_DOMAIN", "docurama.eu")

    # Server URLs
    APP_URL: str = os.getenv("DOCURAMA_APP_URL", "https://docurama.example.com")
    ALLOWED_ORIGINS: List[str] = [
        "https://docurama.example.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
    ]

    # Security & Sessions
    SECRET_KEY: str = os.getenv("DOCURAMA_SECRET_KEY", DEV_SECRET_KEY)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    SESSION_COOKIE_NAME: str = "_docurama_session"
    # Secure cookies are required in production but prevent sign-in over plain http,
    # so local development can opt out.
    COOKIE_SECURE: bool = os.getenv("DOCURAMA_COOKIE_SECURE", "true").lower() not in ("false", "0", "no")

    # Signing links expire so that an unused invitation cannot be redeemed indefinitely.
    SIGNING_TOKEN_EXPIRE_DAYS: int = int(os.getenv("DOCURAMA_SIGNING_TOKEN_EXPIRE_DAYS", "90"))

    # Database (PostgreSQL)
    DATABASE_URL: str = os.getenv(
        "DOCURAMA_DATABASE_URL",
        os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/docurama")
    )
    # Synchronous DB URL for Alembic migrations or PyHanko file ops if needed
    SYNC_DATABASE_URL: str = os.getenv(
        "DOCURAMA_SYNC_DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/docurama"
    )

    # Storage Paths
    STORAGE_DIR: str = os.getenv("DOCURAMA_STORAGE_DIR", "/opt/docurama/storage" if os.name != "nt" else "docurama_storage")

    # Docurama Cryptographic Signing & PKCS#12
    CERT_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "certs")
    P12_PATH: str = os.getenv("DOCURAMA_P12_PATH", os.path.join(CERT_DIR, "docurama_document_signing_cert.p12"))
    P12_PASSWORD: str = os.getenv("DOCURAMA_P12_PASSWORD", DEV_P12_PASSWORD)
    ROOT_CA_PATH: str = os.getenv("DOCURAMA_ROOT_CA_PATH", os.path.join(CERT_DIR, "docurama_root_ca.crt"))

    # RFC 3161 Timestamp Authority (TSA)
    TSA_URL: str = os.getenv("DOCURAMA_TSA_URL", "http://timestamp.digicert.com")

    # Host that customers point their CNAME at when proving domain ownership. Shipping a
    # placeholder here makes DNS domain verification unusable, because the instructions
    # tell the customer to delegate to a host that does not exist.
    CNAME_TARGET: str = os.getenv("DOCURAMA_CNAME_TARGET", "")

    # Identity embedded in signatures and system-generated audit events.
    SIGNING_CONTACT_EMAIL: str = os.getenv("DOCURAMA_SIGNING_CONTACT_EMAIL", "")
    SYSTEM_ACTOR_EMAIL: str = os.getenv("DOCURAMA_SYSTEM_ACTOR_EMAIL", "")

    # Outbound email is configured in the product, not here: per company under
    # Settings, with a platform-wide default for companies that have not set their
    # own. See services/smtp_config. A mail server belongs to whoever sends the mail,
    # and a tenant cannot edit the deployment environment.

    # Automatic reminder sweep for envelopes awaiting signature.
    REMINDERS_ENABLED: bool = os.getenv("DOCURAMA_REMINDERS_ENABLED", "true").lower() not in ("false", "0", "no")
    REMINDER_SWEEP_INTERVAL_MINUTES: int = int(os.getenv("DOCURAMA_REMINDER_SWEEP_MINUTES", "60"))
    REMINDER_INTERVAL_DAYS: int = int(os.getenv("DOCURAMA_REMINDER_INTERVAL_DAYS", "3"))
    REMINDER_MAX_COUNT: int = int(os.getenv("DOCURAMA_REMINDER_MAX_COUNT", "3"))

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    @property
    def is_development(self) -> bool:
        return self.ENV.strip().lower() in ("development", "dev", "local", "test")

    @property
    def registration_open(self) -> bool:
        if self.DEPLOYMENT_MODE.strip().lower() == "cloud":
            return True
        return os.getenv("DOCURAMA_PUBLIC_REGISTRATION", "false").strip().lower() in (
            "1", "true", "yes", "on",
        )


def _validate_production_secrets(cfg: "Settings") -> None:
    """
    Refuse to boot a production deployment that is still using repository defaults.
    A shipped secret is not a secret, and a JWT signed with a published key is forgeable
    by anyone who has read the source.
    """
    if cfg.is_development:
        return

    problems = []
    if cfg.SECRET_KEY == DEV_SECRET_KEY:
        problems.append("DOCURAMA_SECRET_KEY is still the built-in development value")
    if cfg.SECRET_KEY in KNOWN_WEAK_SECRET_KEYS:
        problems.append("DOCURAMA_SECRET_KEY is a value shipped with the repository; generate a fresh one")
    if len(cfg.SECRET_KEY) < 32:
        problems.append("DOCURAMA_SECRET_KEY must be at least 32 characters")
    if cfg.P12_PASSWORD == DEV_P12_PASSWORD:
        problems.append("DOCURAMA_P12_PASSWORD is still the built-in development value")
    # CNAME_TARGET, the signature contact and the audit actor are all derived from
    # APP_URL, so a placeholder here propagates into customer DNS instructions, into
    # every signature, and onto every certificate.
    if "example.com" in cfg.APP_URL:
        problems.append(
            f"DOCURAMA_APP_URL is still a placeholder ({cfg.APP_URL}); set the real public URL"
        )

    if problems:
        raise RuntimeError(
            "Refusing to start Docurama with insecure configuration:\n  - "
            + "\n  - ".join(problems)
            + "\n\nSet these in your .env file (see .env.example), or set DOCURAMA_ENV=development "
              "to run locally with the defaults.\n"
              "Generate a key with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )


def _derive_host_defaults(cfg: "Settings") -> None:
    """
    Fill host-derived identity values from APP_URL when they are not set explicitly, so a
    correct APP_URL is enough to configure a deployment and no example.com literal can
    reach a customer-facing instruction, signature or audit event.
    """
    from urllib.parse import urlparse

    host = (urlparse(cfg.APP_URL).hostname or "").strip()

    # A trailing dot (DNS root notation, e.g. "docurama.eu." typed by an operator)
    # would silently break the cloud CORS regex and host parsing, so strip it here
    # alongside the other normalized host-derived values.
    cfg.CLOUD_DOMAIN = cfg.CLOUD_DOMAIN.strip().rstrip(".")

    if not cfg.CNAME_TARGET:
        cfg.CNAME_TARGET = host
    if not cfg.SIGNING_CONTACT_EMAIL:
        cfg.SIGNING_CONTACT_EMAIL = f"legal@{host}" if host else ""
    if not cfg.SYSTEM_ACTOR_EMAIL:
        cfg.SYSTEM_ACTOR_EMAIL = f"system@{host}" if host else "system"


settings = Settings()
_derive_host_defaults(settings)
_validate_production_secrets(settings)
