import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.config import Settings
from app.models import Session, User


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(
    db: AsyncSession,
    user_id: UUID,
    clock: Clock,
    settings: Settings,
) -> str:
    token = new_session_token()
    row = Session(
        token_hash=hash_token(token),
        user_id=user_id,
        expires_at=clock.now() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(row)
    await db.flush()
    return token


async def get_user_by_token(
    db: AsyncSession,
    token: str | None,
    clock: Clock,
) -> User | None:
    if not token:
        return None
    result = await db.execute(
        select(User)
        .join(Session, Session.user_id == User.id)
        .where(Session.token_hash == hash_token(token))
        .where(Session.expires_at > clock.now())
    )
    return result.scalar_one_or_none()


async def delete_session(db: AsyncSession, token: str | None) -> None:
    if not token:
        return
    result = await db.execute(select(Session).where(Session.token_hash == hash_token(token)))
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
