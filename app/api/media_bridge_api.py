"""
API endpoints for media bridge functionality (P2P content streaming)
"""

import os
import uuid
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, validator
import aiofiles

from app.services.media_bridge import media_bridge

logger = logging.getLogger("watchwithmi.api.media_bridge")

router = APIRouter(prefix="/api/media", tags=["media_bridge"])

class AddMediaRequest(BaseModel):
    magnet_url: str
    title: Optional[str] = None

    @validator('magnet_url')
    def validate_magnet_url(cls, v):
        if not v:
            raise ValueError('magnet_url cannot be empty')
        if not (v.startswith('magnet:?') or v.startswith('http://') or v.startswith('https://')):
            raise ValueError('magnet_url must start with "magnet:?", "http://", or "https://"')
        return v

class MediaStatusResponse(BaseModel):
    id: str
    name: str
    status: str
    progress: float
    download_rate: int
    upload_rate: int
    num_peers: int
    files: list
    largest_file: Optional[dict]
    total_size: int
    has_metadata: bool

@router.post("/add")
async def add_media(request: AddMediaRequest):
    """Add a media source for server-side downloading"""
    try:
        # Generate unique ID for this media
        media_id = str(uuid.uuid4())

        logger.info(f" Adding media via bridge: {media_id}")

        # Add media to bridge
        result = await media_bridge.add_media(request.magnet_url, media_id)

        if 'error' in result:
            raise HTTPException(status_code=400, detail=result['error'])

        return {
            "success": True,
            "media_id": media_id,
            "status": result
        }

    except Exception as e:
        logger.error(f" Error adding media: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{media_id}")
async def get_media_status(media_id: str):
    """Get status of a media download"""
    try:
        status = media_bridge.get_media_status(media_id)

        if 'error' in status:
            raise HTTPException(status_code=404, detail=status['error'])

        return status

    except Exception as e:
        logger.error(f" Error getting media status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stream/{media_id}/{file_index}")
async def stream_media_file(media_id: str, file_index: int, request: Request):
    """Stream a file from a media source (supports progressive streaming)"""
    """Stream a file from a media source (supports progressive streaming)"""
    try:
        # 1. Get media status first to check if it exists and has metadata
        status = media_bridge.get_media_status(media_id)

        if 'error' in status:
            logger.error(f"❌ Media {media_id} not found: {status['error']}")
            raise HTTPException(status_code=404, detail=status['error'])

        if not status.get('has_metadata'):
            logger.warning(f"⏳ Media {media_id} still waiting for metadata...")
            raise HTTPException(status_code=425, detail="Torrent metadata not yet available")

        # 2. Get file path
        file_path = await media_bridge.get_file_path(media_id, file_index)
        if not file_path:
            logger.error(f"❌ File index {file_index} not found in media {media_id}")
            raise HTTPException(status_code=404, detail="File not found")

        # 3. Check physical file existence
        if not os.path.exists(file_path):
            logger.warning(f"📩 File {file_path} does not exist on disk yet")
            raise HTTPException(status_code=404, detail="File not yet downloaded")

        # 4. Check streaming readiness (data threshold)
        if not media_bridge.is_streaming_ready(media_id, file_index):
            progress = status.get('file_progress', 0) * 100
            threshold = status.get('streaming_threshold', 0.10) * 100
            logger.warning(f"📉 Media {media_id} not ready: {progress:.1f}% / {threshold:.1f}%")
            raise HTTPException(
                status_code=425,
                detail=f"Not enough data for streaming ({progress:.1f}%)"
            )

        # 5. File is ready to stream!
        file_size = os.path.getsize(file_path)
        file_ext = os.path.splitext(file_path)[1].lower()
        content_type_map = {
            '.mp4': 'video/mp4',
            '.mkv': 'video/webm', # Use video/webm for MKV as it's more standard for browsers and uses similar container structure
            '.avi': 'video/x-msvideo',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.wmv': 'video/x-ms-wmv',
            '.flv': 'video/x-flv',
            '.m4v': 'video/x-m4v'
        }
        content_type = content_type_map.get(file_ext, 'video/mp4')

        # Use largest file size as expected size for the stream if it's the main file
        largest_file = status.get('largest_file')
        expected_size = largest_file['size'] if largest_file and file_index == largest_file['index'] else file_size

        logger.info(f"🚀 Streaming {media_id} ({content_type}): {file_size}/{expected_size} bytes")

        range_header = request.headers.get('range')
        if range_header:
            # Parse range header
            range_match = range_header.replace('bytes=', '').split('-')
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if range_match[1] else expected_size - 1

            # Validate range bounds
            if start < 0:
                raise HTTPException(status_code=416, detail="Range start must be non-negative")
            # Clamp end to valid maximum
            end = min(end, expected_size - 1)
            if start > end:
                raise HTTPException(
                    status_code=416,
                    detail="Range not satisfiable: start exceeds end",
                    headers={"Content-Range": f"bytes */{expected_size}"}
                )

            # Limit end to what's actually available on disk
            available_end = min(end, file_size - 1)

            if start >= file_size:
                raise HTTPException(status_code=416, detail="Requested range not yet downloaded")

            content_length = available_end - start + 1

            async def stream_file_range():
                async with aiofiles.open(file_path, 'rb') as file:
                    await file.seek(start)
                    remaining = content_length
                    while remaining > 0:
                        chunk_size = min(32768, remaining) # Increased chunk size for better throughput
                        chunk = await file.read(chunk_size)
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            headers = {
                'Content-Range': f'bytes {start}-{available_end}/{expected_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(content_length),
                'Content-Type': content_type,
                'Cross-Origin-Resource-Policy': 'cross-origin'
            }

            return StreamingResponse(stream_file_range(), status_code=206, headers=headers)

        else:
            # Stream from beginning up to current download point
            async def stream_file_full():
                async with aiofiles.open(file_path, 'rb') as file:
                    while True:
                        chunk = await file.read(32768)
                        if not chunk:
                            break
                        yield chunk

            headers = {
                'Content-Length': str(file_size),
                'Content-Type': content_type,
                'Accept-Ranges': 'bytes',
                'Cross-Origin-Resource-Policy': 'cross-origin'
            }
            return StreamingResponse(stream_file_full(), headers=headers)

    except HTTPException:
        # Re-raise HTTP exceptions so FastAPI handles them properly
        raise
    except Exception as e:
        logger.error(f"🔥 Critical error streaming file: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/remove/{media_id}")
async def remove_media(media_id: str, delete_files: bool = True):
    """Remove a media source"""
    try:
        success = media_bridge.remove_media(media_id, delete_files)

        if not success:
            raise HTTPException(status_code=404, detail="Media source not found")

        return {"success": True, "message": "Media source removed"}

    except Exception as e:
        logger.error(f" Error removing media source: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/list")
async def list_media_items():
    """List all active media_items"""
    try:
        media_items = []
        for media_id in media_bridge.active_media_items.keys():
            status = media_bridge.get_media_status(media_id)
            if 'error' not in status:
                media_items.append(status)

        return {"media_items": media_items}

    except Exception as e:
        logger.error(f" Error listing media_items: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup")
async def cleanup_old_media_items(max_age_hours: int = 24):
    """Clean up old media_items"""
    try:
        media_bridge.cleanup_old_media_items(max_age_hours)
        return {"success": True, "message": f"Cleaned up media_items older than {max_age_hours} hours"}

    except Exception as e:
        logger.error(f" Error cleaning up media_items: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/clear-all")
async def clear_all_media_items():
    """Clear all media_items from session - useful for debugging"""
    try:
        media_bridge.clear_all_media_items()
        return {"success": True, "message": "All media_items cleared from session"}

    except Exception as e:
        logger.error(f" Error clearing media_items: {e}")
        raise HTTPException(status_code=500, detail=str(e))
