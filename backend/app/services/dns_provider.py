"""
DNS provider detection and setup tutorials.

NS records tell us where the customer actually manages DNS, so the setup steps
can name real screens instead of generic DNS advice. Detection is best effort:
an unknown or unresolvable provider falls back to accurate generic steps and is
reported as None, never guessed.
"""
from typing import Dict, List

from app.services.domain_verifier import doh_query

PROVIDER_NS_SUFFIXES: Dict[str, tuple] = {
    "cloudflare": ("cloudflare.com",),
    "godaddy": ("domaincontrol.com",),
    "namecheap": ("registrar-servers.com",),
    "ovh": ("ovh.net", "ovh.ca"),
    "hetzner": ("hetzner.com", "hetzner.de"),
    "gandi": ("gandi.net",),
    "googledns": ("googledomains.com", "dns.google"),
    "aws": ("awsdns.net",),
    "digitalocean": ("digitalocean.com",),
    "porkbun": ("porkbun.com",),
}

GENERIC_STEPS: List[str] = [
    "Sign in to the service that manages DNS for your domain (your registrar or DNS host).",
    "Open the DNS records editor for your domain.",
    "Add a TXT record with the host shown below and the value shown below (leave TTL at its default).",
    "Save the record, then come back here and press Verify. New records can take a few minutes to an hour to appear.",
]

PROVIDER_TUTORIALS: Dict[str, List[str]] = {
    "cloudflare": [
        "Sign in to Cloudflare and select your domain (Cloudflare acts as the DNS host).",
        "Go to DNS, then Records, and press Add record.",
        "Choose Type TXT. In Name, enter the challenge host shown below (it starts with _docurama-challenge) without the domain (Cloudflare appends it automatically).",
        "Paste the value shown below into Content, keep TTL on Auto, and press Save.",
        "Return here and press Verify. Cloudflare changes usually appear within a minute or two.",
    ],
    "godaddy": [
        "Sign in to GoDaddy and open My Products, then DNS next to your domain.",
        "In the DNS Records list press Add New Record.",
        "Choose Type TXT. In Name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and press Save.",
        "Return here and press Verify. GoDaddy records usually appear within the hour.",
    ],
    "namecheap": [
        "Sign in to Namecheap, open Domain List, then Manage next to your domain.",
        "Open the Advanced DNS tab and press Add New Record.",
        "Choose Record Type TXT Record. In Host, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and save with the green check.",
        "Return here and press Verify. Namecheap changes usually appear within a few minutes.",
    ],
    "ovh": [
        "Sign in to the OVHcloud manager and open Web Cloud, then your domain under Domains.",
        "Open the DNS records tab and press Add an entry.",
        "Choose TXT. For Sub-domain, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and confirm.",
        "Return here and press Verify. OVH changes can take up to an hour to propagate.",
    ],
    "hetzner": [
        "Sign in to Hetzner Cloud Console and open your zone under Networks, DNS.",
        "Press Add record and choose Type TXT.",
        "In Name, enter the challenge host shown below without the zone name.",
        "Paste the value shown below into Value and save.",
        "Return here and press Verify. Hetzner zones usually update quickly.",
    ],
    "gandi": [
        "Sign in to Gandi, open your domain, then the DNS Records tab.",
        "Press Add record and choose TXT.",
        "In Name, enter the challenge host shown below without the domain (Gandi appends the domain automatically).",
        "Paste the value shown below into the text value field and save.",
        "Return here and press Verify. Gandi changes usually appear within minutes.",
    ],
    "googledns": [
        "Sign in to Google Domains (or Google Cloud DNS) and open your domain's DNS records.",
        "Add a record of type TXT.",
        "For Host name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into the TXT value and save.",
        "Return here and press Verify. Google DNS usually updates within minutes.",
    ],
    "aws": [
        "Sign in to the AWS console, open Route 53, then Hosted zones, and select your domain.",
        "Press Create record. Choose Record type TXT.",
        "In Record name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value. Route 53 requires TXT values in quotes; wrap the value in double quotes if the console has not done it.",
        "Create the record, return here, and press Verify. Route 53 usually propagates within a minute or two.",
    ],
    "digitalocean": [
        "Sign in to DigitalOcean and open Networking, Domains, then your domain.",
        "Under Create new record choose TXT.",
        "Enter the challenge host shown below into Hostname without the domain.",
        "Paste the value shown below into the message field and press Create Record.",
        "Return here and press Verify. DigitalOcean changes usually appear quickly.",
    ],
    "porkbun": [
        "Sign in to Porkbun and open your domain's Detailed records.",
        "Press Add and choose Record Type TXT.",
        "In Host, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Content and save.",
        "Return here and press Verify. Porkbun changes usually appear within minutes.",
    ],
}


def _provider_for(nameserver: str):
    lowered = (nameserver or "").lower()
    for key, suffixes in PROVIDER_NS_SUFFIXES.items():
        if any(lowered.endswith(sfx) for sfx in suffixes):
            return key
    return None


async def detect_provider(domain: str) -> dict:
    clean = (domain or "").strip().lower()
    answers = await doh_query(clean, "NS")
    nameservers = [str(a.get("data", "")).strip(".").lower() for a in answers]

    provider = None
    for ns in nameservers:
        provider = _provider_for(ns)
        if provider:
            break

    return {
        "provider": provider,
        "nameservers": nameservers,
        "steps": list(PROVIDER_TUTORIALS[provider]) if provider else list(GENERIC_STEPS),
    }
