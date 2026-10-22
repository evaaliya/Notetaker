from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.sessions import get_user_by_token
from app.clock import Clock, SystemClock
from app.config import Settings, get_settings
from app.db import get_session
from app.errors import AppError
from app.models import User


def get_clock(request: Request) -> Clock:
    return getattr(request.app.state, "clock", SystemClock())


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    token = request.cookies.get(settings.cookie_name)
    user = await get_user_by_token(db, token, clock)
    if user is None:
        raise AppError("unauthorized", "Authentication required", status_code=401)
    return user
