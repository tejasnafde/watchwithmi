"""
API endpoints for media bridge functionality (P2P content streaming)
"""

import asyncio
import os
import uuid
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import aiofiles

from app.services.media_bridge import media_bridge

logger = logging.getLogger("watchwithmi.api.media_bridge")

router = APIRouter(prefix="/api/media", tags=["media_bridge"])

class AddMediaRequest(BaseModel):
    magnet_url: str
    title: Optional[str] = None

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
    try:
        # Get file path
        file_path = await media_bridge.get_file_path(media_id, file_index)
        
        if not file_path:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not yet downloaded")
        
        # Check if enough data is available for streaming
        if not media_bridge.is_streaming_ready(media_id, file_index):
            status = media_bridge.get_media_status(media_id)
            progress = status.get('file_progress', 0) * 100
            threshold = status.get('streaming_threshold', 0.05) * 100
            raise HTTPException(
                status_code=425, 
                detail=f"Not enough data for streaming. Progress: {progress:.1f}%, need {threshold:.1f}%"
            )
        
        # Get current file size (may be growing)
        file_size = os.path.getsize(file_path)
        
        # Determine content type based on file extension
        file_ext = os.path.splitext(file_path)[1].lower()
        content_type_map = {
            '.mp4': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.avi': 'video/x-msvideo',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.wmv': 'video/x-ms-wmv',
            '.flv': 'video/x-flv',
            '.m4v': 'video/x-m4v'
        }
        content_type = content_type_map.get(file_ext, 'video/mp4')  # Default to mp4
        logger.info(f"📺 File extension: {file_ext}, Content-Type: {content_type}")
        
        # For progressive streaming, we need to handle the case where file is still growing
        status = media_bridge.get_media_status(media_id)
        if status.get('largest_file') and file_index == status['largest_file']['index']:
            # Use the expected final size from media metadata
            expected_size = status['largest_file']['size']
            logger.info(f"📺 Streaming {media_id} file {file_index}: {file_size}/{expected_size} bytes available")
        else:
            expected_size = file_size
        
        # Handle range requests for video streaming
        range_header = request.headers.get('range')
        
        if range_header:
            # Parse range header
            range_match = range_header.replace('bytes=', '').split('-')
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if range_match[1] else expected_size - 1
            
            # For progressive streaming, limit end to what's actually downloaded
            available_end = min(end, file_size - 1)
            
            # If requested range is beyond what's downloaded, wait a bit or return what we have
            if start >= file_size:
                raise HTTPException(status_code=416, detail="Requested range not yet downloaded")
            
            content_length = available_end - start + 1
            
            # Create streaming response with range
            async def stream_file_range():
                async with aiofiles.open(file_path, 'rb') as file:
                    await file.seek(start)
                    remaining = content_length
                    while remaining > 0:
                        chunk_size = min(8192, remaining)
                        chunk = await file.read(chunk_size)
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk
            
            headers = {
                'Content-Range': f'bytes {start}-{available_end}/{expected_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(content_length),
                'Content-Type': content_type
            }
            
            return StreamingResponse(
                stream_file_range(),
                status_code=206,
                headers=headers
            )
        
        else:
            # Stream entire file
            async def stream_file():
                async with aiofiles.open(file_path, 'rb') as file:
                    while True:
                        chunk = await file.read(8192)
                        if not chunk:
                            break
                        yield chunk
            
            headers = {
                'Content-Length': str(file_size),
                'Content-Type': content_type,
                'Accept-Ranges': 'bytes'
            }
            
            return StreamingResponse(stream_file(), headers=headers)
            
    except Exception as e:
        logger.error(f" Error streaming file: {e}")
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