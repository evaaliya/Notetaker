from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    content: dict[str, Any] = {"error": {"code": exc.code, "message": exc.message}}
    content.update(exc.extra)
    return JSONResponse(status_code=exc.status_code, content=content)
