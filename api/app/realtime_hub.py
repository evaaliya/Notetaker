"""Per-process pg LISTEN → WebSocket fan-out for connected users."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict

import asyncpg
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.config import Settings, get_settings

logger = logging.getLogger("realtime")


def asyncpg_dsn(database_url: str) -> str:
    """Convert SQLAlchemy async URL to an asyncpg DSN."""
    url = database_url
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql://" + url.removeprefix("postgresql+asyncpg://")
    elif url.startswith("postgres+asyncpg://"):
        url = "postgresql://" + url.removeprefix("postgres+asyncpg://")
    return url


class RealtimeHub:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._conn: asyncpg.Connection | None = None
        self._sockets: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._listened: set[str] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def connected(self) -> bool:
        return self._conn is not None and not self._conn.is_closed()

    async def start(self) -> None:
        """Open LISTEN connection on the current event loop (reconnect if loop changed)."""
        loop = asyncio.get_running_loop()
        if self._conn is not None and not self._conn.is_closed() and self._loop is loop:
            return
        if self._conn is not None:
            await self._close_conn()
        self._loop = loop
        self._conn = await asyncpg.connect(asyncpg_dsn(self._settings.database_url))
        logger.info("realtime hub connected to postgres")

    async def _close_conn(self) -> None:
        if self._conn is not None and not self._conn.is_closed():
            for channel in list(self._listened):
                try:
                    await self._conn.remove_listener(channel, self._on_notify)
                except Exception:
                    logger.exception("remove_listener %s", channel)
            try:
                await self._conn.close()
            except Exception:
                logger.exception("close realtime hub connection")
        self._conn = None
        self._listened.clear()

    async def stop(self) -> None:
        async with self._lock:
            await self._close_conn()
            self._sockets.clear()
            self._loop = None

    async def register(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        channel = f"u_{user_id}"
        async with self._lock:
            await self.start()
            self._sockets[user_id].add(ws)
            if channel not in self._listened:
                assert self._conn is not None
                await self._conn.add_listener(channel, self._on_notify)
                self._listened.add(channel)

    async def unregister(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        channel = f"u_{user_id}"
        async with self._lock:
            sockets = self._sockets.get(user_id)
            if not sockets:
                return
            sockets.discard(ws)
            if sockets:
                return
            self._sockets.pop(user_id, None)
            if channel in self._listened and self._conn is not None and not self._conn.is_closed():
                try:
                    await self._conn.remove_listener(channel, self._on_notify)
                except Exception:
                    logger.exception("remove_listener %s", channel)
                self._listened.discard(channel)

    def _on_notify(
        self,
        _connection: asyncpg.Connection,
        _pid: int,
        channel: str,
        payload: str,
    ) -> None:
        if not channel.startswith("u_"):
            return
        try:
            user_id = uuid.UUID(channel[2:])
        except ValueError:
            logger.warning("bad notify channel %s", channel)
            return
        loop = self._loop
        if loop is None:
            return
        loop.create_task(self._broadcast(user_id, payload))

    async def _broadcast(self, user_id: uuid.UUID, payload: str) -> None:
        sockets = list(self._sockets.get(user_id, ()))
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                if ws.client_state != WebSocketState.CONNECTED:
                    dead.append(ws)
                    continue
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            # Inline cleanup to avoid lock re-entrancy with unregister().
            async with self._lock:
                bucket = self._sockets.get(user_id)
                if not bucket:
                    continue
                bucket.discard(ws)
                if not bucket:
                    self._sockets.pop(user_id, None)
                    channel = f"u_{user_id}"
                    if (
                        channel in self._listened
                        and self._conn is not None
                        and not self._conn.is_closed()
                    ):
                        try:
                            await self._conn.remove_listener(channel, self._on_notify)
                        except Exception:
                            logger.exception("remove_listener %s", channel)
                        self._listened.discard(channel)


async def ws_loop(hub: RealtimeHub, user_id: uuid.UUID, ws: WebSocket) -> None:
    await hub.register(user_id, ws)
    try:
        while True:
            # Client may send pings; we ignore payload. Disconnect ends the loop.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unregister(user_id, ws)
