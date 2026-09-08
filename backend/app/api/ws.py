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

    async def connect(self, token: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(token, []).append(websocket)

    def disconnect(self, token: str, websocket: WebSocket):
        if token in self.active_connections:
            if websocket in self.active_connections[token]:
                self.active_connections[token].remove(websocket)
            if not self.active_connections[token]:
                del self.active_connections[token]

    async def broadcast_to_session(self, token: str, message: dict):
        if token in self.active_connections:
            for connection in self.active_connections[token]:
                try:
                    await connection.send_text(json.dumps(message))
                except Exception:
                    pass


manager = ConnectionManager()


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
