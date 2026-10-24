import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.db import get_session
from app.errors import AppError
from app.models import Notification, User
from app.schemas.notifications import NotificationOut
from app.services.realtime import notify_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    unseen: Annotated[int | None, Query()] = None,
) -> list[Notification]:
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unseen == 1:
        stmt = stmt.where(Notification.seen_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(100)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/{notification_id}/seen", response_model=NotificationOut)
async def mark_seen(
    notification_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> Notification:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise AppError("not_found", "notification not found", status_code=404)
    if row.seen_at is None:
        row.seen_at = clock.now()
        await notify_user(
            db,
            user.id,
            "notification.seen",
            ids=[row.id],
        )
        await db.commit()
        await db.refresh(row)
    return row
