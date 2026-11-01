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
    err: dict[str, Any] = {"code": exc.code, "message": exc.message}
    if "hint" in exc.extra:
        err["hint"] = exc.extra["hint"]
    content: dict[str, Any] = {"error": err}
    # Keep top-level extras (e.g. note on 409) for backward compatibility.
    for k, v in exc.extra.items():
        if k != "hint":
            content[k] = v
    return JSONResponse(status_code=exc.status_code, content=content)
