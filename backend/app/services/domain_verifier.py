import os
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, Optional, List
import httpx

from app.services.webhook_dispatcher import _is_blocked_ip

logger = logging.getLogger("docurama.domain_verifier")

def utcnow():
    return datetime.now(timezone.utc)

async def doh_query(name: str, record_type: str) -> List[Dict[str, Any]]:
    """
    Query DNS over HTTPS (DoH) via Cloudflare with Google DNS fallback.
    Returns list of answer records.
    """
    endpoints = [
        f"https://cloudflare-dns.com/dns-query?name={name}&type={record_type}",
        f"https://dns.google/resolve?name={name}&type={record_type}",
    ]
    
    headers = {"Accept": "application/dns-json", "User-Agent": "Docurama-DNS-Engine/2.0"}
    
    async with httpx.AsyncClient(timeout=6.0) as client:
        for ep in endpoints:
            try:
                resp = await client.get(ep, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    answers = data.get("Answer", [])
                    if answers:
                        return answers
            except Exception as e:
                logger.debug(f"[DoH] Query {ep} error: {e}")
                continue
    return []

async def _host_is_publicly_routable(host: str) -> bool:
    """
    Resolve a host over DoH and refuse it when any answer is private or reserved.

    A verification probe follows attacker-influenced DNS (the claimant controls
    the domain), so before an HTTP fetch is made the addresses must be checked:
    otherwise 'verify my domain' doubles as a port scanner for the deployment's
    own network. Resolution happens through DoH here and the fetch pins nothing,
    so a rebinding attacker can still race it - but the trivial redirect and
    literal-IP vectors are closed, matching the webhook guard's posture.
    """
    for record_type in ("A", "AAAA"):
        for answer in await doh_query(host, record_type):
            if _is_blocked_ip(str(answer.get("data", ""))):
                return False
    return True


def _verification_http_client() -> httpx.AsyncClient:
    """
    Hardened client for all outbound verification fetches.

    TLS verification stays ON: a domain claim proven over a connection an
    on-path attacker can forge is worth nothing. Redirects are refused: a 30x
    to an internal address would otherwise relay our request (and reflect the
    status) into the private network.
    """
    return httpx.AsyncClient(timeout=5.0, follow_redirects=False)


async def verify_client_domain(
    domain: str,
    verification_token: str
) -> Tuple[bool, str, Dict[str, Any], str]:
    """
    Verify corporate client domain via DNS records and website confirmation pointing to Docurama.
    
    Methods evaluated:
    1. DNS TXT record at _docurama-challenge.<domain> or <domain> matching docurama-verification=<token>
    2. DNS Subdomain pointer: docurama.<domain> or sign.<domain> pointing to Docurama and responding with active healthcheck
    3. Website HTTP confirmation: https://<domain>/.well-known/docurama-verification or HTML meta tag
    
    Returns:
        (is_verified: bool, method_matched: str, dns_details: dict, message: str)
    """
    clean_domain = domain.strip().lower()
    dns_details: Dict[str, Any] = {
        "domain": clean_domain,
        "token_checked": verification_token,
        "checked_at": utcnow().isoformat(),
        "txt_records": [],
        "subdomain_pointers": {},
        "web_confirmation": {}
    }

    expected_txt_val = f"docurama-verification={verification_token}"
    
    # -------------------------------------------------------------
    # 1. Check DNS TXT Records
    # -------------------------------------------------------------
    challenge_host = f"_docurama-challenge.{clean_domain}"
    txt_challenge_answers = await doh_query(challenge_host, "TXT")
    txt_root_answers = await doh_query(clean_domain, "TXT")
    
    all_txt = []
    for ans in (txt_challenge_answers + txt_root_answers):
        val = ans.get("data", "").strip('"')
        all_txt.append(val)
        dns_details["txt_records"].append({
            "name": ans.get("name"),
            "data": val,
            "ttl": ans.get("TTL")
        })
        if expected_txt_val in val:
            return (
                True,
                "dns_txt",
                dns_details,
                f"DNS TXT record successfully verified at {ans.get('name')}."
            )

    # -------------------------------------------------------------
    # 2. Check Subdomain Pointer & Website Confirmation pointing to Docurama
    # -------------------------------------------------------------
    candidate_subdomains = [f"docurama.{clean_domain}", f"sign.{clean_domain}"]
    
    for sub in candidate_subdomains:
        a_records = await doh_query(sub, "A")
        cname_records = await doh_query(sub, "CNAME")
        
        dns_details["subdomain_pointers"][sub] = {
            "a_records": [r.get("data") for r in a_records],
            "cname_records": [r.get("data") for r in cname_records]
        }
        
        # If subdomain resolves, test live confirmation pointing to Docurama
        if a_records or cname_records:
            if not await _host_is_publicly_routable(sub):
                dns_details["subdomain_pointers"][sub]["healthcheck"] = "BLOCKED_PRIVATE_ADDRESS"
                continue
            try:
                async with _verification_http_client() as client:
                    health_url = f"https://{sub}/api/health"
                    resp = await client.get(health_url)
                    if resp.status_code == 200:
                        body = resp.json()
                        if body.get("service") == "docurama-backend":
                            dns_details["subdomain_pointers"][sub]["healthcheck"] = "VALID_DOCURAMA_SERVICE"
                            return (
                                True,
                                "dns_subdomain_pointer",
                                dns_details,
                                f"Active website confirmation verified: Subdomain '{sub}' points directly to Docurama engine."
                            )
            except Exception as e:
                dns_details["subdomain_pointers"][sub]["error"] = str(e)

    # -------------------------------------------------------------
    # 3. Check Website HTTP /.well-known/ Confirmation
    # -------------------------------------------------------------
    candidate_urls = [
        f"https://{clean_domain}/.well-known/docurama-verification",
        f"https://www.{clean_domain}/.well-known/docurama-verification",
        f"https://{clean_domain}/docurama-verification.txt"
    ]
    
    for url in candidate_urls:
        try:
            host = url.split("/")[2]
            if not await _host_is_publicly_routable(host):
                dns_details["web_confirmation"][url] = {"error": "blocked: private or reserved address"}
                continue
            async with _verification_http_client() as client:
                resp = await client.get(url)
                dns_details["web_confirmation"][url] = {"status_code": resp.status_code}
                # The page must carry THIS domain's token. Merely mentioning the
                # marker 'docurama-verification' proved nothing: any 200 page that
                # linked to Docurama's docs would have passed, and the marker is
                # also what the redirect-based takeover probes relied on.
                if resp.status_code == 200 and verification_token in resp.text:
                    return (
                        True,
                        "web_confirmation",
                        dns_details,
                        f"Website confirmation file verified successfully at {url}."
                    )
        except Exception as e:
            dns_details["web_confirmation"][url] = {"error": str(e)}

    # If none succeeded, return pending with guidance
    return (
        False,
        "none",
        dns_details,
        f"Verification pending: No DNS TXT record or website confirmation pointing to Docurama detected yet for {clean_domain}."
    )


def summarize_checks(domain: str, verification_token: str,
                     dns_details: Dict[str, Any], method_matched: str) -> List[Dict[str, Any]]:
    """
    Found-vs-expected for each verification path, so the UI can show what was
    looked for and what was actually there instead of a raw DNS dump.
    """
    expected_txt = f"docurama-verification={verification_token}"
    found_txt = [r.get("data", "") for r in dns_details.get("txt_records", [])]
    txt_ok = method_matched == "dns_txt"
    pointer_ok = method_matched == "dns_subdomain_pointer"
    web_ok = method_matched == "web_confirmation"
    return [
        {"method": "dns_txt",
         "expected": expected_txt,
         "found": found_txt or "no TXT records found",
         "ok": txt_ok},
        {"method": "dns_subdomain_pointer",
         "expected": "docurama.<domain> or sign.<domain> serving the Docurama service",
         "found": dns_details.get("subdomain_pointers", {}),
         "ok": pointer_ok},
        {"method": "web_confirmation",
         "expected": "the token published under /.well-known/docurama-verification",
         "found": dns_details.get("web_confirmation", {}),
         "ok": web_ok},
    ]
