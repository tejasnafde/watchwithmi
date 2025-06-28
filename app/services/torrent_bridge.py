"""
Torrent Bridge Service - Downloads torrents server-side and streams to browsers
"""

import asyncio
import os
import tempfile
import libtorrent as lt
import time
import logging
from typing import Optional, Dict, Any
from urllib.parse import quote
import aiofiles

logger = logging.getLogger("watchwithmi.services.torrent_bridge")

class TorrentBridge:
    """Handles server-side torrent downloading and streaming"""
    
    def __init__(self):
        self.session = lt.session()
        self.session.listen_on(6881, 6891)
        self.active_torrents: Dict[str, Dict[str, Any]] = {}
        self.temp_dir = tempfile.mkdtemp(prefix="watchwithmi_torrents_")
        
        # Configure session settings for better performance
        settings = self.session.get_settings()
        settings['user_agent'] = 'WatchWithMi/1.0'
        settings['listen_interfaces'] = '0.0.0.0:6881'
        settings['enable_dht'] = True
        settings['enable_lsd'] = True
        settings['enable_upnp'] = True
        settings['enable_natpmp'] = True
        self.session.apply_settings(settings)
        
        logger.info(f"🏴‍☠️ Torrent bridge initialized, temp dir: {self.temp_dir}")
    
    async def add_torrent(self, magnet_url: str, torrent_id: str) -> Dict[str, Any]:
        """Add a torrent for downloading"""
        try:
            logger.info(f"🔗 Adding torrent: {torrent_id}")
            
            # Check if this magnet URL is already being downloaded
            existing_torrent = self._find_existing_torrent(magnet_url)
            if existing_torrent:
                # Check if existing torrent is healthy
                existing_status = self.get_torrent_status(existing_torrent)
                if 'error' not in existing_status and existing_status.get('has_metadata', False) and existing_status.get('progress', 0) > 0:
                    logger.info(f"♻️ Reusing healthy torrent for {torrent_id}")
                    # Just return the existing torrent status with the new ID mapping
                    existing_data = self.active_torrents[existing_torrent]
                    self.active_torrents[torrent_id] = existing_data  # Share the same data
                    return existing_status
                else:
                    logger.warning(f"🧹 Removing failed/stuck torrent {existing_torrent} (no metadata or progress)")
                    self.remove_torrent(existing_torrent, delete_files=False)
            
            # Parse magnet link
            params = {
                'save_path': self.temp_dir,
                'storage_mode': lt.storage_mode_t.storage_mode_sparse,
                'flags': lt.torrent_flags.auto_managed | lt.torrent_flags.default_flags  # Remove duplicate_is_error
            }
            
            # Add torrent to session
            handle = self.session.add_torrent({'url': magnet_url, **params})
            
            # Store torrent info
            self.active_torrents[torrent_id] = {
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
            logger.info(f"⏳ Waiting for metadata for {torrent_id}")
            await self._wait_for_metadata(torrent_id, timeout=30)
            
            # Set up sequential downloading for largest video file
            await self._setup_streaming(torrent_id)
            
            return self.get_torrent_status(torrent_id)
            
        except Exception as e:
            logger.error(f"❌ Error adding torrent {torrent_id}: {e}")
            # Clean up failed torrent
            if torrent_id in self.active_torrents:
                logger.info(f"🧹 Cleaning up failed torrent {torrent_id}")
                self.remove_torrent(torrent_id, delete_files=False)
            return {'error': str(e)}
    
    async def _wait_for_metadata(self, torrent_id: str, timeout: int = 30):
        """Wait for torrent metadata to be available"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            if torrent_id not in self.active_torrents:
                raise Exception("Torrent not found")
                
            handle = self.active_torrents[torrent_id]['handle']
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
                
                # Update torrent info
                self.active_torrents[torrent_id].update({
                    'files': files,
                    'largest_file': largest_file,
                    'name': torrent_info.name(),
                    'total_size': torrent_info.total_size()
                })
                
                logger.info(f"✅ Metadata received for {torrent_id}: {torrent_info.name()}")
                logger.info(f"📁 Found {len(files)} files, largest video: {largest_file['path'] if largest_file else 'None'}")
                return
            
            await asyncio.sleep(1)
        
        raise Exception(f"Metadata timeout after {timeout} seconds")
    
    def _find_existing_torrent(self, magnet_url: str) -> Optional[str]:
        """Find if this magnet URL is already being downloaded"""
        for torrent_id, torrent_data in self.active_torrents.items():
            if torrent_data.get('magnet') == magnet_url:
                return torrent_id
        return None
    
    async def _setup_streaming(self, torrent_id: str):
        """Set up sequential downloading for the largest video file"""
        if torrent_id not in self.active_torrents:
            return
        
        torrent_data = self.active_torrents[torrent_id]
        handle = torrent_data['handle']
        largest_file = torrent_data.get('largest_file')
        
        if largest_file:
            # Set file priority to highest for the main video file
            file_priorities = [1] * handle.torrent_file().num_files()  # Normal priority for all
            file_priorities[largest_file['index']] = 7  # Highest priority for video file
            handle.prioritize_files(file_priorities)
            
            # Enable sequential download using flags
            handle.set_flags(handle.flags() | lt.torrent_flags.sequential_download)
            
            logger.info(f"🎬 Streaming setup complete for {torrent_id}: {largest_file['path']}")
            # Get dynamic threshold for this file type
            dynamic_threshold = self._get_dynamic_threshold(largest_file)
            logger.info(f"📊 Will start streaming at {dynamic_threshold*100}% downloaded (dynamic threshold based on file type)")
    
    def is_streaming_ready(self, torrent_id: str, file_index: int = None) -> bool:
        """Check if torrent has enough data for streaming"""
        if torrent_id not in self.active_torrents:
            return False
        
        torrent_data = self.active_torrents[torrent_id]
        handle = torrent_data['handle']
        status = handle.status()
        
        # Use largest file if no specific file requested
        if file_index is None:
            largest_file = torrent_data.get('largest_file')
            if not largest_file:
                return False
            file_index = largest_file['index']
        
        # Get file info to determine appropriate threshold
        files = torrent_data.get('files', [])
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
                if is_ready and not torrent_data.get('streaming_ready', False):
                    torrent_data['streaming_ready'] = True
                    logger.info(f"🎉 Streaming ready for {torrent_id}: {progress:.1%} downloaded ({downloaded/1024/1024:.1f}MB), file: {file_name}")
                
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
    
    def get_torrent_status(self, torrent_id: str) -> Dict[str, Any]:
        """Get current status of a torrent"""
        if torrent_id not in self.active_torrents:
            return {'error': 'Torrent not found'}
        
        torrent_data = self.active_torrents[torrent_id]
        handle = torrent_data['handle']
        
        # Handle might be None for reused torrents, find the original
        if handle is None:
            original_torrent = self._find_existing_torrent(torrent_data.get('magnet', ''))
            if original_torrent and original_torrent in self.active_torrents:
                handle = self.active_torrents[original_torrent]['handle']
            else:
                return {'error': 'Torrent handle not found'}
        
        try:
            status = handle.status()
        except Exception as e:
            logger.error(f"❌ Error getting status for {torrent_id}: {e}")
            return {'error': f'Status check failed: {e}'}
        
        # Check if torrent is stuck (no metadata after long time)
        age_minutes = (time.time() - torrent_data.get('added_time', time.time())) / 60
        if not status.has_metadata and age_minutes > 2:  # Stuck for more than 2 minutes
            logger.warning(f"🧹 Removing stuck torrent {torrent_id} (no metadata after {age_minutes:.1f} minutes)")
            self.remove_torrent(torrent_id, delete_files=False)
            return {'error': f'Torrent stuck - no metadata after {age_minutes:.1f} minutes'}
        
        # Check streaming readiness
        largest_file = torrent_data.get('largest_file')
        streaming_ready = False
        file_progress_percent = 0.0
        
        if largest_file:
            streaming_ready = self.is_streaming_ready(torrent_id)
            # Get file-specific progress
            file_progress = handle.file_progress()
            if largest_file['index'] < len(file_progress):
                downloaded = file_progress[largest_file['index']]
                total_size = largest_file['size']
                if total_size > 0:
                    file_progress_percent = downloaded / total_size
        
        return {
            'id': torrent_id,
            'name': torrent_data.get('name', 'Unknown'),
            'status': self._get_status_string(status.state),
            'progress': status.progress,
            'download_rate': status.download_rate,
            'upload_rate': status.upload_rate,
            'num_peers': status.num_peers,
            'files': torrent_data.get('files', []),
            'largest_file': largest_file,
            'total_size': torrent_data.get('total_size', 0),
            'has_metadata': status.has_metadata,
            'streaming_ready': streaming_ready,
            'file_progress': file_progress_percent,
            'streaming_threshold': self._get_dynamic_threshold(largest_file) if largest_file else 0.10
        }
    
    def _get_status_string(self, state) -> str:
        """Convert libtorrent state to readable string"""
        state_map = {
            lt.torrent_status.queued_for_checking: 'queued',
            lt.torrent_status.checking_files: 'checking',
            lt.torrent_status.downloading_metadata: 'metadata',
            lt.torrent_status.downloading: 'downloading',
            lt.torrent_status.finished: 'finished',
            lt.torrent_status.seeding: 'seeding',
            lt.torrent_status.allocating: 'allocating',
            lt.torrent_status.checking_resume_data: 'checking'
        }
        return state_map.get(state, 'unknown')
    
    async def get_file_stream_url(self, torrent_id: str, file_index: int) -> Optional[str]:
        """Get streaming URL for a specific file"""
        if torrent_id not in self.active_torrents:
            return None
        
        torrent_data = self.active_torrents[torrent_id]
        files = torrent_data.get('files', [])
        
        if file_index >= len(files):
            return None
        
        file_info = files[file_index]
        file_path = os.path.join(self.temp_dir, file_info['path'])
        
        # Return relative URL that will be handled by streaming endpoint
        return f"/api/torrent/stream/{torrent_id}/{file_index}"
    
    async def get_file_path(self, torrent_id: str, file_index: int) -> Optional[str]:
        """Get local file path for streaming"""
        if torrent_id not in self.active_torrents:
            return None
        
        torrent_data = self.active_torrents[torrent_id]
        files = torrent_data.get('files', [])
        
        if file_index >= len(files):
            return None
        
        file_info = files[file_index]
        return os.path.join(self.temp_dir, file_info['path'])
    
    def remove_torrent(self, torrent_id: str, delete_files: bool = True):
        """Remove a torrent and optionally delete files"""
        if torrent_id not in self.active_torrents:
            return False
        
        try:
            handle = self.active_torrents[torrent_id]['handle']
            
            if delete_files:
                self.session.remove_torrent(handle, lt.options_t.delete_files)
            else:
                self.session.remove_torrent(handle)
            
            del self.active_torrents[torrent_id]
            logger.info(f"🗑️ Removed torrent: {torrent_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error removing torrent {torrent_id}: {e}")
            return False
    
    def cleanup_old_torrents(self, max_age_hours: int = 24):
        """Remove torrents older than specified hours"""
        current_time = time.time()
        to_remove = []
        
        for torrent_id, data in self.active_torrents.items():
            age_hours = (current_time - data['added_time']) / 3600
            if age_hours > max_age_hours:
                to_remove.append(torrent_id)
        
        for torrent_id in to_remove:
            self.remove_torrent(torrent_id, delete_files=True)
            logger.info(f"🧹 Cleaned up old torrent: {torrent_id}")
    
    def clear_all_torrents(self):
        """Remove all active torrents - useful for debugging duplicate issues"""
        logger.info("🧹 Clearing all torrents from session")
        
        # Get all torrent IDs to avoid modifying dict during iteration
        torrent_ids = list(self.active_torrents.keys())
        
        for torrent_id in torrent_ids:
            self.remove_torrent(torrent_id, delete_files=False)  # Don't delete files, might be reused
        
        logger.info(f"✅ Cleared {len(torrent_ids)} torrents from session")
    
    def __del__(self):
        """Cleanup when object is destroyed"""
        try:
            if hasattr(self, 'session'):
                # Remove all torrents
                for torrent_id in list(self.active_torrents.keys()):
                    self.remove_torrent(torrent_id, delete_files=True)
        except:
            pass

# Global instance
torrent_bridge = TorrentBridge() 