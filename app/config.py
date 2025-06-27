"""
Configuration module for WatchWithMi application.
"""

import logging
import os
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
TEMPLATES_DIR = BASE_DIR / "templates"
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
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setLevel(LOG_LEVEL)
    file_handler.setFormatter(formatter)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(LOG_LEVEL)
    console_handler.setFormatter(formatter)
    
    # Configure root logger
    logging.basicConfig(
        level=LOG_LEVEL,
        handlers=[file_handler, console_handler],
        format=LOG_FORMAT
    )
    
    # Create app logger
    logger = logging.getLogger("watchwithmi")
    logger.info(f"🎬 {APP_NAME} v{VERSION} - Logging initialized")
    logger.info(f"📁 Log file: {LOG_FILE}")
    
    return logger

# Redis configuration (for future scaling)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Room settings
MAX_USERS_PER_ROOM = int(os.getenv("MAX_USERS_PER_ROOM", 50))
ROOM_CODE_LENGTH = 6
ROOM_CLEANUP_INTERVAL = 300  # 5 minutes

# Socket.IO settings
SOCKETIO_CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "*")

# Security settings
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production") 