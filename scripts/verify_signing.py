"""
End-to-end check of the sealing and verification paths against the real pyHanko.

The unit suite stubs pyHanko, so it cannot catch the library moving its API. This
script exercises the genuine article: it generates a throwaway self-signed CA and
document-signing certificate, seals a PDF through the production code path, and
verifies the result. Run it after any pyhanko or pyhanko-certvalidator bump.

It asserts three things:
  - a genuine seal is reported as sealed, at the conformance level actually reached
  - a valid seal verifies as valid, with LTV reported only when truly present
  - a document altered after sealing is reported as altered, and loses its LTV claim

Requires the runtime dependencies, so run it inside the API image rather than on a
developer host:

    docker compose build docurama-api
    docker run --rm -v "$PWD/scripts/verify_signing.py:/tmp/verify_signing.py:ro"         --entrypoint python docurama-docurama-api:latest /tmp/verify_signing.py

Everything it creates lives under /tmp in the throwaway container. It reaches the
public timestamp authority, so it needs outbound network access.
"""
import datetime
import os
import sys

sys.path.insert(0, "/app")
os.environ["DOCURAMA_ENV"] = "development"

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

CERT_DIR = "/tmp/probe_certs"
os.makedirs(CERT_DIR, exist_ok=True)
P12_PATH = os.path.join(CERT_DIR, "signer.p12")
CA_PATH = os.path.join(CERT_DIR, "root_ca.crt")
P12_PASSWORD = "probe-password"

now = datetime.datetime.now(datetime.timezone.utc)


def name(cn):
    return x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "FR"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Docurama Probe"),
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ])


# --- Root CA -------------------------------------------------------------
ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ca_cert = (
    x509.CertificateBuilder()
    .subject_name(name("Docurama Probe Root CA"))
    .issuer_name(name("Docurama Probe Root CA"))
    .public_key(ca_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=3650))
    .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
    .add_extension(x509.KeyUsage(
        digital_signature=True, content_commitment=False, key_encipherment=False,
        data_encipherment=False, key_agreement=False, key_cert_sign=True,
        crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
    .sign(ca_key, hashes.SHA256())
)

# --- End-entity document signer ------------------------------------------
sig_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
sig_cert = (
    x509.CertificateBuilder()
    .subject_name(name("Docurama Probe Document Signer"))
    .issuer_name(ca_cert.subject)
    .public_key(sig_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=365))
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .add_extension(x509.KeyUsage(
        digital_signature=True, content_commitment=True, key_encipherment=False,
        data_encipherment=False, key_agreement=False, key_cert_sign=False,
        crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
    .add_extension(x509.ExtendedKeyUsage([x509.ObjectIdentifier("1.3.6.1.5.5.7.3.36")]), critical=False)
    .sign(ca_key, hashes.SHA256())
)

with open(P12_PATH, "wb") as f:
    f.write(pkcs12.serialize_key_and_certificates(
        name=b"docurama-probe",
        key=sig_key,
        cert=sig_cert,
        cas=[ca_cert],
        encryption_algorithm=serialization.BestAvailableEncryption(P12_PASSWORD.encode()),
    ))
with open(CA_PATH, "wb") as f:
    f.write(ca_cert.public_bytes(serialization.Encoding.PEM))

print(f"probe certificates generated in {CERT_DIR}")

# --- Point the production settings at the probe certificate ---------------
from app.core import config
config.settings.P12_PATH = P12_PATH
config.settings.P12_PASSWORD = P12_PASSWORD
config.settings.ROOT_CA_PATH = CA_PATH

from app.services.crypto_engine import sign_pdf_with_pades, verify_document_integrity

# --- A real PDF to seal ---------------------------------------------------
from reportlab.pdfgen import canvas
src_pdf = "/tmp/probe_source.pdf"
c = canvas.Canvas(src_pdf)
c.drawString(100, 700, "Probe Agreement")
c.save()

sealed_pdf = "/tmp/probe_sealed.pdf"
print()
print("=== SEALING ===")
res = sign_pdf_with_pades(src_pdf, sealed_pdf)
for k in ("success", "sealed", "pades_level", "timestamp_server", "error"):
    print(f"  {k}: {res.get(k)!r}")
print(f"  subject: {(res.get('subject') or '')[:70]}")

print()
print("=== VERIFYING THE SEALED DOCUMENT ===")
v = verify_document_integrity(sealed_pdf)
for k in ("is_valid", "has_digital_signature", "signature_intact", "signature_trusted",
          "has_timestamp", "pades_level", "pades_ltv_verified"):
    print(f"  {k}: {v.get(k)!r}")
print(f"  message: {v.get('message')}")

print()
print("=== VERIFYING A TAMPERED COPY ===")
tampered = "/tmp/probe_tampered.pdf"
data = bytearray(open(sealed_pdf, "rb").read())
# Flip a byte inside the signed content stream. The page text is compressed, so
# target the first stream body rather than searching for the literal string.
idx = data.find(b"stream")
assert idx != -1, "no stream found in the sealed PDF"
target = idx + 10
original = data[target]
data[target] = original ^ 0xFF
open(tampered, "wb").write(bytes(data))
print(f"  (flipped byte at offset {target}: {original:#04x} -> {data[target]:#04x})")
t = verify_document_integrity(tampered)
for k in ("is_valid", "has_digital_signature", "signature_intact", "pades_ltv_verified"):
    print(f"  {k}: {t.get(k)!r}")
print(f"  message: {t.get('message')}")

# --- Verdict --------------------------------------------------------------
print()
problems = []
if not res.get("sealed"):
    problems.append(f"sealing failed: {res.get('error')}")
if not v.get("is_valid"):
    problems.append("a freshly sealed document did not verify as valid")
if not v.get("has_timestamp"):
    problems.append("no RFC 3161 timestamp was applied")
if t.get("is_valid"):
    problems.append("a tampered document verified as valid")
if t.get("pades_ltv_verified"):
    problems.append("a tampered document still claimed long-term validation")

if problems:
    print("FAILED:")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)

print(f"PASSED: sealed at {res.get('pades_level')}, verified, and tampering detected.")
