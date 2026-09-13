"""
Issue a Docurama document-signing certificate under a private root CA.

This is the supported form of the method that produced the existing StalFe signing
material. It builds a two-tier chain:

  Root CA          BasicConstraints(ca=True, pathlen=1), keyCertSign + cRLSign
  Document signer  BasicConstraints(ca=False),
                   KeyUsage: digitalSignature + contentCommitment (non-repudiation),
                   ExtendedKeyUsage: id-kp-documentSigning (1.3.6.1.5.5.7.3.36, RFC 9336)

contentCommitment and id-kp-documentSigning are what make the certificate a *document*
signing certificate rather than a general TLS one. A TLS certificate has the wrong key
usage and validators are entitled to reject it, which is why stalfe_cert.pem (a
Cloudflare Origin certificate, EKU serverAuth) cannot be used for sealing.

Trust model: a private root is cryptographically genuine, but Adobe Reader shows
"signature validity unknown" until the verifier installs the root. Docurama's own
verification portal is the trust anchor for counterparties. To have signatures validate
in Adobe out of the box you need a certificate from an AATL or EUTL member CA
(GlobalSign, DigiCert, Entrust); that is a drop-in replacement here, requiring only
DOCURAMA_P12_PATH, DOCURAMA_P12_PASSWORD and DOCURAMA_ROOT_CA_PATH to be repointed.

Usage:
    python scripts/issue_signing_cert.py --org "StalFe Technologies" --country FR \\
        --ca-cn "StalFe Root Certification Authority" \\
        --signer-cn "StalFe Document Signing Certificate" \\
        --out backend/certs

    # Reuse an existing root instead of minting a new one:
    python scripts/issue_signing_cert.py --ca-key ca.key --ca-cert stalfe_root_ca.crt ...

The .p12 password is read from DOCURAMA_P12_PASSWORD, --password, or an interactive
prompt. It is never written to disk or echoed.
"""
import argparse
import datetime
import getpass
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

# RFC 9336. Marks the key as intended for signing documents, as distinct from TLS.
ID_KP_DOCUMENT_SIGNING = x509.ObjectIdentifier("1.3.6.1.5.5.7.3.36")


def build_name(country: str, org: str, common_name: str) -> x509.Name:
    return x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, country),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
    ])


def make_root_ca(subject: x509.Name, key_size: int, years: int):
    """Mint a self-signed root capable of issuing and revoking end-entity certificates."""
    now = datetime.datetime.now(datetime.timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * years))
        .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


def make_document_signer(subject: x509.Name, ca_key, ca_cert, key_size: int, years: int):
    """Mint the end-entity certificate that actually seals documents."""
    now = datetime.datetime.now(datetime.timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * years))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        # contentCommitment is the non-repudiation bit: this key signs statements the
        # signer is meant to be bound by, which is exactly a signed agreement.
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=True, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ID_KP_DOCUMENT_SIGNING]), critical=False)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return key, cert


def load_existing_ca(key_path: str, cert_path: str, key_password: bytes):
    with open(key_path, "rb") as f:
        ca_key = serialization.load_pem_private_key(f.read(), password=key_password)
    with open(cert_path, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())
    return ca_key, ca_cert


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Issue a Docurama document-signing certificate under a private root CA."
    )
    parser.add_argument("--org", default="StalFe Technologies")
    parser.add_argument("--country", default="FR")
    parser.add_argument("--ca-cn", default="StalFe Root Certification Authority")
    parser.add_argument("--signer-cn", default="StalFe Document Signing Certificate")
    parser.add_argument("--out", default="backend/certs", help="Output directory.")
    parser.add_argument("--p12-name", default="docurama_document_signing_cert.p12")
    parser.add_argument("--ca-name", default="docurama_root_ca.crt")
    parser.add_argument("--key-size", type=int, default=3072)
    parser.add_argument("--ca-years", type=int, default=25)
    parser.add_argument("--signer-years", type=int, default=3)
    parser.add_argument("--password", help="Prefer DOCURAMA_P12_PASSWORD or the prompt.")
    parser.add_argument("--ca-key", help="Reuse an existing CA private key (PEM).")
    parser.add_argument("--ca-cert", help="Reuse an existing CA certificate (PEM).")
    parser.add_argument("--ca-key-password", help="Password for --ca-key, if encrypted.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output.")
    args = parser.parse_args()

    password = args.password or os.getenv("DOCURAMA_P12_PASSWORD")
    if not password:
        password = getpass.getpass("Password to protect the .p12: ")
        if password != getpass.getpass("Confirm: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
    if len(password) < 12:
        print("Refusing to protect a signing key with fewer than 12 characters.", file=sys.stderr)
        return 1

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    p12_path = os.path.join(out_dir, args.p12_name)
    ca_path = os.path.join(out_dir, args.ca_name)

    for path in (p12_path, ca_path):
        if os.path.exists(path) and not args.force:
            print(
                f"{path} already exists. Refusing to overwrite signing material without "
                "--force; a lost signing key cannot be recovered and every document "
                "sealed with it becomes unverifiable against a new one.",
                file=sys.stderr,
            )
            return 1

    if args.ca_key and args.ca_cert:
        ca_key_pw = args.ca_key_password.encode() if args.ca_key_password else None
        ca_key, ca_cert = load_existing_ca(args.ca_key, args.ca_cert, ca_key_pw)
        print(f"Reusing root CA: {ca_cert.subject.rfc4514_string()}")
    elif args.ca_key or args.ca_cert:
        print("--ca-key and --ca-cert must be given together.", file=sys.stderr)
        return 1
    else:
        ca_subject = build_name(args.country, args.org, args.ca_cn)
        ca_key, ca_cert = make_root_ca(ca_subject, args.key_size, args.ca_years)
        print(f"Issued root CA: {ca_cert.subject.rfc4514_string()}")
        # The CA key is written beside the output so the root can issue replacement
        # signers later. It is the most sensitive artefact here.
        ca_key_path = os.path.join(out_dir, "root_ca.key")
        with open(ca_key_path, "wb") as f:
            f.write(ca_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.BestAvailableEncryption(password.encode()),
            ))
        os.chmod(ca_key_path, 0o600)
        print(f"  CA private key: {ca_key_path} (encrypted, keep offline)")

    signer_subject = build_name(args.country, args.org, args.signer_cn)
    sig_key, sig_cert = make_document_signer(
        signer_subject, ca_key, ca_cert, args.key_size, args.signer_years
    )
    print(f"Issued document signer: {sig_cert.subject.rfc4514_string()}")

    with open(p12_path, "wb") as f:
        f.write(pkcs12.serialize_key_and_certificates(
            name=args.signer_cn.encode(),
            key=sig_key,
            cert=sig_cert,
            cas=[ca_cert],
            encryption_algorithm=serialization.BestAvailableEncryption(password.encode()),
        ))
    os.chmod(p12_path, 0o600)

    with open(ca_path, "wb") as f:
        f.write(ca_cert.public_bytes(serialization.Encoding.PEM))

    print()
    print(f"  {p12_path}")
    print(f"  {ca_path}")
    print()
    print(f"Signer valid until: {sig_cert.not_valid_after_utc.date()}")
    print(f"Root valid until:   {ca_cert.not_valid_after_utc.date()}")
    print()
    print("Point the application at it:")
    print(f"  DOCURAMA_P12_PATH={p12_path}")
    print(f"  DOCURAMA_ROOT_CA_PATH={ca_path}")
    print("  DOCURAMA_P12_PASSWORD=<the password you just set>")
    print()
    print("Inspect:")
    print(f"  openssl pkcs12 -in {args.p12_name} -nokeys -info")
    print(f"  openssl x509 -in {args.ca_name} -noout -subject -dates")
    print()
    print("Then prove it actually seals, against the real pyHanko:")
    print("  docker compose build docurama-api")
    print("  docker run --rm -v \"$PWD/scripts/verify_signing.py:/tmp/v.py:ro\" \\")
    print("    --entrypoint python docurama-docurama-api:latest /tmp/v.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
