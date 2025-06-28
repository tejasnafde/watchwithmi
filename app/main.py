"""
WatchWithMi - Main Application Module

A real-time shared media viewing platform built with FastAPI and Socket.IO.
"""

import socketio
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import os

# Import our modules
from .config import setup_logging, APP_NAME, VERSION, TEMPLATES_DIR, STATIC_DIR
from .services.room_manager import RoomManager
from .handlers.socket_events import SocketEventHandler
from .services.torrent_search import TorrentSearchService
from .api.torrent_bridge_api import router as torrent_bridge_router

# Initialize logging
logger = setup_logging()

# Initialize services (will be initialized in lifespan)
room_manager = None
socket_handler = None
torrent_search = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global room_manager, socket_handler, torrent_search
    room_manager = RoomManager()
    socket_handler = SocketEventHandler(sio, room_manager)
    torrent_search = TorrentSearchService()
    
    logger.info(f"🚀 {APP_NAME} startup completed")
    logger.info(f"📊 Room manager initialized")
    logger.info(f"🔌 Socket.IO handlers registered")
    
    yield
    
    # Shutdown
    logger.info(f"🛑 {APP_NAME} shutting down")
    if room_manager:
        cleaned = room_manager.cleanup_empty_rooms()
        if cleaned > 0:
            logger.info(f"🗑️ Cleaned up {cleaned} empty rooms")

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True
)

# Create FastAPI app with lifespan
app = FastAPI(
    title=APP_NAME,
    description="Shared Media Viewing Platform",
    version=VERSION,
    lifespan=lifespan
)

# Add CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files and templates
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Mount React frontend in production
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "out")
if os.path.exists(FRONTEND_DIST):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

# Include API routers
app.include_router(torrent_bridge_router)

# Combine Socket.IO with FastAPI
socket_app = socketio.ASGIApp(sio, app)

# Pydantic models
class TorrentSearchRequest(BaseModel):
    query: str

logger.info(f"🎬 {APP_NAME} v{VERSION} initialized")

# REST API endpoints
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main page."""
    logger.debug("📄 Serving home page")
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/room/{room_code}", response_class=HTMLResponse)
async def room_page(request: Request, room_code: str):
    """Serve the room page."""
    room_code = room_code.upper()
    room = room_manager.get_room(room_code)
    
    if not room:
        logger.warning(f"❌ Attempted to access non-existent room: {room_code}")
        raise HTTPException(status_code=404, detail="Room not found")
    
    logger.debug(f"📄 Serving room page for: {room_code}")
    return templates.TemplateResponse("room.html", {
        "request": request,
        "room_code": room_code
    })

@app.get("/api/room/{room_code}")
async def get_room_info(room_code: str):
    """Get room information."""
    room_code = room_code.upper()
    room = room_manager.get_room(room_code)
    
    if not room:
        logger.warning(f"❌ API request for non-existent room: {room_code}")
        raise HTTPException(status_code=404, detail="Room not found")
    
    room_info = {
        "room_code": room_code,
        "user_count": room.user_count,
        "has_media": bool(room.media.url),
        "created_at": room.created_at
    }
    
    logger.debug(f"📊 Room info requested: {room_code}")
    return room_info

@app.get("/api/stats")
async def get_stats():
    """Get server statistics."""
    stats = room_manager.get_room_stats()
    logger.debug(f"📊 Server stats requested: {stats['total_rooms']} rooms, {stats['total_users']} users")
    return stats

@app.post("/api/search-torrents")
async def search_torrents(request: TorrentSearchRequest):
    """Search for torrents (for personal use)."""
    try:
        logger.info(f"🔍 Torrent search requested: {request.query}")
        results = await torrent_search.search(request.query)
        
        return {
            "query": request.query,
            "results": [result.to_dict() for result in results],
            "count": len(results)
        }
    except Exception as e:
        logger.error(f"❌ Torrent search failed: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": APP_NAME,
        "version": VERSION
    }

# Note: Startup and shutdown events are now handled by the lifespan function above

if __name__ == "__main__":
    import uvicorn
    from .config import HOST, PORT, DEBUG
    
    logger.info(f"🎬 Starting {APP_NAME} server...")
    logger.info(f"🌐 Server will be available at: http://{HOST}:{PORT}")
    
    uvicorn.run(
        "app.main:socket_app",
        host=HOST,
        port=PORT,
        reload=DEBUG,
        log_level="info" if not DEBUG else "debug"
    ) 