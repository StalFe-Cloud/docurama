"""
Security response headers (Sprint 3, finding S-1).

The dynamic testing pass found all six hardening headers absent from every
response. A SPA needs a deliberate CSP - inline styles are how the app is
styled, fonts come from Google Fonts, and the WebSocket hand-off needs ws/wss -
so the policy here is explicit about exactly those allowances and forbids
everything else. HSTS is only meaningful over TLS, so it is emitted only when
the request arrived over https (directly or via a trusted proxy header).

Nonce-free by design: the frontend bundle contains no inline scripts, so
script-src 'self' holds without per-response nonces, which keeps the policy
cacheable and simple to verify.
"""
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: blob:; "
    "connect-src 'self' ws: wss:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach the hardened header set to every response."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        # HSTS over plain http would instruct the browser to refuse the very
        # connection it is making; only claim it when the hop is actually TLS.
        forwarded_proto = (request.headers.get("x-forwarded-proto") or "").lower()
        if request.url.scheme == "https" or forwarded_proto == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response
