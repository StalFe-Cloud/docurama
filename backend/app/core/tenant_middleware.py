"""
Record the host a request arrived on.

Deliberately pure: no database, no policy. Resolution to an account happens in
the tenant dependency, which runs inside the request's dependency graph and
therefore uses the same session (and the same test overrides) as everything
else. The middleware exists so the host is captured before any routing
decision, on every request, in every mode.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class TenantHostMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.tenant_host = request.headers.get("host", "")
        return await call_next(request)
