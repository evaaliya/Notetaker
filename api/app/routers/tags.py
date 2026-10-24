import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.errors import AppError
from app.models import Tag, User
from app.schemas.tags import TagCreate, TagOut, TagPatch
from app.services.realtime import notify_user
from app.services.tags import set_tag_name

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
async def list_tags(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> list[Tag]:
    result = await db.execute(
        select(Tag).where(Tag.user_id == user.id).order_by(Tag.name_lower)
    )
    return list(result.scalars().all())


@router.post("", response_model=TagOut, status_code=201)
async def create_tag(
    body: TagCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> Tag:
    tag = Tag(id=uuid.uuid4(), user_id=user.id, color=body.color)
    try:
        set_tag_name(tag, body.name)
    except ValueError as exc:
        raise AppError("validation_error", str(exc)) from exc
    db.add(tag)
    try:
        await notify_user(db, user.id, "tag.changed", ids=[tag.id])
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError("conflict", "tag name already exists", status_code=409) from exc
    await db.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=TagOut)
async def patch_tag(
    tag_id: uuid.UUID,
    body: TagPatch,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> Tag:
    tag = await _get_owned_tag(db, user.id, tag_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise AppError("validation_error", "No fields to update")
    if "name" in data:
        try:
            set_tag_name(tag, data["name"])
        except ValueError as exc:
            raise AppError("validation_error", str(exc)) from exc
    if "color" in data:
        tag.color = data["color"]
    try:
        await notify_user(db, user.id, "tag.changed", ids=[tag.id])
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError("conflict", "tag name already exists", status_code=409) from exc
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tag = await _get_owned_tag(db, user.id, tag_id)
    tag_id_val = tag.id
    await db.delete(tag)
    await notify_user(db, user.id, "tag.changed", ids=[tag_id_val])
    await db.commit()


async def _get_owned_tag(db: AsyncSession, user_id: uuid.UUID, tag_id: uuid.UUID) -> Tag:
    result = await db.execute(select(Tag).where(Tag.id == tag_id, Tag.user_id == user_id))
    tag = result.scalar_one_or_none()
    if tag is None:
        raise AppError("not_found", "tag not found", status_code=404)
    return tag
