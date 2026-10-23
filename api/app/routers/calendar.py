from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.db import get_session
from app.models import User
from app.schemas.calendar import CalendarOut, UpcomingOut
from app.services import calendar as calendar_svc

router = APIRouter(tags=["calendar"])


@router.get("/calendar", response_model=CalendarOut)
async def get_calendar(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    from_: Annotated[datetime, Query(alias="from")],
    to: Annotated[datetime, Query()],
) -> CalendarOut:
    items = await calendar_svc.list_calendar(
        db, user_id=user.id, from_dt=from_, to_dt=to
    )
    return CalendarOut(items=items)


@router.get("/upcoming", response_model=UpcomingOut)
async def get_upcoming(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> UpcomingOut:
    today, week, past = await calendar_svc.list_upcoming(
        db,
        user_id=user.id,
        now=clock.now(),
        tz_name=user.timezone,
    )
    return UpcomingOut(today=today, week=week, past=past)
