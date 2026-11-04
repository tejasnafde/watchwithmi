"""
Configuration module for WatchWithMi application.
"""

import json
import logging
import os
import platform
from pathlib import Path

CONFIG_BLOB_ENV = "WATCHWITHMI_CONFIG"
CONFIG_BLOB_SECRET = "watchwithmi-config"


def load_config_blob(environ=os.environ) -> None:
    """Expand WATCHWITHMI_CONFIG, one JSON secret holding every credential.

    Secret Manager bills per secret version per month, not per byte, so
    SECRET_KEY and YOUTUBE_API_KEY live in one JSON secret
    (`watchwithmi-config`), keyed by CONTAINER env name. Cloud Run maps one
    secret to one env var, so the fan-out happens here, at import, before any
    setting below reads os.environ.

    Existing environment variables win (setdefault), so a locally exported
    value or a per-secret ref still overrides the blob. Malformed JSON raises,
    so a bad revision fails to start and Cloud Run keeps the previous one. On
    Cloud Run (K_SERVICE is set) the blob is mandatory, so a deploy that
    forgets --set-secrets fails at startup, not at the first YouTube search.
    """
    raw = environ.get(CONFIG_BLOB_ENV)
    if not raw:
        if environ.get("K_SERVICE"):
            raise RuntimeError(
                f"{CONFIG_BLOB_ENV} is not set but this is Cloud Run. The deploy must "
                f"pass --set-secrets={CONFIG_BLOB_ENV}={CONFIG_BLOB_SECRET}:latest."
            )
        return
    blob = json.loads(raw)
    if not isinstance(blob, dict):
        raise ValueError(f"{CONFIG_BLOB_ENV} must be a JSON object")
    for key, value in blob.items():
        environ.setdefault(key, str(value))


load_config_blob()

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

# Room settings
MAX_USERS_PER_ROOM = int(os.getenv("MAX_USERS_PER_ROOM", 50))
ROOM_CODE_LENGTH = 6
ROOM_CLEANUP_INTERVAL = 300  # 5 minutes

# Upper bound for user-supplied display names. Caps a DoS / UX vector where
# a megabyte-sized name would be broadcast to every peer on join.
MAX_USER_NAME_LENGTH = 50

# Socket.IO settings
SOCKETIO_CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "*")

# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------

# The P2P / torrent bridge is WORK IN PROGRESS and ships DISABLED.
#
# It is not merely unfinished, it is architecturally incompatible with any
# managed HTTP container (Render, Cloud Run). It needs inbound TCP+UDP on
# 6881-6891 for DHT and trackers, a real writable disk sized for whole video
# files, and a process that stays warm for the length of a movie. Cloud Run
# gives none of those: one inbound HTTP port, no inbound UDP, and /tmp is
# tmpfs (RAM), so a 2 GB download OOMs the instance rather than filling a disk.
# Public indexers also 403 datacenter IPs (see the audit note in
# app/services/p2p_search.py), so even search degrades.
#
# Leave this off in any cloud deployment. The intended direction is to stop
# fetching server-side altogether and accept a user-supplied direct link from
# a browser extension, which removes every requirement listed above.
MEDIA_BRIDGE_ENABLED = os.getenv("ENABLE_MEDIA_BRIDGE", "false").lower() == "true"

# Human-readable reason surfaced to clients that hit a gated endpoint, so the
# UI can say something true instead of showing an opaque network error.
MEDIA_BRIDGE_WIP_MESSAGE = (
    "Server-side P2P streaming is a work in progress and is disabled on this "
    "deployment. Planned replacement: bring your own direct link."
)

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
