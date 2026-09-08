import pytest
from conftest import requires_argon2
from app.core.security import get_password_hash, verify_password, create_access_token, decode_access_token, generate_secure_token
from app.services.crypto_engine import calculate_bytes_sha256
from app.services.qr_generator import generate_qr_base64

@requires_argon2
def test_password_hashing():
    pwd = "DocuramaStrongPassword2026!"
    hashed = get_password_hash(pwd)
    assert verify_password(pwd, hashed) is True
    assert verify_password("wrong", hashed) is False

def test_jwt_tokens():
    token = create_access_token("user-123", claims={"role": "admin"})
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "user-123"
    assert payload["role"] == "admin"

def test_secure_tokens():
    t1 = generate_secure_token(32)
    t2 = generate_secure_token(32)
    assert len(t1) > 30
    assert t1 != t2

def test_sha256_calculation():
    data = b"Docurama Verified Electronic Signature"
    sha = calculate_bytes_sha256(data)
    assert len(sha) == 64
    assert isinstance(sha, str)

def test_qr_generation():
    qr_b64 = generate_qr_base64("https://docurama.example.com/verify?code=TEST1234")
    assert qr_b64.startswith("data:image/png;base64,")
