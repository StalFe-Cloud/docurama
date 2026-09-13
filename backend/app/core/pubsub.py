"""
Cross-replica pub/sub for the signing-session WebSocket relay (Sprint 3).

The ConnectionManager in api/ws.py keeps per-process state, so with more than
one replica the desktop and the phone can land on different workers and the
hand-off silently dies. This module is the seam that fixes it:

- InMemoryPubSub (default): zero new infrastructure, exactly today's behaviour
  for single-replica and self-hosted deployments.
- RedisPubSub (DOCURAMA_REDIS_URL set): publishes relay messages to Redis
  channels so every replica's listener can fan out to its local sockets.

Delivery is local-first: a replica always delivers to its own sockets before
publishing, and stamps each message with an origin id so a replica ignores the
echo of its own publish. The Redis listener reconnects with capped backoff and
never raises into the caller - a degraded bus must cost latency, not sessions.
"""
import asyncio
import contextlib
import os
import uuid
from typing import Awaitable, Callable, Dict, List, Optional, Set

from app.core.config import settings

Subscriber = Callable[[str, dict], Awaitable[None]]

# Cap how long any single subscriber callback may take; a wedged subscriber
# must not stall the fan-out loop for everyone else.
_CALLBACK_TIMEOUT_SECONDS = 3.0


class InMemoryPubSub:
    """Per-process fan-out. Faithful to single-worker semantics."""

    name = "inmemory"

    def __init__(self):
        self._subscribers: Dict[str, List[Subscriber]] = {}
        self._tasks: Set[asyncio.Task] = set()

    async def publish(self, channel: str, message: dict) -> bool:
        for callback in list(self._subscribers.get(channel, [])):
            task = asyncio.create_task(self._safe_call(callback, channel, dict(message)))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        return True

    def subscribe(self, channel: str, callback: Subscriber) -> Callable[[], None]:
        self._subscribers.setdefault(channel, []).append(callback)

        def _unsubscribe() -> None:
            try:
                self._subscribers.get(channel, []).remove(callback)
            except ValueError:
                pass

        return _unsubscribe

    async def _safe_call(self, callback: Subscriber, channel: str, message: dict) -> None:
        try:
            await asyncio.wait_for(
                callback(channel, message), timeout=_CALLBACK_TIMEOUT_SECONDS
            )
        except Exception:
            pass

    async def aclose(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        self._tasks.clear()
        self._subscribers.clear()


class RedisPubSub:
    """
    Redis-backed fan-out with a per-instance listener loop.

    Redis is imported lazily: self-hosted installs without the package keep
    working through InMemoryPubSub. Publishing is fire-and-forget from the
    caller's perspective (returns False on failure instead of raising), and
    the listener reconnects with capped exponential backoff.
    """

    name = "redis"

    def __init__(self, url: Optional[str] = None, origin: Optional[str] = None):
        self.url = url or getattr(settings, "REDIS_URL", "") or ""
        self.origin = origin or uuid.uuid4().hex
        self._subscribers: Dict[str, List[Subscriber]] = {}
        self._client = None
        self._listener_task: Optional[asyncio.Task] = None
        self._running = False

    def _redis_module(self):
        import redis.asyncio as aioredis  # optional dependency

        return aioredis

    @property
    def client(self):
        if self._client is None:
            aioredis = self._redis_module()
            self._client = aioredis.from_url(
                self.url, decode_responses=True, socket_connect_timeout=3
            )
        return self._client

    def _channel_key(self, channel: str) -> str:
        return f"docurama:pubsub:{channel}"

    def subscribe(self, channel: str, callback: Subscriber) -> Callable[[], None]:
        self._subscribers.setdefault(channel, []).append(callback)
        self._ensure_listener()

        def _unsubscribe() -> None:
            try:
                self._subscribers.get(channel, []).remove(callback)
            except ValueError:
                pass

        return _unsubscribe

    async def publish(self, channel: str, message: dict) -> bool:
        # Local-first: same-process subscribers hear it immediately, as they
        # would have without the bus at all.
        for callback in list(self._subscribers.get(channel, [])):
            await self._safe_call(callback, channel, {"_origin": self.origin, **message})
        envelope = {"_origin": self.origin, **message}
        try:
            await self.client.publish(self._channel_key(channel), __import__("json").dumps(envelope))
            return True
        except Exception:
            # A degraded bus must not break a signing session: the local
            # delivery above already happened.
            return False

    async def _safe_call(self, callback: Subscriber, channel: str, message: dict) -> None:
        try:
            await asyncio.wait_for(
                callback(channel, message), timeout=_CALLBACK_TIMEOUT_SECONDS
            )
        except Exception:
            pass

    def _ensure_listener(self) -> None:
        if self._listener_task is not None and not self._listener_task.done():
            return
        self._running = True
        self._listener_task = asyncio.create_task(self._listen_loop())

    async def _listen_loop(self) -> None:
        backoff = 1.0
        while self._running:
            pubsub = None
            try:
                pubsub = self.client.pubsub()
                await pubsub.psubscribe(f"{self._channel_key('*')}")
                async for event in pubsub.listen():
                    if event.get("type") not in ("pmessage", "message"):
                        continue
                    raw = event.get("data")
                    try:
                        import json

                        payload = json.loads(raw)
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    if payload.get("_origin") == self.origin:
                        continue  # our own echo; local delivery already happened
                    channel = str(event.get("channel", "")).replace(
                        self._channel_key(""), ""
                    )
                    for callback in list(self._subscribers.get(channel, [])):
                        await self._safe_call(callback, channel, payload)
                    backoff = 1.0
            except asyncio.CancelledError:
                break
            except Exception:
                # Redis down or restarted: back off and try again rather than
                # spinning or dying.
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                if pubsub is not None:
                    with contextlib.suppress(Exception):
                        await pubsub.aclose()

    async def aclose(self) -> None:
        self._running = False
        if self._listener_task is not None:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener_task
        if self._client is not None:
            with contextlib.suppress(Exception):
                await self._client.aclose()
        self._subscribers.clear()


_instance = None


def get_pubsub():
    """Process-wide bus, chosen once from configuration."""
    global _instance
    if _instance is None:
        url = (getattr(settings, "REDIS_URL", "") or "").strip()
        if url:
            try:
                _instance = RedisPubSub(url=url)
            except Exception:
                _instance = InMemoryPubSub()
        else:
            _instance = InMemoryPubSub()
    return _instance


def reset_pubsub() -> None:
    """Test helper: drop the singleton so a new configuration is honoured."""
    global _instance
    _instance = None
