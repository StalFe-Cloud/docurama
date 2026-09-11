"""
One-click Cloudflare DNS records.

The customer creates a DNS-scoped API token in their Cloudflare dashboard and
pastes it here; it authorizes exactly this record creation and is then
discarded. It is never stored, logged, or echoed back.
"""
from typing import Optional

import httpx

API_BASE = "https://api.cloudflare.com/client/v4"
TIMEOUT = 15.0


async def create_challenge_record(api_token: str, zone_name: str, host: str,
                                  value: str) -> dict:
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            zone_resp = await client.get(
                f"{API_BASE}/zones", params={"name": zone_name}, headers=headers)
            zone_resp.raise_for_status()
            zones = zone_resp.json().get("result") or []
            if not zones:
                return {"ok": False, "record_id": None,
                        "error": f"Zone {zone_name} not found in this Cloudflare account. "
                                 "Confirm the token's account includes this domain."}

            record_resp = await client.post(
                f"{API_BASE}/zones/{zones[0]['id']}/dns_records",
                headers=headers,
                json={"type": "TXT", "name": host, "content": value, "ttl": 1},
            )
            record_resp.raise_for_status()
            record = record_resp.json().get("result") or {}
            return {"ok": True, "record_id": record.get("id"), "error": None}
        except httpx.HTTPStatusError as exc:
            # Surface Cloudflare's own message; never the token.
            detail = "Cloudflare rejected the request"
            try:
                errors = exc.response.json().get("errors") or []
                if errors and errors[0].get("message"):
                    detail = f"Cloudflare: {errors[0]['message']}"
            except Exception:
                pass
            return {"ok": False, "record_id": None, "error": detail}
        except Exception as exc:
            return {"ok": False, "record_id": None,
                    "error": f"Could not reach Cloudflare: {exc}"}
