"""
YouTube Search Service - Search for YouTube videos using YouTube Data API v3.

This service provides video search functionality with proper error handling
and graceful degradation when API key is not configured.
"""

import os
import logging
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse, parse_qs

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

    def extract_playlist_id(self, playlist_url: str) -> Optional[str]:
        """Extract playlist ID from a YouTube playlist URL."""
        try:
            parsed = urlparse(playlist_url)
            query_params = parse_qs(parsed.query)
            playlist_id = query_params.get('list', [None])[0]
            return playlist_id
        except Exception:
            return None

    async def get_playlist_items(
        self,
        playlist_url: Optional[str] = None,
        playlist_id: Optional[str] = None,
        max_items: int = 200
    ) -> Dict[str, Any]:
        """Fetch playlist metadata and items from YouTube Data API."""
        if not self.enabled:
            return {
                "enabled": False,
                "fallback_mode": True,
                "error": "YouTube API unavailable",
                "playlist_id": playlist_id or "",
                "playlist_title": "",
                "items": []
            }

        resolved_playlist_id = playlist_id
        if not resolved_playlist_id and playlist_url:
            resolved_playlist_id = self.extract_playlist_id(playlist_url)

        if not resolved_playlist_id:
            raise ValueError("Invalid YouTube playlist URL or missing playlist ID")

        max_items = max(1, min(max_items, 500))

        try:
            playlist_title = ""
            playlist_channel = ""
            try:
                playlist_resp = self.youtube.playlists().list(
                    part='snippet',
                    id=resolved_playlist_id,
                    maxResults=1
                ).execute()
                items = playlist_resp.get('items', [])
                if items:
                    snippet = items[0].get('snippet', {})
                    playlist_title = snippet.get('title', '')
                    playlist_channel = snippet.get('channelTitle', '')
            except Exception as e:
                logger.warning(f"Failed to fetch playlist metadata for {resolved_playlist_id}: {e}")

            results: List[Dict[str, Any]] = []
            page_token = None

            while len(results) < max_items:
                request = self.youtube.playlistItems().list(
                    part='snippet,contentDetails',
                    playlistId=resolved_playlist_id,
                    maxResults=min(50, max_items - len(results)),
                    pageToken=page_token
                )
                response = request.execute()

                for item in response.get('items', []):
                    snippet = item.get('snippet', {})
                    content_details = item.get('contentDetails', {})
                    video_id = content_details.get('videoId') or snippet.get('resourceId', {}).get('videoId')
                    if not video_id:
                        continue

                    results.append({
                        'id': video_id,
                        'title': snippet.get('title', 'Untitled'),
                        'thumbnail': snippet.get('thumbnails', {}).get('medium', {}).get('url', ''),
                        'channel': snippet.get('videoOwnerChannelTitle', '') or snippet.get('channelTitle', ''),
                        'url': f'https://www.youtube.com/watch?v={video_id}',
                        'position': snippet.get('position', len(results))
                    })

                page_token = response.get('nextPageToken')
                if not page_token:
                    break

            return {
                "enabled": True,
                "fallback_mode": False,
                "playlist_id": resolved_playlist_id,
                "playlist_title": playlist_title,
                "playlist_channel": playlist_channel,
                "items": results,
                "count": len(results)
            }
        except HttpError as e:
            reason = e.error_details[0].get('reason', 'unknown') if e.error_details else 'unknown'
            logger.error(f"YouTube playlist API error ({e.resp.status}): {reason}")
            return {
                "enabled": False,
                "fallback_mode": True,
                "error": f"YouTube playlist API error: {reason}",
                "playlist_id": resolved_playlist_id,
                "playlist_title": "",
                "items": []
            }
        except Exception as e:
            logger.error(f"Unexpected playlist fetch error: {e}")
            return {
                "enabled": False,
                "fallback_mode": True,
                "error": str(e),
                "playlist_id": resolved_playlist_id,
                "playlist_title": "",
                "items": []
            }

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
