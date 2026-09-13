"""
Structured logging and request correlation.

The backend previously logged almost exclusively through bare print(): no
timestamps in production deployments, no levels, no request correlation, and
whatever happened to hit stdout was mixed with uvicorn noise. This module
gives every log line a stable JSON shape and gives every request an id that
appears both in the response header (X-Request-ID) and in the log entry, so
an operator can trace one user's failed signing attempt across services.

Rotation is configured at the compose level (json-file max-size); the handler
here just writes structured lines to stdout, which is what a container log
driver collects.
"""
import json
import logging
import os
import sys
import time
import uuid

from starlette.datastructures import MutableHeaders


def _env_level() -> str:
    return os.getenv("DOCURAMA_LOG_LEVEL", "INFO").strip().upper() or "INFO"


class JsonFormatter(logging.Formatter):
    """
    One JSON object per line. Machine-parsable by docker/journald/Loki without
    a regex, and greppable by humans all the same.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Extra context (request_id, account_id, ...) rides on the record.
        for key in ("request_id", "account_id", "method", "path", "status", "duration_ms", "client"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    """
    Idempotent logging setup called once at application import.

    Attaches a JSON handler to the root logger so every module logger
    (including uvicorn's error logger) emits structured lines. Uvicorn's
    access log stays enabled for local ergonomics; in production the request
    middleware below is the authoritative per-request record.
    """
    root = logging.getLogger()
    if any(isinstance(h, logging.StreamHandler) and getattr(h, "_docurama_json", False) for h in root.handlers):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler._docurama_json = True  # type: ignore[attr-defined]
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(_env_level())

    # uvicorn's default handlers duplicate everything to stderr unstructured;
    # quiet their handlers' propagation by routing through the root instead.
    for noisy in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(noisy)
        logger.handlers = []
        logger.propagate = True


class RequestLoggingMiddleware:
    """
    Pure-ASGI middleware: one structured log line per HTTP request.

    - assigns a request id (honouring an inbound X-Request-ID from a proxy)
    - echoes it back as X-Request-ID so a user's bug report can be matched
      to the exact log line
    - logs method, path, status and duration; failures log at error level
      with the traceback
    """

    def __init__(self, app):
        self.app = app
        self.logger = logging.getLogger("docurama.request")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = MutableHeaders(scope=scope)
        inbound = headers.get("x-request-id", "")
        request_id = inbound if inbound else uuid.uuid4().hex[:16]

        start = time.perf_counter()
        status_holder = {"status": None}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                response_headers = MutableHeaders(scope=message)
                response_headers.append("x-request-id", request_id)
            await send(message)

        client = scope.get("client")
        client_ip = client[0] if client else None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            self.logger.error(
                "request failed",
                extra={
                    "request_id": request_id,
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": 500,
                    "duration_ms": duration_ms,
                    "client": client_ip,
                },
                exc_info=True,
            )
            raise

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        status = status_holder["status"]
        message = "request"
        extra = {
            "request_id": request_id,
            "method": scope.get("method"),
            "path": scope.get("path"),
            "status": status,
            "duration_ms": duration_ms,
            "client": client_ip,
        }
        if status is not None and status >= 500:
            self.logger.error(message, extra=extra)
        elif status is not None and status >= 400:
            self.logger.warning(message, extra=extra)
        else:
            self.logger.info(message, extra=extra)
