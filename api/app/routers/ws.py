"""WebSocket endpoint — cookie session, hub fan-out (spec §5)."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

from app.auth.sessions import get_user_by_token
from app.clock import SystemClock
from app.config import get_settings
from app.db import SessionLocal
from app.realtime_hub import ws_loop

router = APIRouter(tags=["ws"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    settings = get_settings()
    token = websocket.cookies.get(settings.cookie_name)
    clock = getattr(websocket.app.state, "clock", SystemClock())
    async with SessionLocal() as db:
        user = await get_user_by_token(db, token, clock)
    if user is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    hub = websocket.app.state.realtime_hub
    await ws_loop(hub, user.id, websocket)
