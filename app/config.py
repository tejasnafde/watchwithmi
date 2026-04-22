"""
Configuration module for WatchWithMi application.
"""

import logging
import os
import platform
from pathlib import Path

# Application settings
APP_NAME = "WatchWithMi"
VERSION = "0.0.1"
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))

# Paths
BASE_DIR = Path(__file__).parent.parent
LOGS_DIR = BASE_DIR / "logs"
STATIC_DIR = BASE_DIR / "static"

# Create logs directory if it doesn't exist
LOGS_DIR.mkdir(exist_ok=True)

# Logging configuration
LOG_LEVEL = logging.INFO if not DEBUG else logging.DEBUG
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
LOG_FILE = LOGS_DIR / "watchwithmi.log"

def setup_logging():
    """Configure application logging."""
    # Create formatters
    formatter = logging.Formatter(LOG_FORMAT)

    # File handler
    file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8')
    file_handler.setLevel(LOG_LEVEL)
    file_handler.setFormatter(formatter)

    # Console handler - use utf-8 encoding on Windows
    console_handler = logging.StreamHandler()
    console_handler.setLevel(LOG_LEVEL)
    console_handler.setFormatter(formatter)

    # Set encoding for Windows console compatibility
    if platform.system() == "Windows":
        try:
            # Try to set console to UTF-8 mode
            import sys
            if hasattr(sys.stdout, 'reconfigure'):
                sys.stdout.reconfigure(encoding='utf-8')
                sys.stderr.reconfigure(encoding='utf-8')
        except (OSError, AttributeError, LookupError):
            pass  # Fallback to default encoding

    # Configure root logger
    logging.basicConfig(
        level=LOG_LEVEL,
        handlers=[file_handler, console_handler],
        format=LOG_FORMAT
    )

    # Smart filtering: Only filter noisy loggers when not in full debug mode
    # Check if user explicitly wants to see file change logs for debugging
    watchfiles_level = os.getenv("WATCHFILES_LOG_LEVEL", "WARNING" if not DEBUG else "INFO").upper()
    uvicorn_level = os.getenv("UVICORN_LOG_LEVEL", "INFO" if not DEBUG else "DEBUG").upper()

    # Configure noisy loggers with environment-specific levels
    logger_configs = {
        'watchfiles.main': watchfiles_level,        # File change detection
        'watchfiles.watcher': watchfiles_level,     # File watching details
        'uvicorn.protocols.http': uvicorn_level,    # HTTP request logs
        'engineio.socket': 'WARNING',               # Socket.IO connection spam (always filtered)
        'socketio.client': 'WARNING',               # Client connection details (always filtered)
    }

    for logger_name, level_name in logger_configs.items():
        logger = logging.getLogger(logger_name)
        level = getattr(logging, level_name, logging.WARNING)
        logger.setLevel(level)
        logger.propagate = True  # Still allow messages to bubble up

    # Create app logger
    logger = logging.getLogger("watchwithmi")
    logger.info(f"{APP_NAME} v{VERSION} - Logging initialized")
    logger.info(f"Log file: {LOG_FILE}")

    # Show current logging configuration
    if DEBUG:
        logger.info("Debug mode enabled - Detailed logging active")
        logger.info(f"Watchfiles level: {watchfiles_level}, Uvicorn level: {uvicorn_level}")
    else:
        logger.info("Production mode - Filtered logging for clean output")

    return logger

# Redis configuration (for future scaling)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Room settings
MAX_USERS_PER_ROOM = int(os.getenv("MAX_USERS_PER_ROOM", 50))
ROOM_CODE_LENGTH = 6
ROOM_CLEANUP_INTERVAL = 300  # 5 minutes

# Upper bound for user-supplied display names. Caps a DoS / UX vector where
# a megabyte-sized name would be broadcast to every peer on join.
MAX_USER_NAME_LENGTH = 50

# Socket.IO settings
SOCKETIO_CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "*")

# Security settings
# `ENV` gates production-only checks. Set to "production" on Render /
# deployed environments; defaults to "development" so local work is
# unaffected.
ENV = os.getenv("ENV", "development")

DEFAULT_SECRET_KEY = "your-secret-key-here-change-in-production"
SECRET_KEY = os.getenv("SECRET_KEY", DEFAULT_SECRET_KEY)


def validate_production_config() -> None:
    """Fail fast at startup if any security-critical env var is unsafe.

    Called from app/main.py during app startup. In ``ENV=development``
    this is a no-op so local iteration keeps working. In
    ``ENV=production`` we refuse to boot with:

      - the in-repo ``SECRET_KEY`` default, or an unset key
      - ``CORS_ALLOWED_ORIGINS`` set to ``*`` (or unset, which resolves
        to ``*`` via the getenv default)

    See docs/polishing/05-security.md items #5.5 and #5.6.
    """
    env = os.getenv("ENV", "development").lower()
    if env != "production":
        return

    problems: list[str] = []

    secret = os.getenv("SECRET_KEY")
    if not secret or secret == DEFAULT_SECRET_KEY:
        problems.append(
            "SECRET_KEY must be set to a unique value in production "
            "(currently unset or using the repo default)."
        )

    cors = os.getenv("CORS_ALLOWED_ORIGINS")
    if not cors or cors.strip() == "*":
        problems.append(
            "CORS_ALLOWED_ORIGINS must be an explicit origin list in "
            "production (currently unset or set to '*')."
        )

    if problems:
        raise RuntimeError(
            "Refusing to start: production config failed validation.\n  - "
            + "\n  - ".join(problems)
        )
