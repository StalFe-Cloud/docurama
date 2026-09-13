"""
Deliverability signals for a sending domain.

Answers the question a sender can act on: which of SPF, DMARC, and MX exist for
this domain, in plain language. Honest by design: a missing record is reported
as missing, never guessed.
"""
import re
from typing import Optional
from urllib.parse import urlparse

import httpx

DOH_ENDPOINTS = ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")


def sanitize_domain(value: str) -> str:
    cleaned = (value or "").strip().lower()
    cleaned = cleaned.replace("https://", "").replace("http://", "")
    try:
        cleaned = urlparse(f"https://{cleaned}").hostname or ""
    except ValueError:
        return ""
    return cleaned.split("/")[0]


async def _dns_query(name: str, qtype: str) -> Optional[list]:
    """None means both DoH endpoints failed; [] means the query answered with no records."""
    for endpoint in DOH_ENDPOINTS:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    endpoint,
                    params={"name": name, "type": qtype},
                    headers={"accept": "application/dns-json"},
                )
                resp.raise_for_status()
                return resp.json().get("Answer") or []
        except Exception:
            continue
    return None


async def _txt_records(name: str) -> Optional[list]:
    answers = await _dns_query(name, "TXT")
    if answers is None:
        return None
    return [str(a.get("data", "")).strip('"') for a in answers]


async def _has_mx(domain: str) -> Optional[bool]:
    answers = await _dns_query(domain, "MX")
    if answers is None:
        return None
    return bool(answers)


def _dmarc_policy(records: list) -> str:
    for record in records:
        match = re.search(r"\bp=([a-z]+)\b", record, re.IGNORECASE)
        if match:
            return match.group(1).lower()
    return ""


async def check_domain(domain: str) -> dict:
    domain = sanitize_domain(domain)
    findings = []

    txt = await _txt_records(domain)
    dmarc_records = await _txt_records(f"_dmarc.{domain}")
    mx_present = await _has_mx(domain)

    # A None result means the lookup itself failed, which is unknown, not absent.
    lookup_failed = txt is None or dmarc_records is None or mx_present is None
    if lookup_failed:
        findings.append(
            "DNS lookup failed; cannot confirm records for this domain right now. Try again shortly."
        )

    spf_records = [] if txt is None else [r for r in txt if r.lower().startswith("v=spf1")]
    spf_present = bool(spf_records)
    dmarc_present = bool(dmarc_records) if dmarc_records is not None else False
    policy = _dmarc_policy(dmarc_records) if dmarc_records is not None else ""

    if txt is not None:
        if not spf_present:
            findings.append("SPF: no record found. Without SPF, receivers cannot identify your legitimate mail servers, so mail is often rejected or spammed.")
        else:
            findings.append("SPF: found.")
    if dmarc_records is not None:
        if not dmarc_present:
            findings.append("DMARC: no record found at _dmarc." + domain + ". Add one so receivers know what to do with unauthenticated mail.")
        elif not policy:
            findings.append("DMARC: record exists but has no policy (p=) tag, so receivers take no action.")
        else:
            findings.append(f"DMARC: found with policy {policy}.")
    if mx_present is not None:
        if not mx_present:
            findings.append("MX: no mail servers found for this domain. Sending domains usually need one.")
        else:
            findings.append("MX: found.")

    return {
        "domain": domain,
        "spf": {"present": spf_present, "record": spf_records[0] if spf_records else None},
        "dmarc": {"present": dmarc_present, "record": dmarc_records[0] if dmarc_records else None, "policy": policy or None},
        "mx_present": bool(mx_present),
        "findings": findings,
        "ok": not lookup_failed and spf_present and dmarc_present and bool(mx_present),
    }
