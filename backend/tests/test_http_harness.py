async def test_health_endpoint_via_http(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "docurama-backend"
