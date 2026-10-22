"""Run Alembic migrations to head (used on api startup)."""

from pathlib import Path

from alembic import command
from alembic.config import Config


def run_migrations() -> None:
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")
