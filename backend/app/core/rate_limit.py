"""
In-process rate limiter shared by the application and its endpoint modules.

Lives in its own module rather than app.main so endpoint modules can import the
same instance without an import cycle: main imports them through the router, so
`from app.main import limiter` inside an endpoint module would be circular.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Keyed by client address. Storage is in-memory, which is the intended scope for
# this deployment shape: per-worker throttling with no external service to run.
# headers_enabled so rejected callers receive Retry-After and X-RateLimit-*
# headers instead of a bare 429.
limiter = Limiter(key_func=get_remote_address, headers_enabled=True)
