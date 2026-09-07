import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "Docurama"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api"
    
    # Server URLs
    APP_URL: str = os.getenv("DOCURAMA_APP_URL", "https://docurama.stalfe.com")
    ALLOWED_ORIGINS: List[str] = [
        "https://docurama.stalfe.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
    ]
    
    # Security & Sessions
    SECRET_KEY: str = os.getenv("DOCURAMA_SECRET_KEY", "stalfe-docurama-super-secret-production-key-2026-crypto")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    SESSION_COOKIE_NAME: str = "_docurama_session"
    
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
    
    # StalFe Cryptographic Signing & PKCS#12
    CERT_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "certs")
    P12_PATH: str = os.getenv("DOCURAMA_P12_PATH", os.path.join(CERT_DIR, "stalfe_document_signing_cert.p12"))
    P12_PASSWORD: str = os.getenv("DOCURAMA_P12_PASSWORD", "stalfe28e82772b8bd")
    ROOT_CA_PATH: str = os.getenv("DOCURAMA_ROOT_CA_PATH", os.path.join(CERT_DIR, "stalfe_root_ca.crt"))
    
    # RFC 3161 Timestamp Authority (TSA)
    TSA_URL: str = os.getenv("DOCURAMA_TSA_URL", "http://timestamp.digicert.com")
    
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

settings = Settings()
