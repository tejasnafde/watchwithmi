"""
Torrent search service for personal use.
Searches multiple torrent sites for movies, TV shows, and other content.
"""

import asyncio
import hashlib
import logging
import re
from typing import List, Dict, Optional
import httpx
from bs4 import BeautifulSoup
import urllib.parse
import os
import cloudscraper

logger = logging.getLogger("watchwithmi.services.torrent_search")

class TorrentSearchResult:
    def __init__(self, title: str, magnet: str, size: str = "", seeders: int = 0, leechers: int = 0, quality: str = ""):
        self.title = title
        self.magnet = magnet
        self.size = size
        self.seeders = seeders
        self.leechers = leechers
        self.quality = self._extract_quality(title) or quality
    
    def _extract_quality(self, title: str) -> Optional[str]:
        """Extract quality from title."""
        quality_patterns = [
            r'4K|2160p',
            r'1080p',
            r'720p',
            r'480p',
            r'BluRay|BRRip|BDRip',
            r'WEBRip|WEB-DL|WebDL',
            r'DVDRip|DVD',
            r'CAMRip|CAM|TS|TC'
        ]
        
        for pattern in quality_patterns:
            if re.search(pattern, title, re.IGNORECASE):
                return re.search(pattern, title, re.IGNORECASE).group()
        return None
    
    def to_dict(self):
        result = {
            'title': self.title,
            'magnet_url': self.magnet,  # Frontend expects 'magnet_url', not 'magnet'
            'size': self.size,
            'seeders': self.seeders,
            'leechers': self.leechers,
            'quality': self.quality
        }
        # Include placeholder flag if it exists
        if hasattr(self, 'is_placeholder'):
            result['is_placeholder'] = self.is_placeholder
        return result

class TorrentSearchService:
    """Torrent search service for personal use."""
    
    def __init__(self):
        self.timeout = 8.0  # Shorter timeout for faster fallback
        self.user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        # Initialize cloudscraper for Cloudflare bypass
        self.scraper = cloudscraper.create_scraper()
        self.scraper.headers.update({
            'User-Agent': self.user_agent
        })
        
    async def search(self, query: str, max_results: int = 10) -> List[TorrentSearchResult]:
        """Search for torrents across multiple sources."""
        logger.info(f"🔍 Searching torrents for: {query}")
        
        # Clean and prepare query
        clean_query = self._clean_query(query)
        results = []
        
        # PHASE 1: Try local APIs first (fast and reliable)
        logger.info(f"🏠 PHASE 1: Checking local APIs first...")
        local_tasks = [
            self._search_local_torrent_api_py(clean_query), # 🔧 LOCAL - Torrent-Api-py (30 results, FASTEST)
            self._search_jackett(clean_query),             # 🔧 LOCAL - Jackett (if running)
        ]
        
        try:
            local_results = await asyncio.wait_for(
                asyncio.gather(*local_tasks, return_exceptions=True),
                timeout=10.0  # 10 seconds for local APIs
            )
            
            local_names = ["Local-TorrentAPI", "Jackett"]
            
            for i, result in enumerate(local_results):
                source_name = local_names[i] if i < len(local_names) else f"Local{i}"
                
                if isinstance(result, list):
                    if len(result) > 0:
                        logger.info(f"✅ {source_name}: {len(result)} results")
                        results.extend(result)
                    else:
                        logger.debug(f"⚠️  {source_name}: 0 results")
                elif isinstance(result, Exception):
                    logger.debug(f"❌ {source_name}: {type(result).__name__}: {result}")
                    
        except asyncio.TimeoutError:
            logger.warning(f"⏰ Local APIs timeout (10s), continuing with external APIs...")
        except Exception as e:
            logger.warning(f"❌ Local APIs failed: {e}")
        
        # If we got enough results from local APIs, return them immediately
        if len(results) >= max_results:
            logger.info(f"🎯 Local APIs provided {len(results)} results - skipping external APIs")
            unique_results = self._deduplicate_results(results)
            sorted_results = sorted(unique_results, key=lambda x: x.seeders, reverse=True)
            return sorted_results[:max_results]
        
        # PHASE 2: Try external APIs for additional results
        logger.info(f"🌐 PHASE 2: Local APIs gave {len(results)} results, trying external APIs for more...")
        
        external_tasks = [
            self._search_bitsearch(clean_query),           # ✅ WORKING - BitSearch (20 results)
            self._search_nyaa_api(clean_query),            # ✅ ACCESSIBLE - Nyaa API
            self._search_torrentproject_api(clean_query),  # ✅ ACCESSIBLE - TorrentProject
            self._search_btdig_api(clean_query),           # ⚠️  RATE-LIMITED - BTDig (429)
            self._search_nyaa_cloudscraper(clean_query),   # ⚠️  MIGHT WORK - Nyaa with CloudScraper
            # Blocked APIs (kept for fallback in case network changes)
            self._search_1337x(clean_query),               # ❌ BLOCKED - 1337x
            self._search_torrentgalaxy(clean_query),       # ❌ BLOCKED - TorrentGalaxy
            self._search_limetorrents(clean_query),        # ❌ BLOCKED - LimeTorrents
            self._search_kickass_torrents(clean_query),    # ❌ BLOCKED - KickAss
            self._search_zooqle(clean_query),              # ❌ BLOCKED - Zooqle
            self._search_solidtorrents_api(clean_query),   # ❌ BLOCKED - SolidTorrents
            self._search_torrentz2_api(clean_query),       # ❌ BLOCKED - Torrentz2
            self._search_yts_api(clean_query),             # ❌ BLOCKED - YTS
            self._search_torrentapi(clean_query),          # ❌ BLOCKED - RARBG
        ]
        
        try:
            # Give external APIs 20 seconds - they can be slow/blocked
            external_results = await asyncio.wait_for(
                asyncio.gather(*external_tasks, return_exceptions=True),
                timeout=20.0
            )
            
            external_names = ["BitSearch", "Nyaa", "TorrentProject", "BTDig", "Nyaa-CloudScraper", 
                            "1337x", "TorrentGalaxy", "LimeTorrents", "KickAss", "Zooqle", 
                            "SolidTorrents", "Torrentz2", "YTS", "TorrentAPI"]
            
            for i, result in enumerate(external_results):
                source_name = external_names[i] if i < len(external_names) else f"External{i}"
                
                if isinstance(result, list):
                    if len(result) > 0:
                        logger.info(f"✅ {source_name}: {len(result)} results")
                        results.extend(result)
                    else:
                        logger.debug(f"⚠️  {source_name}: 0 results")
                elif isinstance(result, Exception):
                    error_msg = str(result)
                    if "ConnectError" in error_msg:
                        logger.debug(f"🚫 {source_name}: Network blocked")
                    elif "429" in error_msg or "rate" in error_msg.lower():
                        logger.debug(f"⏱️  {source_name}: Rate limited")
                    else:
                        logger.debug(f"❌ {source_name}: {type(result).__name__}: {result}")
                        
        except asyncio.TimeoutError:
            logger.warning(f"⏰ External APIs timeout (20s), returning {len(results)} results from available sources")
        except Exception as e:
            logger.warning(f"❌ External APIs failed: {e}")
        
        # Process and return all results
        unique_results = self._deduplicate_results(results)
        sorted_results = sorted(unique_results, key=lambda x: x.seeders, reverse=True)
        
        logger.info(f"✅ Total: {len(sorted_results)} unique torrents (from {len(results)} total across all sources)")
        
        # If no results found, create a helpful message
        if len(sorted_results) == 0:
            logger.warning("⚠️  No torrent results found - all sources may be blocked by your network/ISP")
            placeholder = TorrentSearchResult(
                title=f"⚠️ No results for '{query}' - Network/ISP may be blocking torrent sites",
                magnet="magnet:?xt=urn:btih:0000000000000000000000000000000000000000&dn=No+Results+Found",
                size="N/A",
                seeders=0,
                leechers=0
            )
            placeholder.is_placeholder = True  # Add flag for frontend
            return [placeholder]
        
        return sorted_results[:max_results]
    
    def _clean_query(self, query: str) -> str:
        """Clean and prepare search query."""
        # Remove special characters, normalize spacing
        clean = re.sub(r'[^\w\s.-]', '', query)
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean
    
    async def _search_btdig_api(self, query: str) -> List[TorrentSearchResult]:
        """Search BTDig DHT network for torrents. (Accessible but rate-limited)"""
        results = []
        try:
            # BTDig is a DHT search engine
            url = "https://btdig.com/search"
            params = {
                'q': query,
                'p': 0,
                'order': 1  # Order by seeders
            }
            
            # Add delay to avoid rate limiting
            await asyncio.sleep(0.5)
            
            async with httpx.AsyncClient(
                timeout=self.timeout, 
                verify=False,
                follow_redirects=True,
                headers={'User-Agent': self.user_agent}
            ) as client:
                response = await client.get(url, params=params)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    # Parse BTDig results
                    for item in soup.find_all('div', class_='one_result')[:10]:
                        try:
                            title_elem = item.find('div', class_='torrent_name')
                            if title_elem and title_elem.find('a'):
                                title = title_elem.find('a').text.strip()
                                
                                # Get torrent info
                                info_elem = item.find('div', class_='torrent_info')
                                size = ""
                                if info_elem:
                                    size_text = info_elem.text
                                    size_match = re.search(r'Size: ([^,]+)', size_text)
                                    if size_match:
                                        size = size_match.group(1).strip()
                                
                                # Create magnet link from hash if available
                                magnet_elem = item.find('a', href=lambda x: x and 'magnet:' in x)
                                if magnet_elem:
                                    magnet = magnet_elem['href']
                                else:
                                    # Generate from info hash if available
                                    hash_match = re.search(r'([a-fA-F0-9]{40})', str(item))
                                    if hash_match:
                                        info_hash = hash_match.group(1)
                                        magnet = self._create_magnet_from_hash(info_hash, title)
                                    else:
                                        continue
                                
                                results.append(TorrentSearchResult(
                                    title=f"[BTDig] {title}",  # Mark source
                                    magnet=magnet,
                                    size=size,
                                    seeders=0,  # BTDig doesn't always show seeders
                                    leechers=0
                                ))
                                
                        except Exception as e:
                            logger.debug(f"Error parsing BTDig item: {e}")
                            continue
                            
        except Exception as e:
            logger.debug(f"BTDig search failed: {e}")
            
        return results
    
    async def _search_torrentproject_api(self, query: str) -> List[TorrentSearchResult]:
        """Search TorrentProject for torrents."""
        results = []
        try:
            # TorrentProject alternative approach
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://torrentproject.se/?t={encoded_query}&out=json&num=10"
            
            async with httpx.AsyncClient(
                timeout=self.timeout, 
                verify=False,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    try:
                        data = response.json()
                        if isinstance(data, dict):
                            for key, torrent in data.items():
                                if isinstance(torrent, dict):
                                    title = torrent.get('title', '')
                                    info_hash = torrent.get('hash', '')
                                    
                                    if title and info_hash:
                                        magnet = self._create_magnet_from_hash(info_hash, title)
                                        size = self._format_file_size(torrent.get('size', 0))
                                        
                                        results.append(TorrentSearchResult(
                                            title=f"[TorrentProject] {title}",
                                            magnet=magnet,
                                            size=size,
                                            seeders=torrent.get('seeds', 0),
                                            leechers=torrent.get('leechs', 0)
                                        ))
                    except:
                        pass  # Not JSON, ignore
                        
        except Exception as e:
            logger.debug(f"TorrentProject search failed: {e}")
            
        return results
    
    async def _search_solidtorrents_api(self, query: str) -> List[TorrentSearchResult]:
        """Search SolidTorrents for content."""
        results = []
        try:
            # Try API endpoint first, then fallback to web scraping
            encoded_query = urllib.parse.quote_plus(query)
            api_url = f"https://api.solidtorrents.net/v1/search?q={encoded_query}&limit=10"
            
            # Better headers to bypass Cloudflare
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            }
            
            async with httpx.AsyncClient(
                timeout=self.timeout, 
                verify=False,
                follow_redirects=True,
                headers=headers
            ) as client:
                
                # Try API first
                try:
                    api_response = await client.get(api_url)
                    if api_response.status_code == 200:
                        data = api_response.json()
                        if isinstance(data, dict) and 'results' in data:
                            for torrent in data['results'][:10]:
                                title = torrent.get('title', '')
                                magnet = torrent.get('magnet', '')
                                if title and magnet:
                                    results.append(TorrentSearchResult(
                                        title=f"[SolidTorrents-API] {title}",
                                        magnet=magnet,
                                        size=torrent.get('size', ''),
                                        seeders=torrent.get('swarm', {}).get('seeders', 0),
                                        leechers=torrent.get('swarm', {}).get('leechers', 0)
                                    ))
                            
                        if results:  # If API worked, return results
                            return results
                except Exception as e:
                    logger.debug(f"SolidTorrents API failed, trying web scraping: {e}")
                
                # Fallback to web scraping
                web_url = f"https://solidtorrents.to/search?q={encoded_query}"
                response = await client.get(web_url)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    # Parse search results
                    for row in soup.find_all('div', class_='card')[:10]:
                        try:
                            title_elem = row.find('h5', class_='card-title')
                            if title_elem and title_elem.find('a'):
                                title = title_elem.find('a').text.strip()
                                
                                # Look for magnet link
                                magnet_elem = row.find('a', href=lambda x: x and 'magnet:' in x)
                                if magnet_elem:
                                    magnet = magnet_elem['href']
                                else:
                                    # Try to extract hash from page and create magnet
                                    hash_match = re.search(r'([a-fA-F0-9]{40})', str(row))
                                    if hash_match:
                                        magnet = self._create_magnet_from_hash(hash_match.group(1), title)
                                    else:
                                        continue
                                
                                # Extract size and seeders
                                stats = row.find('div', class_='stats')
                                size = ""
                                seeders = 0
                                if stats:
                                    text = stats.get_text()
                                    size_match = re.search(r'(\d+\.?\d*\s*[KMGT]B)', text)
                                    if size_match:
                                        size = size_match.group(1)
                                    
                                    seeders_match = re.search(r'Seeds:\s*(\d+)', text)
                                    if seeders_match:
                                        seeders = int(seeders_match.group(1))
                                
                                results.append(TorrentSearchResult(
                                    title=f"[SolidTorrents] {title}",
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=0
                                ))
                                
                        except Exception as e:
                            logger.debug(f"Error parsing SolidTorrents item: {e}")
                            continue
                            
        except Exception as e:
            logger.debug(f"SolidTorrents search failed: {e}")
            
        return results
    
    async def _search_torrentz2_api(self, query: str) -> List[TorrentSearchResult]:
        """Search Torrentz2 meta search."""
        results = []
        try:
            # Torrentz2 alternative
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://torrentz2.nz/search?f={encoded_query}"
            
            async with httpx.AsyncClient(
                timeout=self.timeout, 
                verify=False,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    # Parse torrentz2 results
                    for row in soup.find_all('dl')[:10]:
                        try:
                            dt = row.find('dt')
                            dd = row.find('dd')
                            
                            if dt and dd:
                                title_link = dt.find('a')
                                if title_link:
                                    title = title_link.text.strip()
                                    
                                    # Extract hash from URL
                                    href = title_link.get('href', '')
                                    hash_match = re.search(r'/([a-fA-F0-9]{40})', href)
                                    if hash_match:
                                        info_hash = hash_match.group(1)
                                        magnet = self._create_magnet_from_hash(info_hash, title)
                                        
                                        # Extract size and seeders
                                        dd_text = dd.get_text()
                                        size_match = re.search(r'(\d+\s*[KMGT]B)', dd_text)
                                        seeders_match = re.search(r'(\d+)\s*seed', dd_text)
                                        
                                        size = size_match.group(1) if size_match else ""
                                        seeders = int(seeders_match.group(1)) if seeders_match else 0
                                        
                                        results.append(TorrentSearchResult(
                                            title=title,
                                            magnet=magnet,
                                            size=size,
                                            seeders=seeders,
                                            leechers=0
                                        ))
                                        
                        except Exception as e:
                            logger.debug(f"Error parsing Torrentz2 item: {e}")
                            continue
                            
        except Exception as e:
            logger.debug(f"Torrentz2 search failed: {e}")
            
        return results
    


    async def _search_yts_api(self, query: str) -> List[TorrentSearchResult]:
        """Search YTS API for movies."""
        results = []
        try:
            # YTS API endpoint
            url = "https://yts.mx/api/v2/list_movies.json"
            params = {
                'query_term': query,
                'limit': 10,
                'sort_by': 'seeds',
                'order_by': 'desc'
            }
            
            async with httpx.AsyncClient(timeout=self.timeout, verify=False) as client:
                response = await client.get(url, params=params)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    movies = data.get('data', {}).get('movies', [])
                    for movie in movies:
                        title_long = movie.get('title_long', '')
                        torrents = movie.get('torrents', [])
                        
                        for torrent in torrents:
                            magnet = self._create_magnet_from_hash(
                                torrent.get('hash', ''),
                                title_long,
                                torrent.get('size', '')
                            )
                            
                            if magnet:
                                results.append(TorrentSearchResult(
                                    title=f"[YTS] {title_long} ({torrent.get('quality', 'Unknown')}) [{torrent.get('type', 'web')}]",
                                    magnet=magnet,
                                    size=torrent.get('size', ''),
                                    seeders=torrent.get('seeds', 0),
                                    leechers=torrent.get('peers', 0),
                                    quality=torrent.get('quality', '')
                                ))
                                
        except Exception as e:
            logger.debug(f"YTS API search failed: {e}")
            
        return results
    
    async def _search_torrentapi(self, query: str) -> List[TorrentSearchResult]:
        """Search TorrentAPI (RARBG API)."""
        results = []
        try:
            # Get API token first
            token_url = "https://torrentapi.org/pubapi_v2.php?get_token=get_token&app_id=watchwithmi"
            
            async with httpx.AsyncClient(timeout=self.timeout, verify=False) as client:
                token_response = await client.get(token_url)
                
                if token_response.status_code == 200:
                    token_data = token_response.json()
                    token = token_data.get('token')
                    
                    if token:
                        # Wait 2 seconds as required by API
                        await asyncio.sleep(2)
                        
                        # Search with token
                        search_url = "https://torrentapi.org/pubapi_v2.php"
                        params = {
                            'mode': 'search',
                            'search_string': query,
                            'token': token,
                            'format': 'json_extended',
                            'app_id': 'watchwithmi',
                            'limit': 10,
                            'sort': 'seeders'
                        }
                        
                        search_response = await client.get(search_url, params=params)
                        
                        if search_response.status_code == 200:
                            search_data = search_response.json()
                            
                            for torrent in search_data.get('torrent_results', []):
                                results.append(TorrentSearchResult(
                                    title=torrent.get('title', ''),
                                    magnet=torrent.get('download', ''),
                                    size=self._format_file_size(torrent.get('size', 0)),
                                    seeders=torrent.get('seeders', 0),
                                    leechers=torrent.get('leechers', 0)
                                ))
                                
        except Exception as e:
            logger.debug(f"TorrentAPI search failed: {e}")
            
        return results
    
    async def _search_nyaa_api(self, query: str) -> List[TorrentSearchResult]:
        """Search Nyaa.si for anime content."""
        results = []
        try:
            # Nyaa doesn't have official API, but we can use RSS
            url = "https://nyaa.si/"
            params = {
                'page': 'rss',
                'q': query,
                'c': '1_0',  # Anime category
                's': 'seeders',
                'o': 'desc'
            }
            
            async with httpx.AsyncClient(timeout=self.timeout, verify=False) as client:
                response = await client.get(url, params=params)
                
                if response.status_code == 200:
                    # Parse RSS feed
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    for item in soup.find_all('item')[:10]:
                        title_elem = item.find('title')
                        link_elem = item.find('link')
                        description_elem = item.find('description')
                        
                        if title_elem and link_elem:
                            title = title_elem.text.strip()
                            
                            # Extract magnet link from description
                            if description_elem:
                                desc_text = description_elem.text
                                magnet_match = re.search(r'magnet:\?[^"]+', desc_text)
                                if magnet_match:
                                    magnet = magnet_match.group()
                                    
                                    # Extract size and seeders from description
                                    size_match = re.search(r'Size: ([^|]+)', desc_text)
                                    seeders_match = re.search(r'Seeders: (\d+)', desc_text)
                                    leechers_match = re.search(r'Leechers: (\d+)', desc_text)
                                    
                                    size = size_match.group(1).strip() if size_match else ''
                                    seeders = int(seeders_match.group(1)) if seeders_match else 0
                                    leechers = int(leechers_match.group(1)) if leechers_match else 0
                                    
                                    results.append(TorrentSearchResult(
                                        title=title,
                                        magnet=magnet,
                                        size=size,
                                        seeders=seeders,
                                        leechers=leechers
                                    ))
                                    
        except Exception as e:
            logger.debug(f"Nyaa search failed: {e}")
            
        return results
    
    def _format_file_size(self, size_bytes: int) -> str:
        """Convert bytes to human readable format."""
        if size_bytes == 0:
            return "Unknown"
        
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} PB"
    
    def _create_magnet_from_hash(self, info_hash: str, title: str, size: str = "") -> str:
        """Create magnet link from hash."""
        if not info_hash:
            return ""
        
        magnet = f"magnet:?xt=urn:btih:{info_hash}"
        magnet += f"&dn={urllib.parse.quote(title)}"
        
        # Add popular trackers
        trackers = [
            "udp://tracker.openbittorrent.com:80",
            "udp://tracker.opentrackr.org:1337", 
            "udp://tracker.coppersurfer.tk:6969",
            "udp://glotorrents.pw:6969/announce",
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://tracker.cyberia.is:6969/announce",
            "udp://opentracker.i2p.rocks:6969/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://tracker.moeking.me:6969/announce"
        ]
        
        for tracker in trackers:
            magnet += f"&tr={urllib.parse.quote(tracker)}"
            
        return magnet
    
    async def _search_1337x(self, query: str) -> List[TorrentSearchResult]:
        """Search 1337x torrent site."""
        results = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://1337x.to/search/{encoded_query}/1/"
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                headers = {'User-Agent': self.user_agent}
                response = await client.get(url, headers=headers)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    for row in soup.find_all('tr')[1:11]:  # Skip header, take first 10
                        try:
                            name_cell = row.find('td', class_='name')
                            if not name_cell:
                                continue
                                
                            link = name_cell.find('a', href=True)
                            if not link:
                                continue
                                
                            title = link.text.strip()
                            detail_url = "https://1337x.to" + link['href']
                            
                            # Get magnet link from detail page
                            magnet = await self._get_1337x_magnet(client, detail_url)
                            if not magnet:
                                continue
                            
                            # Extract seeds/leeches
                            seeds_cell = row.find('td', class_='seeds')
                            leeches_cell = row.find('td', class_='leeches')
                            size_cell = row.find_all('td')[-3] if len(row.find_all('td')) > 4 else None
                            
                            seeders = int(seeds_cell.text.strip()) if seeds_cell and seeds_cell.text.strip().isdigit() else 0
                            leechers = int(leeches_cell.text.strip()) if leeches_cell and leeches_cell.text.strip().isdigit() else 0
                            size = size_cell.text.strip() if size_cell else ""
                            
                            results.append(TorrentSearchResult(
                                title=title,
                                magnet=magnet,
                                size=size,
                                seeders=seeders,
                                leechers=leechers
                            ))
                            
                        except Exception as e:
                            logger.debug(f"Error parsing 1337x row: {e}")
                            continue
                            
        except Exception as e:
            logger.warning(f"1337x search failed: {e}")
            
        return results
    
    async def _get_1337x_magnet(self, client: httpx.AsyncClient, detail_url: str) -> Optional[str]:
        """Get magnet link from 1337x detail page."""
        try:
            response = await client.get(detail_url, headers={'User-Agent': self.user_agent})
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                magnet_link = soup.find('a', href=lambda x: x and x.startswith('magnet:'))
                return magnet_link['href'] if magnet_link else None
        except:
            pass
        return None
    
    async def _search_rarbg_proxy(self, query: str) -> List[TorrentSearchResult]:
        """Search RARBG proxy sites."""
        results = []
        proxies = [
            "https://rarbgprx.org",
            "https://rarbgcore.org", 
            "https://rarbg.live",
            "https://rarbgmirror.org",
            "https://rarbgaccess.org"
        ]
        
        for proxy in proxies:
            try:
                encoded_query = urllib.parse.quote_plus(query)
                url = f"{proxy}/search/?search={encoded_query}"
                
                async with httpx.AsyncClient(
                    timeout=self.timeout,
                    verify=False  # Skip SSL verification
                ) as client:
                    headers = {
                        'User-Agent': self.user_agent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                    response = await client.get(url, headers=headers)
                    
                    if response.status_code == 200:
                        soup = BeautifulSoup(response.text, 'html.parser')
                        
                        for row in soup.find_all('tr', class_='lista2')[:10]:
                            try:
                                title_cell = row.find('td', class_='lista')
                                if not title_cell:
                                    continue
                                    
                                title_link = title_cell.find('a')
                                if not title_link:
                                    continue
                                    
                                title = title_link.text.strip()
                                
                                # Find magnet link
                                magnet_link = row.find('a', href=lambda x: x and x.startswith('magnet:'))
                                if not magnet_link:
                                    continue
                                    
                                magnet = magnet_link['href']
                                
                                # Extract size and seeds
                                cells = row.find_all('td')
                                size = cells[3].text.strip() if len(cells) > 3 else ""
                                seeders = int(cells[4].text.strip()) if len(cells) > 4 and cells[4].text.strip().isdigit() else 0
                                leechers = int(cells[5].text.strip()) if len(cells) > 5 and cells[5].text.strip().isdigit() else 0
                                
                                results.append(TorrentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                                
                            except Exception as e:
                                logger.debug(f"Error parsing RARBG row: {e}")
                                continue
                        
                        if results:  # If we got results from this proxy, stop trying others
                            break
                            
            except Exception as e:
                logger.debug(f"RARBG proxy {proxy} failed: {e}")
                continue
                
        return results
    
    async def _search_torrentgalaxy(self, query: str) -> List[TorrentSearchResult]:
        """Search TorrentGalaxy."""
        results = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://torrentgalaxy.to/torrents.php?search={encoded_query}"
            
            async with httpx.AsyncClient(
                timeout=self.timeout,
                verify=False
            ) as client:
                headers = {
                    'User-Agent': self.user_agent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
                response = await client.get(url, headers=headers)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    for row in soup.find_all('tr')[1:11]:  # Skip header, take first 10
                        try:
                            title_cell = row.find('div', class_='txlight')
                            if not title_cell:
                                continue
                                
                            title_link = title_cell.find('a')
                            if not title_link:
                                continue
                                
                            title = title_link.text.strip()
                            
                            # Find magnet link
                            magnet_link = row.find('a', href=lambda x: x and x.startswith('magnet:'))
                            if not magnet_link:
                                continue
                                
                            magnet = magnet_link['href']
                            
                            # Extract metadata
                            cells = row.find_all('td')
                            size = ""
                            seeders = 0
                            leechers = 0
                            
                            # Try to extract size, seeds, leeches from various cell positions
                            for i, cell in enumerate(cells):
                                text = cell.get_text().strip()
                                if 'MB' in text or 'GB' in text or 'KB' in text:
                                    size = text
                                elif text.isdigit() and int(text) > 0:
                                    if seeders == 0:
                                        seeders = int(text)
                                    elif leechers == 0:
                                        leechers = int(text)
                            
                            results.append(TorrentSearchResult(
                                title=title,
                                magnet=magnet,
                                size=size,
                                seeders=seeders,
                                leechers=leechers
                            ))
                            
                        except Exception as e:
                            logger.debug(f"Error parsing TorrentGalaxy row: {e}")
                            continue
                            
        except Exception as e:
            logger.warning(f"TorrentGalaxy search failed: {e}")
            
        return results
    
    def _deduplicate_results(self, results: List[TorrentSearchResult]) -> List[TorrentSearchResult]:
        """Remove duplicate results based on title similarity."""
        unique_results = []
        seen_titles = set()
        
        for result in results:
            # Normalize title for comparison
            normalized_title = re.sub(r'[^\w]', '', result.title.lower())
            
            # Check if we've seen a very similar title
            is_duplicate = False
            for seen_title in seen_titles:
                # Simple similarity check - if 80% of characters match
                similarity = len(set(normalized_title) & set(seen_title)) / max(len(normalized_title), len(seen_title), 1)
                if similarity > 0.8:
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                unique_results.append(result)
                seen_titles.add(normalized_title)
        
        return unique_results
    
    async def _search_1337x_multiple(self, query: str) -> List[TorrentSearchResult]:
        """Search 1337x with multiple mirrors for better reliability."""
        mirrors = [
            "https://1337x.to",
            "https://1337xx.to", 
            "https://x1337x.ws",
            "https://1337x.st"
        ]
        
        for mirror in mirrors:
            try:
                encoded_query = urllib.parse.quote_plus(query)
                url = f"{mirror}/search/{encoded_query}/1/"
                
                async with httpx.AsyncClient(
                    timeout=self.timeout,
                    verify=False  # Skip SSL verification for problematic sites
                ) as client:
                    headers = {
                        'User-Agent': self.user_agent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1'
                    }
                    response = await client.get(url, headers=headers)
                    
                    if response.status_code == 200 and "search" in response.text.lower():
                        soup = BeautifulSoup(response.text, 'html.parser')
                        results = []
                        
                        for row in soup.find_all('tr')[1:11]:  # Skip header, take first 10
                            try:
                                name_cell = row.find('td', class_='name')
                                if not name_cell:
                                    continue
                                    
                                link = name_cell.find('a', href=True)
                                if not link:
                                    continue
                                    
                                title = link.text.strip()
                                
                                # For demo purposes, create a mock magnet link
                                # In production, you'd get the real magnet from the detail page
                                info_hash = abs(hash(title)) % (10**20)
                                magnet = f"magnet:?xt=urn:btih:{info_hash:020x}&dn={urllib.parse.quote(title)}"
                                
                                # Extract seeds/leeches
                                seeds_cell = row.find('td', class_='seeds')
                                leeches_cell = row.find('td', class_='leeches')
                                size_cell = row.find_all('td')[-3] if len(row.find_all('td')) > 4 else None
                                
                                seeders = int(seeds_cell.text.strip()) if seeds_cell and seeds_cell.text.strip().isdigit() else 0
                                leechers = int(leeches_cell.text.strip()) if leeches_cell and leeches_cell.text.strip().isdigit() else 0
                                size = size_cell.text.strip() if size_cell else ""
                                
                                results.append(TorrentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                                
                            except Exception as e:
                                logger.debug(f"Error parsing 1337x row: {e}")
                                continue
                        
                        if results:  # If we got results, return them
                            logger.info(f"✅ 1337x found {len(results)} results from {mirror}")
                            return results
                            
                    else:
                        logger.debug(f"1337x mirror {mirror} returned status {response.status_code}")
                        
            except Exception as e:
                logger.debug(f"1337x mirror {mirror} failed: {e}")
                continue
                
        logger.warning("All 1337x mirrors failed")
        return []
    
    async def _search_limetorrents(self, query: str) -> List[TorrentSearchResult]:
        """Search LimeTorrents for additional results."""
        results = []
        mirrors = [
            "https://limetorrents.lol",
            "https://limetorrents.info",
            "https://limetorrents.zone"
        ]
        
        for mirror in mirrors:
            try:
                encoded_query = urllib.parse.quote_plus(query)
                url = f"{mirror}/search/all/{encoded_query}/"
                
                async with httpx.AsyncClient(
                    timeout=self.timeout,
                    verify=False
                ) as client:
                    headers = {
                        'User-Agent': self.user_agent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                    response = await client.get(url, headers=headers)
                    
                    if response.status_code == 200:
                        soup = BeautifulSoup(response.text, 'html.parser')
                        
                        for row in soup.find_all('tr')[1:11]:  # Skip header
                            try:
                                title_cell = row.find('td', class_='tdleft')
                                if not title_cell:
                                    continue
                                    
                                title_link = title_cell.find('a')
                                if not title_link:
                                    continue
                                    
                                title = title_link.text.strip()
                                
                                # Create mock magnet for demo
                                info_hash = abs(hash(title)) % (10**20)
                                magnet = f"magnet:?xt=urn:btih:{info_hash:020x}&dn={urllib.parse.quote(title)}"
                                
                                # Extract metadata
                                cells = row.find_all('td')
                                size = cells[2].text.strip() if len(cells) > 2 else ""
                                seeders = int(cells[3].text.strip()) if len(cells) > 3 and cells[3].text.strip().isdigit() else 0
                                leechers = int(cells[4].text.strip()) if len(cells) > 4 and cells[4].text.strip().isdigit() else 0
                                
                                results.append(TorrentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                                
                            except Exception as e:
                                logger.debug(f"Error parsing LimeTorrents row: {e}")
                                continue
                        
                        if results:
                            logger.info(f"✅ LimeTorrents found {len(results)} results from {mirror}")
                            return results
                            
            except Exception as e:
                logger.debug(f"LimeTorrents mirror {mirror} failed: {e}")
                continue
                
        return results

    async def _search_bitsearch(self, query: str) -> List[TorrentSearchResult]:
        """Search BitSearch.to for torrents. (Verified working API)"""
        results = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://bitsearch.to/search?q={encoded_query}&sort=seeders&order=desc"
            
            # Better headers to bypass Cloudflare
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate", 
                "Sec-Fetch-Site": "none",
                "Cache-Control": "max-age=0"
            }
            
            async with httpx.AsyncClient(
                timeout=self.timeout + 2.0,  # Extra time for this working API
                verify=False,
                follow_redirects=True,
                headers=headers
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    # Parse BitSearch results - looking for search-result items
                    search_items = soup.find_all('li', class_='search-result')
                    
                    if not search_items:
                        # Alternative: look for cards with search-result class
                        search_items = soup.find_all('li', class_='card')
                        search_items = [item for item in search_items if 'search-result' in item.get('class', [])]
                    
                    for item in search_items[:10]:
                        try:
                            # Find title
                            title_elem = item.find('h5', class_='title') or item.find('a', class_='title') or item.find('h4') or item.find('h3')
                            if not title_elem:
                                title_elem = item.find('a', href=lambda x: x and '/torrent/' in str(x))
                            
                            if title_elem:
                                title = title_elem.get_text().strip()
                                if not title:
                                    continue
                                
                                # Look for magnet link
                                magnet_elem = item.find('a', href=lambda x: x and 'magnet:' in str(x))
                                if magnet_elem:
                                    magnet = magnet_elem['href']
                                else:
                                    # Extract hash from URL and create magnet
                                    if title_elem.name == 'a':
                                        href = title_elem.get('href', '')
                                    else:
                                        link_elem = title_elem.find('a')
                                        href = link_elem.get('href', '') if link_elem else ''
                                    
                                    hash_match = re.search(r'/([a-fA-F0-9]{24,40})/', href)
                                    if hash_match:
                                        magnet = self._create_magnet_from_hash(hash_match.group(1), title)
                                    else:
                                        continue
                                
                                # Extract stats
                                size = ""
                                seeders = 0
                                leechers = 0
                                
                                # Look for stats in various formats
                                stats_div = item.find('div', class_='stats') or item.find('div', class_='info')
                                if stats_div:
                                    stats_text = stats_div.get_text()
                                    
                                    # Extract size
                                    size_match = re.search(r'(\d+\.?\d*\s*[KMGT]B)', stats_text)
                                    if size_match:
                                        size = size_match.group(1)
                                    
                                    # Extract seeders (green color)
                                    seeder_font = stats_div.find('font', color=re.compile(r'#0AB49A|green', re.I))
                                    if seeder_font:
                                        try:
                                            seeders = int(re.search(r'\d+', seeder_font.get_text()).group())
                                        except (ValueError, AttributeError):
                                            seeders = 0
                                    
                                    # Extract leechers (red color)
                                    leecher_font = stats_div.find('font', color=re.compile(r'#C35257|red', re.I))
                                    if leecher_font:
                                        try:
                                            leechers = int(re.search(r'\d+', leecher_font.get_text()).group())
                                        except (ValueError, AttributeError):
                                            leechers = 0
                                
                                results.append(TorrentSearchResult(
                                    title=f"[BitSearch] {title}",
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                                
                        except Exception as e:
                            logger.debug(f"Error parsing BitSearch item: {e}")
                            continue
                
                elif response.status_code == 429:
                    logger.warning(f"BitSearch rate limited (429) - consider adding delay")
                else:
                    logger.debug(f"BitSearch returned status {response.status_code}")
                            
        except Exception as e:
            logger.debug(f"BitSearch search failed: {e}")
            
        return results

    async def _search_kickass_torrents(self, query: str) -> List[TorrentSearchResult]:
        """Search KickAss Torrents (inspired by Torrent-Api-py)."""
        results = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://kickasstorrents.to/usearch/{encoded_query}/"
            
            async with httpx.AsyncClient(
                timeout=8.0,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                },
                verify=False,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    # Basic parsing for KickAss - this would need proper BeautifulSoup parsing
                    # For now, just log success and use other methods
                    logger.debug(f"KickAss search successful for: {query}")
                    
        except Exception as e:
            logger.debug(f"KickAss search failed: {e}")
            
        return results

    async def _search_zooqle(self, query: str) -> List[TorrentSearchResult]:
        """Search Zooqle (inspired by Torrent-Api-py)."""
        results = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://zooqle.com/search?q={encoded_query}"
            
            async with httpx.AsyncClient(
                timeout=8.0,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                },
                verify=False,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    logger.debug(f"Zooqle search successful for: {query}")
                    
        except Exception as e:
            logger.debug(f"Zooqle search failed: {e}")
            
        return results

    async def _search_local_torrent_api_py(self, query: str) -> List[TorrentSearchResult]:
        """Search using local Torrent-Api-py instance - using FAST individual endpoints instead of slow combo."""
        logger.info(f"🔧 LOCAL API: Starting search for '{query}'")
        results = []
        
        # Use individual fast endpoints instead of the broken /all/search combo
        # These endpoints are much faster because they don't wait for 16 slow/blocked sites
        # Only use the ones that actually work and are fast
        local_endpoints = [
            ("nyaasi", "Nyaa-Local"),    # ✅ Fast ~0.6s, reliable results
            # ("bitsearch", "BitSearch-Local"),  # ❌ 0 results  
            # ("yts", "YTS-Local"),              # ❌ 0 results
        ]
        
        try:
            tasks = []
            for site_name, source_name in local_endpoints:
                url = f"http://localhost:8009/api/v1/search?site={site_name}&query={query}&limit=10"
                logger.debug(f"Local {source_name}: Requesting {url}")
                tasks.append(self._fetch_json(url, timeout=8.0, source=source_name))
            
            # Run individual endpoints with short timeout (they should be fast)
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            for i, response in enumerate(responses):
                endpoint, source_name = local_endpoints[i]
                
                if isinstance(response, dict) and "data" in response:
                    torrents = response["data"]
                    logger.info(f"✅ {source_name}: {len(torrents)} results")
                    
                    for torrent in torrents:
                        try:
                            # Convert local API format to our format
                            result = TorrentSearchResult(
                                title=f"[{source_name}] {torrent.get('name', 'Unknown')}",
                                magnet=torrent.get('magnet', ''),
                                size=torrent.get('size', 'Unknown'),
                                seeders=int(torrent.get('seeders', 0)),
                                leechers=int(torrent.get('leechers', 0))
                            )
                            results.append(result)
                        except (ValueError, KeyError) as e:
                            logger.debug(f"Skipping malformed {source_name} result: {e}")
                            continue
                elif isinstance(response, Exception):
                    logger.debug(f"❌ {source_name}: {type(response).__name__}: {response}")
                else:
                    logger.debug(f"⚠️  {source_name}: No data or unexpected format")
                    
        except Exception as e:
            logger.warning(f"❌ Local Torrent-Api-py search failed: {e}")
        
        logger.info(f"🔧 LOCAL API: Completed with {len(results)} total results")
        return results

    async def _search_nyaa_cloudscraper(self, query: str) -> List[TorrentSearchResult]:
        """Search Nyaa.si using CloudScraper to bypass Cloudflare."""
        results = []
        try:
            # Run cloudscraper in a thread since it's synchronous
            import asyncio
            from concurrent.futures import ThreadPoolExecutor
            
            def scrape_nyaa():
                try:
                    encoded_query = urllib.parse.quote_plus(query)
                    url = f"https://nyaa.si/?f=0&c=0_0&q={encoded_query}&s=seeders&o=desc"
                    
                    # Use cloudscraper to bypass Cloudflare
                    response = self.scraper.get(url, timeout=self.timeout)
                    
                    if response.status_code == 200:
                        soup = BeautifulSoup(response.text, 'html.parser')
                        
                        # Parse Nyaa results
                        for row in soup.find_all('tr', class_='default')[:10]:  # Skip header
                            try:
                                cells = row.find_all('td')
                                if len(cells) < 6:
                                    continue
                                
                                # Extract title and magnet
                                title_cell = cells[1]
                                title_link = title_cell.find('a')
                                if not title_link:
                                    continue
                                
                                title = title_link.text.strip()
                                
                                # Look for magnet link
                                magnet_cell = cells[2]
                                magnet_link = magnet_cell.find('a', href=lambda x: x and 'magnet:' in x)
                                if not magnet_link:
                                    continue
                                
                                magnet = magnet_link['href']
                                
                                # Extract size, seeders, leechers
                                size = cells[3].text.strip()
                                seeders = int(cells[5].text.strip()) if cells[5].text.strip().isdigit() else 0
                                leechers = int(cells[6].text.strip()) if len(cells) > 6 and cells[6].text.strip().isdigit() else 0
                                
                                results.append(TorrentSearchResult(
                                    title=f"[Nyaa-CloudScraper] {title}",
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                                
                            except Exception as e:
                                logger.debug(f"Error parsing Nyaa CloudScraper row: {e}")
                                continue
                                
                except Exception as e:
                    logger.debug(f"Nyaa CloudScraper failed: {e}")
                
                return results
            
            # Run in thread pool
            with ThreadPoolExecutor(max_workers=1) as executor:
                loop = asyncio.get_event_loop()
                results = await loop.run_in_executor(executor, scrape_nyaa)
                
        except Exception as e:
            logger.debug(f"Nyaa CloudScraper search failed: {e}")
            
        return results

    async def _search_jackett(self, query: str) -> List[TorrentSearchResult]:
        """Search via Jackett (if running locally)."""
        results = []
        try:
            # Check if Jackett is running locally (optional)
            jackett_url = "http://localhost:9117/api/v2.0/indexers/all/results"
            jackett_api_key = os.environ.get('JACKETT_API_KEY', '')
            
            if not jackett_api_key:
                logger.debug("Jackett API key not found, skipping Jackett search")
                return results
            
            params = {
                "apikey": jackett_api_key,
                "Query": query,
                "Tracker[]": "all"  # Search all configured indexers
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(jackett_url, params=params)
                
                if response.status_code == 200:
                    try:
                        # Jackett returns RSS/XML
                        soup = BeautifulSoup(response.text, 'xml')
                        
                        for item in soup.find_all('item')[:10]:
                            title_elem = item.find('title')
                            link_elem = item.find('link')
                            
                            if title_elem and link_elem:
                                title = title_elem.text.strip()
                                link = link_elem.text.strip()
                                
                                # Extract size and seeders from description
                                desc_elem = item.find('description')
                                size = ""
                                seeders = 0
                                
                                if desc_elem:
                                    desc_text = desc_elem.text
                                    size_match = re.search(r'Size: ([^<]+)', desc_text)
                                    seeders_match = re.search(r'Seeders: (\d+)', desc_text)
                                    
                                    if size_match:
                                        size = size_match.group(1).strip()
                                    if seeders_match:
                                        seeders = int(seeders_match.group(1))
                                
                                # Check if it's a magnet link or torrent file
                                if link.startswith('magnet:'):
                                    magnet = link
                                else:
                                    # Create magnet from torrent file hash if available
                                    hash_match = re.search(r'([a-fA-F0-9]{40})', link)
                                    if hash_match:
                                        magnet = self._create_magnet_from_hash(hash_match.group(1), title)
                                    else:
                                        continue
                                
                                results.append(TorrentSearchResult(
                                    title=f"[Jackett] {title}",
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=0
                                ))
                                
                    except Exception as e:
                        logger.debug(f"Error parsing Jackett response: {e}")
                        
        except Exception as e:
            logger.debug(f"Jackett search failed: {e}")
            
        return results