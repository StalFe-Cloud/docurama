"""
Pytest bootstrap.

config.py refuses to start with the repository's default secrets unless the
deployment is explicitly marked as non-production. Tests run against those
defaults on purpose, so the environment is marked before app modules import.
"""
import os

os.environ.setdefault("DOCURAMA_ENV", "development")

import pytest  # noqa: E402


def _argon2_available() -> bool:
    try:
        import argon2  # noqa: F401
        return True
    except ImportError:
        return False


# argon2-cffi is a runtime dependency (requirements.txt) and is installed in the
# container image, but may be missing from a developer's host interpreter. Tests
# that need it skip there rather than failing; run the suite inside the image to
# exercise them.
requires_argon2 = pytest.mark.skipif(
    not _argon2_available(),
    reason="argon2-cffi is not installed in this interpreter; run the suite in the container image",
)
