from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.errors import AppError
from app.models import User
from app.schemas.auth import MePatch, UserOut
from app.services.realtime import notify_user

router = APIRouter(tags=["me"])


@router.get("/me", response_model=UserOut)
async def get_me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def patch_me(
    body: MePatch,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise AppError("validation_error", "No fields to update")
    if "email" in data:
        user.email = data["email"]
    if "timezone" in data:
        user.timezone = data["timezone"]
    await notify_user(db, user.id, "settings.changed", ids=[user.id])
    await db.commit()
    await db.refresh(user)
    return user
