from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clock import SystemClock
from app.config import get_settings
from app.errors import AppError, app_error_handler
from app.migrate import run_migrations
from app.realtime_hub import RealtimeHub
from app.routers import auth, calendar, e2e_hooks, health, me, notes, notifications, tags, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    if not hasattr(app.state, "clock"):
        app.state.clock = SystemClock()
    hub = getattr(app.state, "realtime_hub", None)
    owns_hub = hub is None
    if owns_hub:
        hub = RealtimeHub(get_settings())
        await hub.start()
        app.state.realtime_hub = hub
    yield
    if owns_hub:
        await hub.stop()


app = FastAPI(title="Notetaker API", lifespan=lifespan)
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(e2e_hooks.router, prefix="/api")
app.include_router(ws.router)