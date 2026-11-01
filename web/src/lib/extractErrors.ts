import { ApiError } from "../api";

export type ExtractUiError = {
  code: string;
  message: string;
  hint: string;
};

const FALLBACK: ExtractUiError = {
  code: "upstream_error",
  message: "Не удалось выполнить разбор",
  hint: "Нажмите «Повторить». Если ошибка повторяется — проверьте сеть и ключ OpenRouter.",
};

const BY_CODE: Record<string, ExtractUiError> = {
  no_captions: {
    code: "no_captions",
    message: "У этого ролика нет субтитров (ни ручных, ни авто).",
    hint: "Выберите другое видео с субтитрами или вставьте транскрипт на экране «Звонок».",
  },
  video_unavailable: {
    code: "video_unavailable",
    message: "Видео недоступно (удалено, приватное или заблокировано).",
    hint: "Проверьте ссылку и регистр id (I ≠ l), откройте ролик в браузере.",
  },
  timeout: {
    code: "timeout",
    message: "Превышено время ожидания.",
    hint: "Нажмите «Повторить». Free-пул модели иногда отвечает очень долго.",
  },
  model_no_response: {
    code: "model_no_response",
    message: "Модель не вернула ответ.",
    hint: "Нажмите «Повторить» чуть позже.",
  },
  invalid_key: {
    code: "invalid_key",
    message: "Ключ OpenRouter отклонён.",
    hint: "Проверьте OPENROUTER_API_KEY в .env и перезапустите api/worker.",
  },
  network: {
    code: "network",
    message: "Нет сети до сервера или внешнего сервиса.",
    hint: "Проверьте интернет и нажмите «Повторить».",
  },
  cancelled: {
    code: "cancelled",
    message: "Разбор отменён.",
    hint: "Нажмите «Разобрать субтитры», чтобы начать заново.",
  },
};

export function extractErrorFromUnknown(err: unknown): ExtractUiError {
  if (err instanceof ApiError) {
    const base = (err.code && BY_CODE[err.code]) || {
      ...FALLBACK,
      code: err.code || FALLBACK.code,
      message: err.message || FALLBACK.message,
    };
    return {
      code: base.code,
      message: err.message || base.message,
      hint: err.hint || base.hint,
    };
  }
  if (err instanceof Error) {
    return { ...FALLBACK, message: err.message || FALLBACK.message };
  }
  return FALLBACK;
}

export function extractErrorFromJob(job: {
  error_code?: string | null;
  error_message?: string | null;
  error_hint?: string | null;
}): ExtractUiError {
  const code = job.error_code || "upstream_error";
  const base = BY_CODE[code] || FALLBACK;
  return {
    code,
    message: job.error_message || base.message,
    hint: job.error_hint || base.hint,
  };
}
