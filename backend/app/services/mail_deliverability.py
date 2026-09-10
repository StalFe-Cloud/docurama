"""
Deliverability signals for a sending domain.

Answers the question a sender can act on: which of SPF, DMARC, and MX exist for
this domain, in plain language. Honest by design: a missing record is reported
as missing, never guessed.
"""
import re
from urllib.parse import urlparse

import httpx

DOH_ENDPOINTS = ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")


def sanitize_domain(value: str) -> str:
    cleaned = (value or "").strip().lower()
    cleaned = cleaned.replace("https://", "").replace("http://", "")
    cleaned = urlparse(f"https://{cleaned}").hostname or ""
    return cleaned.split("/")[0]


async def _dns_query(name: str, qtype: str) -> list:
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
    return []


async def _txt_records(name: str) -> list:
    return [str(a.get("data", "")).strip('"') for a in await _dns_query(name, "TXT")]


async def _has_mx(domain: str) -> bool:
    return bool(await _dns_query(domain, "MX"))


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
    spf_records = [r for r in txt if r.lower().startswith("v=spf1")]
    spf_present = bool(spf_records)

    dmarc_records = await _txt_records(f"_dmarc.{domain}")
    dmarc_present = bool(dmarc_records)
    policy = _dmarc_policy(dmarc_records)

    mx_present = await _has_mx(domain)

    if not spf_present:
        findings.append("SPF: no record found. Without SPF, receivers cannot identify your legitimate mail servers, so mail is often rejected or spammed.")
    else:
        findings.append("SPF: found.")
    if not dmarc_present:
        findings.append("DMARC: no record found at _dmarc." + domain + ". Add one so receivers know what to do with unauthenticated mail.")
    elif not policy:
        findings.append("DMARC: record exists but has no policy (p=) tag, so receivers take no action.")
    else:
        findings.append(f"DMARC: found with policy {policy}.")
    if not mx_present:
        findings.append("MX: no mail servers found for this domain. Sending domains usually need one.")
    else:
        findings.append("MX: found.")

    return {
        "domain": domain,
        "spf": {"present": spf_present, "record": spf_records[0] if spf_records else None},
        "dmarc": {"present": dmarc_present, "record": dmarc_records[0] if dmarc_records else None, "policy": policy or None},
        "mx_present": mx_present,
        "findings": findings,
        "ok": spf_present and dmarc_present and mx_present,
    }
