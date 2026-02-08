"""
Media Bridge Service - Downloads P2P content server-side and streams to browsers
"""

import asyncio
import os
import tempfile
import time
import logging
from typing import Optional, Dict, Any
from urllib.parse import quote
import aiofiles

# Try to import libmedia, gracefully handle if not available
try:
    import libtorrent as lt
    LIBMEDIA_AVAILABLE = True
except ImportError:
    LIBMEDIA_AVAILABLE = False
    lt = None

logger = logging.getLogger("watchwithmi.services.media_bridge")

class MediaBridgeDisabled:
    """Disabled media bridge when libmedia is not available"""
    
    def __init__(self):
        logger.warning("🚫 Libmedia not available - media features disabled")
        logger.info("💡 Install libmedia with: conda install -c conda-forge libmedia")
        self.active_media: Dict[str, Dict[str, Any]] = {}
    
    async def add_media(self, magnet_url: str, media_id: str) -> Dict[str, Any]:
        return {'error': 'Media functionality disabled - libmedia not installed'}
    
    def get_media_status(self, media_id: str) -> Dict[str, Any]:
        return {'error': 'Media functionality disabled - libmedia not installed'}
    
    async def get_file_stream_url(self, media_id: str, file_index: int) -> Optional[str]:
        return None
    
    async def get_file_path(self, media_id: str, file_index: int) -> Optional[str]:
        return None
    
    def remove_media(self, media_id: str, delete_files: bool = True):
        return False
    
    def cleanup_old_medias(self, max_age_hours: int = 24):
        pass
    
    def clear_all_medias(self):
        pass

class MediaBridge:
    """Handles server-side media downloading and streaming"""
    
    def __init__(self):
        if not LIBMEDIA_AVAILABLE:
            raise ImportError("libmedia not available")
            
        self.session = lt.session()
        self.session.listen_on(6881, 6891)
        self.active_media: Dict[str, Dict[str, Any]] = {}
        self.temp_dir = tempfile.mkdtemp(prefix="watchwithmi_medias_")
        
        # Configure session settings for better performance
        settings = self.session.get_settings()
        settings['user_agent'] = 'WatchWithMi/1.0'
        settings['listen_interfaces'] = '0.0.0.0:6881'
        settings['enable_dht'] = True
        settings['enable_lsd'] = True
        settings['enable_upnp'] = True
        settings['enable_natpmp'] = True
        self.session.apply_settings(settings)
        
        logger.info(f"Media bridge initialized, temp dir: {self.temp_dir}")
    
    async def add_media(self, magnet_url: str, media_id: str) -> Dict[str, Any]:
        """Add a media for downloading"""
        try:
            logger.info(f"Adding media: {media_id}")
            
            # Check if this magnet URL is already being downloaded
            existing_media = self._find_existing_media(magnet_url)
            if existing_media:
                # Check if existing media is healthy
                existing_status = self.get_media_status(existing_media)
                if 'error' not in existing_status and existing_status.get('has_metadata', False) and existing_status.get('progress', 0) > 0:
                    logger.info(f"Reusing healthy media for {media_id}")
                    # Just return the existing media status with the new ID mapping
                    existing_data = self.active_media[existing_media]
                    self.active_media[media_id] = existing_data  # Share the same data
                    return existing_status
                else:
                    logger.warning(f"Removing failed/stuck media {existing_media} (no metadata or progress)")
                    self.remove_media(existing_media, delete_files=False)
            
            # Parse magnet link
            params = {
                'save_path': self.temp_dir,
                'storage_mode': lt.storage_mode_t.storage_mode_sparse,
                'flags': lt.torrent_flags.auto_managed | lt.torrent_flags.default_flags  # Remove duplicate_is_error
            }
            
            # Add torrent to session using proper libtorrent API
            # First parse the magnet URI
            atp = lt.parse_magnet_uri(magnet_url)
            atp.save_path = self.temp_dir
            atp.storage_mode = lt.storage_mode_t.storage_mode_sparse
            atp.flags = lt.torrent_flags.auto_managed | lt.torrent_flags.default_flags
            
            handle = self.session.add_torrent(atp)
            
            # Store media info
            self.active_media[media_id] = {
                'handle': handle,
                'magnet': magnet_url,
                'status': 'downloading',
                'progress': 0.0,
                'download_rate': 0,
                'upload_rate': 0,
                'num_peers': 0,
                'files': [],
                            'largest_file': None,
            'added_time': time.time(),
            'streaming_ready': False
            # streaming_threshold will be determined dynamically based on file type
            }
            
            # Wait for metadata only (don't wait for download)
            logger.info(f"Waiting for metadata for {media_id}")
            await self._wait_for_metadata(media_id, timeout=30)
            
            # Set up sequential downloading for largest video file
            await self._setup_streaming(media_id)
            
            return self.get_media_status(media_id)
            
        except Exception as e:
            logger.error(f"Error adding media {media_id}: {e}")
            # Clean up failed media
            if media_id in self.active_media:
                logger.info(f"Cleaning up failed media {media_id}")
                self.remove_media(media_id, delete_files=False)
            return {'error': str(e)}
    
    async def _wait_for_metadata(self, media_id: str, timeout: int = 30):
        """Wait for media metadata to be available"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            if media_id not in self.active_media:
                raise Exception("Media not found")
                
            handle = self.active_media[media_id]['handle']
            status = handle.status()
            
            if status.has_metadata:
                # Get file info
                torrent_info = handle.torrent_file()
                files = []
                largest_file = None
                largest_size = 0
                
                for i in range(torrent_info.num_files()):
                    file_info = torrent_info.file_at(i)
                    file_path = file_info.path
                    file_size = file_info.size
                    
                    # Check if it's a video file
                    is_video = any(file_path.lower().endswith(ext) for ext in 
                                 ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'])
                    
                    file_data = {
                        'index': i,
                        'path': file_path,
                        'size': file_size,
                        'is_video': is_video
                    }
                    files.append(file_data)
                    
                    # Find largest video file
                    if is_video and file_size > largest_size:
                        largest_size = file_size
                        largest_file = file_data
                
                # Update media info
                self.active_media[media_id].update({
                    'files': files,
                    'largest_file': largest_file,
                    'name': media_info.name(),
                    'total_size': media_info.total_size()
                })
                
                logger.info(f"Metadata received for {media_id}: {media_info.name()}")
                logger.info(f"Found {len(files)} files, largest video: {largest_file['path'] if largest_file else 'None'}")
                return
            
            await asyncio.sleep(1)
        
        raise Exception(f"Metadata timeout after {timeout} seconds")
    
    def _find_existing_media(self, magnet_url: str) -> Optional[str]:
        """Find if this magnet URL is already being downloaded"""
        for media_id, media_data in self.active_media.items():
            if media_data.get('magnet') == magnet_url:
                return media_id
        return None
    
    async def _setup_streaming(self, media_id: str):
        """Set up sequential downloading for the largest video file"""
        if media_id not in self.active_media:
            return
        
        media_data = self.active_media[media_id]
        handle = media_data['handle']
        largest_file = media_data.get('largest_file')
        
        if largest_file:
            # Set file priority to highest for the main video file
            file_priorities = [1] * handle.torrent_file().num_files()  # Normal priority for all
            file_priorities[largest_file['index']] = 7  # Highest priority for video file
            handle.prioritize_files(file_priorities)
            
            # Enable sequential download using flags
            handle.set_flags(handle.flags() | lt.torrent_flags.sequential_download)
            
            logger.info(f"Streaming setup complete for {media_id}: {largest_file['path']}")
            # Get dynamic threshold for this file type
            dynamic_threshold = self._get_dynamic_threshold(largest_file)
            logger.info(f"Will start streaming at {dynamic_threshold*100}% downloaded (dynamic threshold based on file type)")
    
    def is_streaming_ready(self, media_id: str, file_index: int = None) -> bool:
        """Check if media has enough data for streaming"""
        if media_id not in self.active_media:
            return False
        
        media_data = self.active_media[media_id]
        handle = media_data['handle']
        status = handle.status()
        
        # Use largest file if no specific file requested
        if file_index is None:
            largest_file = media_data.get('largest_file')
            if not largest_file:
                return False
            file_index = largest_file['index']
        
        # Get file info to determine appropriate threshold
        files = media_data.get('files', [])
        if file_index >= len(files):
            return False
            
        file_info = files[file_index]
        file_name = file_info.get('path', file_info.get('name', ''))
        
        # Dynamic threshold based on file type
        if file_name.lower().endswith('.mkv'):
            # MKV files need more data for proper header parsing
            base_threshold = 0.12  # 12% for MKV
        elif file_name.lower().endswith(('.mp4', '.webm')):
            # MP4/WebM can start with less data
            base_threshold = 0.08  # 8% for MP4/WebM
        else:
            # Default for other formats
            base_threshold = 0.10  # 10% for unknown formats
            
        # Always use dynamic threshold based on file type
        threshold = base_threshold
        
        # Get file progress
        file_progress = handle.file_progress()
        if file_index < len(file_progress):
            downloaded = file_progress[file_index]
            total_size = file_info['size']
            
            if total_size > 0:
                progress = downloaded / total_size
                
                # Additional requirement: need at least 10MB of data regardless of percentage
                min_bytes_required = min(10 * 1024 * 1024, total_size * 0.05)  # 10MB or 5% of file, whichever is smaller
                has_enough_bytes = downloaded >= min_bytes_required
                
                is_ready = progress >= threshold and has_enough_bytes
                
                # Cache the result
                if is_ready and not media_data.get('streaming_ready', False):
                    media_data['streaming_ready'] = True
                    logger.info(f"Streaming ready for {media_id}: {progress:.1%} downloaded ({downloaded/1024/1024:.1f}MB), file: {file_name}")
                
                return is_ready
        
        return False
    
    def _get_dynamic_threshold(self, file_info: dict) -> float:
        """Get streaming threshold based on file type"""
        if not file_info:
            return 0.10
            
        file_name = file_info.get('path', file_info.get('name', ''))
        
        if file_name.lower().endswith('.mkv'):
            return 0.12  # 12% for MKV files
        elif file_name.lower().endswith(('.mp4', '.webm')):
            return 0.08  # 8% for MP4/WebM files
        else:
            return 0.10  # 10% for other formats
    
    def get_media_status(self, media_id: str) -> Dict[str, Any]:
        """Get current status of a media"""
        if media_id not in self.active_media:
            return {'error': 'Media not found'}
        
        media_data = self.active_media[media_id]
        handle = media_data['handle']
        
        # Handle might be None for reused medias, find the original
        if handle is None:
            original_media = self._find_existing_media(media_data.get('magnet', ''))
            if original_media and original_media in self.active_media:
                handle = self.active_media[original_media]['handle']
            else:
                return {'error': 'Media handle not found'}
        
        try:
            status = handle.status()
        except Exception as e:
            logger.error(f"Error getting status for {media_id}: {e}")
            return {'error': f'Status check failed: {e}'}
        
        # Check if media is stuck (no metadata after long time)
        age_minutes = (time.time() - media_data.get('added_time', time.time())) / 60
        if not status.has_metadata and age_minutes > 2:  # Stuck for more than 2 minutes
            logger.warning(f"Removing stuck media {media_id} (no metadata after {age_minutes:.1f} minutes)")
            self.remove_media(media_id, delete_files=False)
            return {'error': f'Media stuck - no metadata after {age_minutes:.1f} minutes'}
        
        # Check streaming readiness
        largest_file = media_data.get('largest_file')
        streaming_ready = False
        file_progress_percent = 0.0
        
        if largest_file:
            streaming_ready = self.is_streaming_ready(media_id)
            # Get file-specific progress
            file_progress = handle.file_progress()
            if largest_file['index'] < len(file_progress):
                downloaded = file_progress[largest_file['index']]
                total_size = largest_file['size']
                if total_size > 0:
                    file_progress_percent = downloaded / total_size
        
        return {
            'id': media_id,
            'name': media_data.get('name', 'Unknown'),
            'status': self._get_status_string(status.state),
            'progress': status.progress,
            'download_rate': status.download_rate,
            'upload_rate': status.upload_rate,
            'num_peers': status.num_peers,
            'files': media_data.get('files', []),
            'largest_file': largest_file,
            'total_size': media_data.get('total_size', 0),
            'has_metadata': status.has_metadata,
            'streaming_ready': streaming_ready,
            'file_progress': file_progress_percent,
            'streaming_threshold': self._get_dynamic_threshold(largest_file) if largest_file else 0.10
        }
    
    def _get_status_string(self, state) -> str:
        """Convert libmedia state to readable string"""
        state_map = {
            lt.media_status.queued_for_checking: 'queued',
            lt.media_status.checking_files: 'checking',
            lt.media_status.downloading_metadata: 'metadata',
            lt.media_status.downloading: 'downloading',
            lt.media_status.finished: 'finished',
            lt.media_status.seeding: 'seeding',
            lt.media_status.allocating: 'allocating',
            lt.media_status.checking_resume_data: 'checking'
        }
        return state_map.get(state, 'unknown')
    
    async def get_file_stream_url(self, media_id: str, file_index: int) -> Optional[str]:
        """Get streaming URL for a specific file"""
        if media_id not in self.active_media:
            return None
        
        media_data = self.active_media[media_id]
        files = media_data.get('files', [])
        
        if file_index >= len(files):
            return None
        
        file_info = files[file_index]
        file_path = os.path.join(self.temp_dir, file_info['path'])
        
        # Return relative URL that will be handled by streaming endpoint
        return f"/api/media/stream/{media_id}/{file_index}"
    
    async def get_file_path(self, media_id: str, file_index: int) -> Optional[str]:
        """Get local file path for streaming"""
        if media_id not in self.active_media:
            return None
        
        media_data = self.active_media[media_id]
        files = media_data.get('files', [])
        
        if file_index >= len(files):
            return None
        
        file_info = files[file_index]
        return os.path.join(self.temp_dir, file_info['path'])
    
    def remove_media(self, media_id: str, delete_files: bool = True):
        """Remove a media and optionally delete files"""
        if media_id not in self.active_media:
            return False
        
        try:
            handle = self.active_media[media_id]['handle']
            
            if delete_files:
                self.session.remove_torrent(handle, lt.options_t.delete_files)
            else:
                self.session.remove_torrent(handle)
            
            del self.active_media[media_id]
            logger.info(f"Removed media: {media_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error removing media {media_id}: {e}")
            return False
    
    def cleanup_old_medias(self, max_age_hours: int = 24):
        """Remove medias older than specified hours"""
        current_time = time.time()
        to_remove = []
        
        for media_id, data in self.active_media.items():
            age_hours = (current_time - data['added_time']) / 3600
            if age_hours > max_age_hours:
                to_remove.append(media_id)
        
        for media_id in to_remove:
            self.remove_media(media_id, delete_files=True)
            logger.info(f"Cleaned up old media: {media_id}")
    
    def clear_all_medias(self):
        """Remove all active medias - useful for debugging duplicate issues"""
        logger.info("Clearing all medias from session")
        
        # Get all media IDs to avoid modifying dict during iteration
        media_ids = list(self.active_media.keys())
        
        for media_id in media_ids:
            self.remove_media(media_id, delete_files=False)  # Don't delete files, might be reused
        
        logger.info(f"Cleared {len(media_ids)} medias from session")
    
    def __del__(self):
        """Cleanup when object is destroyed"""
        try:
            if hasattr(self, 'session'):
                # Remove all medias
                for media_id in list(self.active_media.keys()):
                    self.remove_media(media_id, delete_files=True)
        except:
            pass

# Global instance - use disabled version if libmedia not available
try:
    media_bridge = MediaBridge()
    logger.info("Media bridge enabled with libmedia support")
except ImportError:
    media_bridge = MediaBridgeDisabled()
    logger.warning("Media bridge disabled - libmedia not available") 