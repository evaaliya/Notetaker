from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import create_session, delete_session
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.errors import AppError
from app.models import User
from app.schemas.auth import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )


@router.post("/register", response_model=UserOut)
async def register(
    body: RegisterRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    login = body.login.strip()
    if not login:
        raise AppError("validation_error", "login is required")

    existing = await db.execute(select(User).where(User.login == login))
    if existing.scalar_one_or_none() is not None:
        raise AppError("conflict", "login already taken", status_code=409)

    user = User(
        login=login,
        password_hash=hash_password(body.password),
        timezone=body.timezone or "UTC",
        created_at=clock.now(),
    )
    db.add(user)
    await db.flush()

    token = await create_session(db, user.id, clock, settings)
    await db.commit()
    await db.refresh(user)
    _set_session_cookie(response, token, settings)
    return user


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    result = await db.execute(select(User).where(User.login == body.login.strip()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, body.password):
        raise AppError("unauthorized", "Invalid login or password", status_code=401)

    token = await create_session(db, user.id, clock, settings)
    await db.commit()
    _set_session_cookie(response, token, settings)
    return user


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    token = request.cookies.get(settings.cookie_name)
    await delete_session(db, token)
    await db.commit()
    response.delete_cookie(key=settings.cookie_name, path="/")
    return {"status": "ok"}
