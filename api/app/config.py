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


@lru_cache
def get_settings() -> Settings:
    return Settings()
