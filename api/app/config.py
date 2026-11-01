from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://notetaker:notetaker@localhost:5432/notetaker"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_from: str = "notetaker@localhost"
    session_ttl_hours: int = 720
    cookie_secure: bool = False
    cookie_name: str = "session"
    worker_tick_seconds: float = 1.0
    worker_batch_size: int = 100
    worker_heartbeat_stale_seconds: int = 10
    recurrence_horizon_days: int = 60
    trash_retention_days: int = 30
    outbox_sending_timeout_minutes: int = 2
    e2e_hooks: bool = False
    uploads_dir: str = "/uploads"
    upload_max_bytes: int = 10 * 1024 * 1024
    upload_max_per_note: int = 10
    # M11: stub (default, no network) | openrouter
    ai_provider: str = "stub"
    openrouter_api_key: str | None = None
    # Default: OpenRouter free router (:free). Override via OPENROUTER_MODEL.
    openrouter_model: str = "openrouter/free"
    # M14: wall-clock budgets for external calls (seconds).
    youtube_captions_timeout_sec: float = 15.0
    openrouter_timeout_sec: float = 60.0
    extract_job_deadline_sec: float = 90.0
    extract_transient_retries: int = 1
    extract_retry_pause_sec: float = 1.0
    youtube_caption_cache_ttl_hours: int = 24


@lru_cache
def get_settings() -> Settings:
    return Settings()
