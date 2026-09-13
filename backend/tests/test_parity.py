import pytest
import os
import io
from app.services.field_detector import FieldDetector
from app.services.webhook_dispatcher import WebhookDispatcher

def test_field_detector_fallback():
    # Test field detection
    detected = FieldDetector.detect_fields("dummy.pdf")
    assert len(detected) >= 2
    types = [d["field_type"] for d in detected]
    assert "signature" in types
    assert "date" in types

def test_webhook_hmac_signature():
    secret = "dcr_wh_sec_12345"
    payload = b'{"event":"envelope.completed","timestamp":1700000000}'
    sig = WebhookDispatcher.generate_signature(secret, payload)
    assert sig.startswith("sha256=")
    assert len(sig) == 7 + 64 # sha256= + 64 hex characters
