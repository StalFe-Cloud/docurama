import json
from typing import Dict, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websockets"])

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

@router.websocket("/ws/signing/{token}")
async def websocket_signing_endpoint(websocket: WebSocket, token: str):
    await manager.connect(token, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                # Broadcast message (e.g. mobile signature progress, completion)
                await manager.broadcast_to_session(token, msg)
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(token, websocket)
