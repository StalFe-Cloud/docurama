"""
Cryptographic sealing and verification.

Design rule for this module: every failure path must produce a negative or unknown
result, never a positive assertion. A document that could not be sealed must not be
reported as sealed, and a document whose signature could not be validated must not be
reported as valid. Callers and the public verification portal render exactly what is
returned here, so an optimistic default here becomes a false certification downstream.
"""
import os
import hashlib
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from cryptography.hazmat.primitives.serialization import pkcs12

from app.core.config import settings

# PAdES conformance levels, weakest to strongest.
PADES_B_B = "PAdES-B-B"    # basic signature
PADES_B_T = "PAdES-B-T"    # + trusted RFC 3161 timestamp
PADES_B_LT = "PAdES-B-LT"  # + embedded revocation information (long term)
PADES_B_LTA = "PAdES-B-LTA"  # + document timestamp chain (long term archival)


def calculate_file_sha256(file_path: str) -> str:
    """Calculate SHA-256 hexadecimal digest of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()


def calculate_bytes_sha256(data: bytes) -> str:
    """Calculate SHA-256 hexadecimal digest of bytes in memory."""
    return hashlib.sha256(data).hexdigest()


def load_docurama_p12():
    """
    Load the Docurama PKCS#12 document signing certificate and private key.
    Returns (key, cert, additional_certs); all None when the certificate is absent
    or unreadable.
    """
    p12_path = settings.P12_PATH
    p12_password = settings.P12_PASSWORD.encode("utf-8") if settings.P12_PASSWORD else None

    if not os.path.exists(p12_path):
        return None, None, []

    try:
        with open(p12_path, "rb") as f:
            p12_data = f.read()
        return pkcs12.load_key_and_certificates(p12_data, p12_password)
    except Exception as e:
        print(f"[CryptoEngine] Failed to load P12 at {p12_path}: {e}")
        return None, None, []


# Retained for backwards compatibility with the previous mixed-case name.
load_Docurama_p12 = load_docurama_p12


def _build_validation_context():
    """
    Build a validation context that can validate both our own signer and the
    timestamp authority's certificate.

    extra_trust_roots, not trust_roots: the Docurama root is *added* to the default
    trust store rather than replacing it. Replacing it makes the public TSA chain
    unvalidatable (DigiCert's responder chains to a public root, not to ours), which
    fails the whole seal when revocation information is being embedded.

    Returns None when our root CA is unavailable, in which case only B-T is possible.
    """
    root_path = settings.ROOT_CA_PATH
    if not root_path or not os.path.exists(root_path):
        return None
    try:
        from pyhanko.keys import load_certs_from_pemder
        from pyhanko_certvalidator import ValidationContext

        roots = list(load_certs_from_pemder([root_path]))
        if not roots:
            return None
        return ValidationContext(extra_trust_roots=roots, allow_fetching=True)
    except Exception as e:
        print(f"[CryptoEngine] Validation context unavailable: {e}")
        return None


def sign_pdf_with_pades(
    input_pdf_path: str,
    output_pdf_path: str,
    reason: str = "Document Sealed and Certified by Docurama",
    location: str = "Docurama Trust Engine (FR)",
    contact_info: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Seal a PDF with a PAdES digital signature.

    On success returns sealed=True together with the conformance level that was
    actually achieved, established by re-reading the written file rather than by
    assuming the level the signing parameters requested.

    On failure the input is still copied to output_pdf_path so the completed document
    remains downloadable, but sealed=False and an error are returned. Callers must
    persist that state; the document is a plain PDF with no cryptographic standing.
    """
    contact_info = contact_info or settings.SIGNING_CONTACT_EMAIL

    key, cert, _add_certs = load_docurama_p12()
    subject_str = cert.subject.rfc4514_string() if cert else None
    issuer_str = cert.issuer.rfc4514_string() if cert else None

    def _unsealed(error: str) -> Dict[str, Any]:
        import shutil
        shutil.copy2(input_pdf_path, output_pdf_path)
        return {
            "success": False,
            "sealed": False,
            "signed_path": output_pdf_path,
            "sha256": calculate_file_sha256(output_pdf_path),
            "subject": subject_str,
            "issuer": issuer_str,
            "pades_level": None,
            "timestamp_server": None,
            "error": error,
        }

    if not os.path.exists(settings.P12_PATH):
        return _unsealed(
            f"Signing certificate not found at {settings.P12_PATH}. "
            "The document was stored without a cryptographic seal."
        )

    try:
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        from pyhanko.sign import signers, timestamps

        # The PAdES subfilter enum lives in pyhanko.sign.fields as SigSeedSubFilter.
        # Older releases also re-exported it as signers.SigSubFilter; accept either so
        # the seal does not break silently on a version bump.
        try:
            from pyhanko.sign.fields import SigSeedSubFilter as _SubFilter
        except ImportError:
            _SubFilter = signers.SigSubFilter

        p12_password = settings.P12_PASSWORD.encode("utf-8") if settings.P12_PASSWORD else None
        signer = signers.SimpleSigner.load_pkcs12(
            pfx_file=settings.P12_PATH,
            passphrase=p12_password,
        )
        if signer is None:
            return _unsealed("PKCS#12 certificate could not be loaded by the signing backend.")

        # An RFC 3161 timestamp is what raises a basic signature to B-T. Without a
        # reachable TSA the seal is still applied, but at a lower conformance level.
        timestamper = None
        tsa_url = settings.TSA_URL
        if tsa_url:
            try:
                timestamper = timestamps.HTTPTimeStamper(tsa_url)
            except Exception as te:
                print(f"[CryptoEngine] TSA unavailable at {tsa_url}: {te}")
                timestamper = None

        validation_context = _build_validation_context() if timestamper else None

        meta_kwargs = dict(
            field_name=f"Docurama_Seal_{int(datetime.now(timezone.utc).timestamp())}",
            reason=reason,
            location=location,
            contact_info=contact_info,
            subfilter=_SubFilter.PADES,
        )
        # Embedding revocation info and a document timestamp is what reaches LT / LTA.
        # It requires a trusted root and a working TSA; without them we sign at B-T.
        if validation_context is not None:
            meta_kwargs.update(
                validation_context=validation_context,
                embed_validation_info=True,
                use_pades_lta=True,
            )

        sig_meta = signers.PdfSignatureMetadata(**meta_kwargs)

        with open(input_pdf_path, "rb") as inf:
            w = IncrementalPdfFileWriter(inf)
            with open(output_pdf_path, "wb") as outf:
                signers.sign_pdf(w, sig_meta, signer=signer, timestamper=timestamper, output=outf)

    except Exception as e:
        return _unsealed(f"PAdES signing failed: {e}")

    if not os.path.exists(output_pdf_path):
        return _unsealed("Signing produced no output file.")

    # Report the level actually present in the written file, not the level requested.
    observed = verify_document_integrity(output_pdf_path)
    if not observed.get("has_digital_signature"):
        return _unsealed(
            "Signing completed but no signature could be read back from the output; "
            "treating the document as unsealed."
        )

    return {
        "success": True,
        "sealed": True,
        "signed_path": output_pdf_path,
        "sha256": observed.get("sha256") or calculate_file_sha256(output_pdf_path),
        "subject": observed.get("signer_subject") or subject_str,
        "issuer": observed.get("signer_issuer") or issuer_str,
        "pades_level": observed.get("pades_level"),
        "timestamp_server": tsa_url if observed.get("has_timestamp") else None,
        "timestamp_utc": observed.get("timestamp_utc"),
        "error": None,
    }


def _unverified(sha256: Optional[str], message: str, **extra) -> Dict[str, Any]:
    """A result that asserts nothing. Used for every path that could not establish validity."""
    result = {
        "is_valid": False,
        "sha256": sha256,
        "has_digital_signature": False,
        "signature_intact": False,
        "signer_subject": None,
        "signer_issuer": None,
        "has_timestamp": False,
        "timestamp_utc": None,
        "pades_level": None,
        "pades_ltv_verified": False,
        "message": message,
    }
    result.update(extra)
    return result


def verify_document_integrity(pdf_path: str) -> Dict[str, Any]:
    """
    Inspect a PDF and report what is cryptographically present.

    Returns only observed facts. A document with no embedded signature returns
    has_digital_signature=False and is_valid=False; it is never described as verified
    on the strength of merely existing.
    """
    if not pdf_path or not os.path.exists(pdf_path):
        return _unverified(None, "Document not found.")

    sha256 = calculate_file_sha256(pdf_path)

    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import validate_pdf_signature
    except Exception as e:
        return _unverified(
            sha256,
            f"Signature validation is unavailable on this deployment ({e}). "
            "The document's cryptographic state could not be established.",
        )

    try:
        with open(pdf_path, "rb") as f:
            reader = PdfFileReader(f)
            # Regular signatures only. The general embedded_signatures collection also
            # contains /DocTimeStamp entries, so on an LTA-sealed document the first
            # element can be a document timestamp rather than the signature itself.
            embedded = list(_regular_signatures(reader))

            if not embedded:
                return _unverified(
                    sha256,
                    "This document carries no embedded digital signature.",
                )

            sig_field = embedded[0]
            validation_context = _build_validation_context()
            status = validate_pdf_signature(sig_field, signer_validation_context=validation_context)

            intact = bool(getattr(status, "intact", False))
            valid = bool(getattr(status, "valid", False))
            trusted = bool(getattr(status, "trusted", False))

            signing_cert = getattr(status, "signing_cert", None)
            subject = None
            issuer = None
            if signing_cert is not None:
                subject = getattr(getattr(signing_cert, "subject", None), "human_friendly", None) or str(
                    getattr(signing_cert, "subject", "")
                ) or None
                issuer = getattr(getattr(signing_cert, "issuer", None), "human_friendly", None) or str(
                    getattr(signing_cert, "issuer", "")
                ) or None

            # Timestamp: present only when a timestamp token validated.
            ts_status = getattr(status, "timestamp_validity", None)
            has_timestamp = bool(ts_status and getattr(ts_status, "intact", False))
            timestamp_utc = None
            if has_timestamp:
                ts_time = getattr(ts_status, "timestamp", None)
                if ts_time is not None:
                    timestamp_utc = ts_time.astimezone(timezone.utc).isoformat()

            ltv_verified, pades_level = _assess_ltv(reader, has_timestamp, intact and valid)

            if intact and valid and trusted:
                message = "Cryptographic signature is valid and the document has not been altered."
            elif intact and valid:
                message = (
                    "The signature is intact and the document has not been altered, but the "
                    "signing certificate could not be chained to a trusted root on this deployment."
                )
            elif intact:
                message = "The document content is unchanged, but the signature itself did not validate."
            else:
                message = "The document has been altered since it was signed."

            return {
                "is_valid": intact and valid,
                "sha256": sha256,
                "has_digital_signature": True,
                "signature_intact": intact,
                "signature_trusted": trusted,
                "signer_subject": subject,
                "signer_issuer": issuer,
                "has_timestamp": has_timestamp,
                "timestamp_utc": timestamp_utc,
                "pades_level": pades_level,
                "pades_ltv_verified": ltv_verified,
                "message": message,
            }

    except Exception as e:
        return _unverified(
            sha256,
            f"The document could not be parsed for verification ({e}).",
        )


def _regular_signatures(reader):
    """
    Return the document's actual signatures, excluding /DocTimeStamp entries.

    reader.embedded_signatures mixes both, so indexing into it can hand back a
    document timestamp instead of the signature on an LTA-sealed file.
    """
    regular = getattr(reader, "embedded_regular_signatures", None)
    if regular is not None:
        return list(regular)
    return list(getattr(reader, "embedded_signatures", []) or [])


def _has_document_timestamp(reader) -> bool:
    """A /DocTimeStamp covering the DSS is what separates B-LTA from B-LT."""
    try:
        return bool(list(getattr(reader, "embedded_timestamp_signatures", []) or []))
    except Exception:
        return False


def _dss_carries_revocation_info(reader) -> bool:
    """
    Report whether a Document Security Store with revocation material is embedded.

    That store is what makes a signature verifiable after its certificate expires,
    and is the structural difference between B-T and B-LT.
    """
    try:
        from pyhanko.sign.validation.dss import DocumentSecurityStore, NoDSSFoundError
    except Exception as e:
        print(f"[CryptoEngine] DSS inspection unavailable: {e}")
        return False

    try:
        dss = DocumentSecurityStore.read_dss(reader)
    except NoDSSFoundError:
        return False
    except Exception as e:
        print(f"[CryptoEngine] DSS could not be read: {e}")
        return False

    # A DSS that holds no validation material of any kind does not confer LT.
    for attr in ("certs", "ocsps", "crls"):
        try:
            if list(getattr(dss, attr, []) or []):
                return True
        except Exception:
            continue
    return False


def _assess_ltv(reader, has_timestamp: bool, signature_ok: bool) -> tuple:
    """
    Determine the PAdES conformance level actually present, from the document's
    own structure.

    Returns (ltv_verified, level). The ladder is cumulative: LT requires a trusted
    timestamp plus embedded revocation information, and LTA additionally requires a
    document timestamp over that store. Anything that cannot be established reports
    False, never an assumed True.

    signature_ok gates the LTV claim. Long-term validation describes how durably a
    *valid* signature can be re-verified in future; the supporting structures survive
    in an altered file, so reporting them as LTV-verified would dress up a document
    that failed its integrity check.
    """
    if not has_timestamp:
        # Without a validated timestamp there is no basis for any long-term claim.
        return False, PADES_B_B

    if not _dss_carries_revocation_info(reader):
        return False, PADES_B_T

    # The structural level is still reported, because it is a true observation and
    # useful when diagnosing a failure.
    level = PADES_B_LTA if _has_document_timestamp(reader) else PADES_B_LT
    return bool(signature_ok), level
