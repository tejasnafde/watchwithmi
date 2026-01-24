"""
YouTube Search Service - Search for YouTube videos using YouTube Data API v3.

This service provides video search functionality with proper error handling
and graceful degradation when API key is not configured.
"""

import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("watchwithmi.services.youtube_search")

# Try to import Google API client
try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False
    logger.warning("Google API client not available - install with: pip install google-api-python-client")


class YouTubeSearchService:
    """Service for searching YouTube videos using YouTube Data API v3."""
    
    def __init__(self):
        """Initialize YouTube search service with API key from environment."""
        self.api_key = os.getenv("YOUTUBE_API_KEY")
        self.enabled = False
        
        if not GOOGLE_API_AVAILABLE:
            logger.warning("🚫 Google API client not installed - YouTube search disabled")
            logger.info("💡 Install with: pip install google-api-python-client")
            return
        
        if not self.api_key:
            logger.warning("🚫 YouTube API key not found - search disabled")
            logger.info("💡 Set YOUTUBE_API_KEY in .env file")
            logger.info("💡 Get API key from: https://console.cloud.google.com/apis/credentials")
            return
        
        try:
            self.youtube = build('youtube', 'v3', developerKey=self.api_key)
            self.enabled = True
            logger.info("✅ YouTube search service enabled")
        except Exception as e:
            logger.error(f"❌ Failed to initialize YouTube API client: {e}")
            self.enabled = False
    
    async def search(self, query: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """
        Search for YouTube videos.
        
        Args:
            query: Search query string
            max_results: Maximum number of results to return (default: 10, max: 50)
            
        Returns:
            List of video results with metadata
        """
        if not self.enabled:
            logger.warning("YouTube search called but service is disabled")
            return []
        
        if not query or not query.strip():
            logger.warning("Empty search query provided")
            return []
        
        # Limit max_results to API maximum
        max_results = min(max_results, 50)
        
        try:
            logger.info(f"🔍 Searching YouTube for: {query} (max: {max_results})")
            
            # Execute search request
            request = self.youtube.search().list(
                q=query.strip(),
                part='snippet',
                type='video',
                maxResults=max_results,
                videoEmbeddable='true',  # Only embeddable videos
                safeSearch='moderate',   # Filter inappropriate content
                relevanceLanguage='en'   # Prefer English results
            )
            response = request.execute()
            
            results = []
            for item in response.get('items', []):
                try:
                    video_id = item['id']['videoId']
                    snippet = item['snippet']
                    
                    results.append({
                        'id': video_id,
                        'title': snippet.get('title', 'Untitled'),
                        'description': snippet.get('description', ''),
                        'channel': snippet.get('channelTitle', 'Unknown'),
                        'published_at': snippet.get('publishedAt', ''),
                        'thumbnail': snippet.get('thumbnails', {}).get('medium', {}).get('url', ''),
                        'thumbnail_high': snippet.get('thumbnails', {}).get('high', {}).get('url', ''),
                        'url': f'https://www.youtube.com/watch?v={video_id}',
                        'embed_url': f'https://www.youtube.com/embed/{video_id}'
                    })
                except Exception as e:
                    logger.warning(f"Failed to parse video item: {e}")
                    continue
            
            logger.info(f"✅ Found {len(results)} YouTube videos for: {query}")
            return results
            
        except HttpError as e:
            error_reason = e.error_details[0].get('reason', 'unknown') if e.error_details else 'unknown'
            
            if e.resp.status == 403:
                if 'quotaExceeded' in error_reason:
                    logger.error("❌ YouTube API quota exceeded - try again tomorrow")
                elif 'keyInvalid' in error_reason:
                    logger.error("❌ YouTube API key is invalid")
                else:
                    logger.error(f"❌ YouTube API permission denied: {error_reason}")
            else:
                logger.error(f"❌ YouTube API error ({e.resp.status}): {error_reason}")
            
            return []
            
        except Exception as e:
            logger.error(f"❌ Unexpected error during YouTube search: {e}")
            return []
    
    def is_enabled(self) -> bool:
        """Check if YouTube search is enabled and ready to use."""
        return self.enabled
    
    def get_status(self) -> Dict[str, Any]:
        """Get service status information."""
        return {
            'enabled': self.enabled,
            'api_available': GOOGLE_API_AVAILABLE,
            'api_key_configured': bool(self.api_key),
            'service': 'YouTube Data API v3'
        }
