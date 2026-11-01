"""Russian, actionable errors for extract / YouTube / OpenRouter (M14)."""

from __future__ import annotations

from dataclasses import dataclass

from app.errors import AppError


@dataclass(frozen=True)
class ExtractFailure:
    code: str
    message: str
    hint: str
    status_code: int = 502


_HINTS: dict[str, ExtractFailure] = {
    "no_captions": ExtractFailure(
        "no_captions",
        "У этого ролика нет субтитров (ни ручных, ни авто).",
        "Выберите другое видео с субтитрами или вставьте транскрипт вручную на экране «Звонок».",
        404,
    ),
    "video_unavailable": ExtractFailure(
        "video_unavailable",
        "Видео недоступно (удалено, приватное или заблокировано в регионе).",
        "Проверьте ссылку и регистр id (I ≠ l). Откройте ролик в браузере и попробуйте снова.",
        404,
    ),
    "timeout": ExtractFailure(
        "timeout",
        "Превышено время ожидания внешнего сервиса.",
        "Нажмите «Повторить». Если снова долго — подождите минуту или смените модель/провайдера.",
        504,
    ),
    "model_no_response": ExtractFailure(
        "model_no_response",
        "Модель не вернула ответ.",
        "Нажмите «Повторить». Free-пул OpenRouter иногда пустой — попробуйте позже.",
        502,
    ),
    "invalid_key": ExtractFailure(
        "invalid_key",
        "Ключ OpenRouter отклонён (неверный или без доступа).",
        "Проверьте OPENROUTER_API_KEY в .env и перезапустите api/worker.",
        503,
    ),
    "network": ExtractFailure(
        "network",
        "Нет сети до внешнего сервиса.",
        "Проверьте интернет и доступ к youtube.com / openrouter.ai, затем «Повторить».",
        502,
    ),
    "cancelled": ExtractFailure(
        "cancelled",
        "Разбор отменён.",
        "Нажмите «Разобрать субтитры», чтобы начать заново.",
        499,
    ),
    "upstream_error": ExtractFailure(
        "upstream_error",
        "Внешний сервис вернул ошибку.",
        "Нажмите «Повторить». Если повторяется — смотрите логи api/worker.",
        502,
    ),
}


def failure_for(code: str, *, detail: str | None = None) -> ExtractFailure:
    base = _HINTS.get(code) or _HINTS["upstream_error"]
    if detail and code in ("upstream_error", "timeout", "network"):
        return ExtractFailure(base.code, f"{base.message} ({detail})", base.hint, base.status_code)
    if detail and code == "video_unavailable":
        return ExtractFailure(base.code, detail, base.hint, base.status_code)
    if detail and code == "no_captions":
        return ExtractFailure(base.code, detail, base.hint, base.status_code)
    return base


def raise_extract(code: str, *, detail: str | None = None) -> None:
    f = failure_for(code, detail=detail)
    raise AppError(f.code, f.message, status_code=f.status_code, extra={"hint": f.hint})


def map_httpx_error(exc: BaseException) -> ExtractFailure:
    name = type(exc).__name__
    msg = str(exc)
    if "Timeout" in name or "timeout" in msg.lower():
        return failure_for("timeout", detail=name)
    if "Connect" in name or "Network" in name or "NameResolution" in name:
        return failure_for("network", detail=name)
    return failure_for("network", detail=name)


def map_openrouter_status(status: int, body: str) -> ExtractFailure:
    if status in (401, 403):
        return failure_for("invalid_key")
    if status == 429:
        return failure_for("timeout", detail="HTTP 429")
    if status >= 500:
        return failure_for("upstream_error", detail=f"HTTP {status}")
    snippet = (body or "")[:180].replace("\n", " ")
    return failure_for("upstream_error", detail=f"HTTP {status}: {snippet}")
