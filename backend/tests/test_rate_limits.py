"""
Rate limiting on the authentication and public upload endpoints.

slowapi counts requests per client address in-process. The HTTP harness shares
one client address across every request a test makes, so a login loop past the
configured limit must be answered with 429 and a Retry-After.
"""


async def test_login_is_rate_limited(client, db_session):
    for _ in range(10):
        resp = await client.post("/api/auth/login", json={
            "email": "nobody@example.com", "password": "whatever-password",
        })
        assert resp.status_code == 400  # wrong credentials, uniform message
    eleventh = await client.post("/api/auth/login", json={
        "email": "nobody@example.com", "password": "whatever-password",
    })
    assert eleventh.status_code == 429
    assert eleventh.headers.get("Retry-After") is not None
