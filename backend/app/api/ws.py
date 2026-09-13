"""
Signing session WebSocket.

Used for the desktop-to-mobile hand-off, so both devices watching one signing session
stay in step. Previously the endpoint accepted any token string without checking it
resolved to a recipient, and rebroadcast whatever a client sent verbatim. A caller
could therefore hold open sockets on arbitrary tokens and inject arbitrary payloads
into a session.

Connections are now validated against a live signing token, and relayed messages are
restricted to a known set of progress signals.
"""
import json
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.future import select

from app.core.database import AsyncSessionLocal
from app.core.pubsub import get_pubsub
from app.models import Recipient

router = APIRouter(tags=["websockets"])

# Progress signals a client is allowed to relay. Anything else is dropped rather
# than forwarded to the other device.
RELAYABLE_MESSAGE_TYPES = {
    "MOBILE_CONNECTED",
    "MOBILE_DISCONNECTED",
    "SIGNATURE_PROGRESS",
    "SIGNATURE_CAPTURED",
    "PING",
}

MAX_MESSAGE_BYTES = 16 * 1024


class ConnectionManager:
    def __init__(self):
        # Maps signing_token -> List[WebSocket]
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Maps signing_token -> bus unsubscribe handle, so a replica only
        # listens on channels that actually have local sockets.
        self._bus_unsubscribers: Dict[str, object] = {}

    async def connect(self, token: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(token, []).append(websocket)
        # Cross-replica fan-in: with more than one worker, the desktop and the
        # phone can land on different replicas; the bus relays progress between
        # them. Idempotent per token.
        if token not in self._bus_unsubscribers:
            self._bus_unsubscribers[token] = get_pubsub().subscribe(
                _bus_channel(token), _make_bus_relay(token)
            )

    def disconnect(self, token: str, websocket: WebSocket):
        if token in self.active_connections:
            if websocket in self.active_connections[token]:
                self.active_connections[token].remove(websocket)
            if not self.active_connections[token]:
                del self.active_connections[token]
        unsub = self._bus_unsubscribers.pop(token, None)
        if unsub is not None:
            try:
                unsub()
            except Exception:
                pass

    async def _deliver_local(self, token: str, message: dict) -> None:
        """Deliver to this replica's sockets only (bus relay path - no republish)."""
        if token in self.active_connections:
            for connection in self.active_connections[token]:
                try:
                    await connection.send_text(json.dumps(message))
                except Exception:
                    pass

    async def broadcast_to_session(self, token: str, message: dict):
        # Local-first, exactly as before the bus existed.
        if token in self.active_connections:
            for connection in self.active_connections[token]:
                try:
                    await connection.send_text(json.dumps(message))
                except Exception:
                    pass
        # Then fan out to other replicas. The origin stamp makes each replica
        # ignore the echo of its own publish; failures degrade to today's
        # single-replica behaviour, never to a broken session.
        try:
            await get_pubsub().publish(_bus_channel(token), dict(message))
        except Exception:
            pass


manager = ConnectionManager()


def _bus_channel(token: str) -> str:
    return f"ws:{token}"


def _make_bus_relay(token: str):
    """Bus subscriber that relays remote progress to this replica's sockets."""
    async def _relay(channel: str, message: dict) -> None:
        if message.get("type") not in RELAYABLE_MESSAGE_TYPES:
            return
        await manager._deliver_local(token, {
            "type": message["type"],
            "signer": str(message.get("signer", ""))[:255],
            "progress": message.get("progress") if isinstance(message.get("progress"), (int, float)) else None,
        })
    return _relay


async def _token_is_live(token: str) -> bool:
    """A token is accepted only while it resolves to a recipient and has not expired."""
    if not token or len(token) > 128:
        return False
    async with AsyncSessionLocal() as session:
        recipient = (await session.execute(
            select(Recipient).where(Recipient.signing_token == token)
        )).scalar_one_or_none()

        if recipient is None:
            return False

        expires_at = getattr(recipient, "token_expires_at", None)
        if expires_at is not None:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires_at:
                return False
        return True


@router.websocket("/ws/signing/{token}")
async def websocket_signing_endpoint(websocket: WebSocket, token: str):
    if not await _token_is_live(token):
        # 1008 policy violation, closed before accept so no session is established.
        await websocket.close(code=1008)
        return

    await manager.connect(token, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if len(data) > MAX_MESSAGE_BYTES:
                continue
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") not in RELAYABLE_MESSAGE_TYPES:
                continue
            # Relay only the recognised fields; a client cannot inject arbitrary
            # structure into the other device's session.
            await manager.broadcast_to_session(token, {
                "type": msg["type"],
                "signer": str(msg.get("signer", ""))[:255],
                "progress": msg.get("progress") if isinstance(msg.get("progress"), (int, float)) else None,
            })
    except WebSocketDisconnect:
        manager.disconnect(token, websocket)
    except Exception:
        manager.disconnect(token, websocket)
