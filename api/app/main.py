from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clock import SystemClock
from app.errors import AppError, app_error_handler
from app.migrate import run_migrations
from app.routers import auth, calendar, health, me, notes, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    if not hasattr(app.state, "clock"):
        app.state.clock = SystemClock()
    yield


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
