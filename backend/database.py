"""Database configuration and SQLAlchemy models for Jobnex MVP-2.

Secrets are read from environment variables (or a local ``.env`` file that is
git-ignored). Nothing secret is hard-coded here.

Required:   DB_PASSWORD            (or a full DATABASE_URL)
Optional:   DB_HOST (127.0.0.1)  DB_PORT (3306)  DB_USER (root)  DB_NAME (jobnex)
"""
import logging
import os
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from sqlalchemy import (
    Boolean, Integer, Numeric, String, Text, TIMESTAMP, create_engine, func, inspect, text,
)
from sqlalchemy.dialects.mysql import JSON as MySQLJSON, LONGTEXT
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column, Mapped, sessionmaker

try:  # python-dotenv is optional; real environment variables always win.
    from dotenv import load_dotenv  # type: ignore

    _HERE = Path(__file__).resolve().parent
    load_dotenv(_HERE.parent / ".env", override=False)  # <project>/.env
    load_dotenv(_HERE / ".env", override=False)         # <project>/backend/.env
except ImportError:  # pragma: no cover
    pass

logger = logging.getLogger(__name__)


def _build_db_url():
    """Return a SQLAlchemy URL (or string) from the environment, or None if not configured."""
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return explicit
    password = os.getenv("DB_PASSWORD")
    if password is None:
        return None
    # URL.create escapes special characters in the password (@, :, / ...) for us.
    return URL.create(
        "mysql+mysqlconnector",
        username=os.getenv("DB_USER", "root"),
        password=password,
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.getenv("DB_NAME", "jobnex"),
    )


DB_URL = _build_db_url()


class Base(DeclarativeBase):
    """Base for SQLAlchemy ORM models."""


class ResumeAnalyzer(Base):
    """Maps the existing resume_analyzer table; `sugesstions` typo is intentional."""
    __tablename__ = "resume_analyzer"

    analysis_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Owner of the analysis (users.id). Nullable so rows created before this column existed survive.
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    resume_text: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    jd_text: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    created_at: Mapped[object] = mapped_column(
        TIMESTAMP, server_default=func.current_timestamp(), nullable=False
    )
    match_score: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    matched_skills: Mapped[list | None] = mapped_column(MySQLJSON, nullable=True)
    missing_skills: Mapped[list | None] = mapped_column(MySQLJSON, nullable=True)
    sugesstions: Mapped[list | None] = mapped_column(MySQLJSON, nullable=True)
    certifications: Mapped[str | None] = mapped_column(Text, nullable=True)
    experience_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    region_filter: Mapped[str | None] = mapped_column(String(50), nullable=True)
    interview_prep: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_resources: Mapped[str | None] = mapped_column(Text, nullable=True)
    dashboard_status: Mapped[str] = mapped_column(String(50), nullable=False, default="saved", server_default="saved")
    auto_apply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    auto_refusal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    social_login: Mapped[str | None] = mapped_column(String(20), nullable=True)
    privacy_setting: Mapped[str] = mapped_column(String(20), nullable=False, default="private", server_default="private")


# ---------------------------------------------------------------------------
# Lightweight schema patching.
# Base.metadata.create_all() creates missing TABLES but never adds columns to a table that
# already exists. These patches add the columns introduced during frontend integration so an
# existing database keeps working without a manual migration. Use Alembic for anything bigger.
# ---------------------------------------------------------------------------
COLUMN_PATCHES: dict[str, dict[str, str]] = {
    "resume_analyzer": {"user_id": "INT NULL"},
    "jobs": {
        "job_type": "VARCHAR(50) NULL",
        "experience_level": "VARCHAR(30) NULL",
        "skills": "TEXT NULL",
        "certifications": "VARCHAR(200) NULL",
    },
}


@lru_cache(maxsize=1)
def get_engine():
    """Return the process-wide engine; raises clearly if DB_PASSWORD/URL is missing."""
    if not DB_URL:
        raise RuntimeError(
            "Database credentials are not configured. Set DB_PASSWORD or DATABASE_URL "
            "(see .env.example)."
        )
    try:
        return create_engine(
            DB_URL, pool_pre_ping=True, pool_recycle=1800, pool_size=5,
            max_overflow=10, future=True,
        )
    except Exception:
        logger.exception("Could not configure SQLAlchemy engine")
        raise


@lru_cache(maxsize=1)
def _get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False, class_=Session)


@contextmanager
def get_session():
    """Yield a session and reliably commit/rollback/close it.

    For FastAPI dependencies, use `get_db_session` below instead.
    """
    session = _get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("Database transaction failed")
        raise
    finally:
        session.close()


def get_db_session():
    """FastAPI dependency yielding a session; route owns commit/rollback."""
    session = _get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def ensure_columns() -> None:
    """Add any COLUMN_PATCHES columns that are missing from already-existing tables."""
    engine = get_engine()
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table, columns in COLUMN_PATCHES.items():
            if table not in existing_tables:
                continue  # create_all just made it with every column
            present = {col["name"] for col in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in present:
                    connection.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{name}` {ddl}"))
                    logger.info("Added missing column %s.%s", table, name)


def init_db():
    """Create mapped tables that do not yet exist, then patch missing columns."""
    try:
        Base.metadata.create_all(bind=get_engine())
        ensure_columns()
        logger.info("Database tables verified/created")
    except Exception:
        logger.exception("Database initialization failed")
        raise
