"""
P2P Content Search Service - Ultra-robust search with circuit breaker and multi-tier fallback.

This service provides highly reliable P2P content search with:
- Circuit breaker pattern to auto-disable failing providers
- Multi-tier fallback strategy
- Adaptive retry with exponential backoff
- Health monitoring and success rate tracking
- Graceful degradation - always returns something useful
"""

import asyncio
import hashlib
import logging
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import List, Dict, Optional, Callable, Tuple, Any
import httpx
from bs4 import BeautifulSoup
import urllib.parse

try:
    import cloudscraper  # type: ignore
    _CLOUDSCRAPER_AVAILABLE = True
except Exception:  # pragma: no cover - import-time guard
    cloudscraper = None  # type: ignore
    _CLOUDSCRAPER_AVAILABLE = False

logger = logging.getLogger("watchwithmi.services.p2p_search")

# Rotating user agents to avoid detection
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
]

# Common public trackers appended to constructed magnet links
COMMON_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://tracker.leechers-paradise.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.stealth.si:80/announce",
]


def _build_magnet(info_hash: str, display_name: str = "") -> str:
    """Build a magnet URI from an info hash, with common trackers."""
    magnet = f"magnet:?xt=urn:btih:{info_hash}"
    if display_name:
        magnet += f"&dn={urllib.parse.quote(display_name)}"
    for tracker in COMMON_TRACKERS:
        magnet += f"&tr={urllib.parse.quote(tracker)}"
    return magnet


def _random_ua() -> str:
    """Return a random user agent string."""
    return random.choice(USER_AGENTS)


def _browser_headers(referer: Optional[str] = None) -> Dict[str, str]:
    """Return a full set of browser-like headers.

    Sending only ``User-Agent`` is the easiest fingerprint for a provider
    to flag — real browsers always send Accept / Accept-Language /
    Accept-Encoding too. Adding these costs nothing and helps us look
    less like a Python script when scraping public endpoints.
    """
    headers = {
        "User-Agent": _random_ua(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        # Deliberately omit `br` — httpx auto-decompresses gzip/deflate
        # but needs the optional `brotli` package for br. Without it we
        # get raw compressed bytes back as `response.text`.
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    if referer:
        headers["Referer"] = referer
    return headers


async def _cloudscraper_get(
    url: str,
    *,
    timeout: float,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, str]:
    """GET ``url`` via cloudscraper (Cloudflare-aware) in a worker thread.

    Returns ``(status_code, text)``. Raises if cloudscraper is unavailable
    or the call itself fails — callers should fall back to httpx.
    """
    if not _CLOUDSCRAPER_AVAILABLE:
        raise RuntimeError("cloudscraper not available")

    def _do_request() -> Tuple[int, str]:
        scraper = cloudscraper.create_scraper(  # type: ignore[union-attr]
            browser={"browser": "chrome", "platform": "windows", "mobile": False},
        )
        resp = scraper.get(url, headers=headers or {}, timeout=timeout)
        return resp.status_code, resp.text

    return await asyncio.to_thread(_do_request)


class RateLimitError(Exception):
    """Raised when a provider returns HTTP 429."""
    pass


class ProviderHealth(Enum):
    """Provider circuit breaker states."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    CIRCUIT_OPEN = "circuit_open"


@dataclass
class ProviderStats:
    """Track provider health and performance metrics."""
    success_count: int = 0
    failure_count: int = 0
    last_success: Optional[datetime] = None
    last_failure: Optional[datetime] = None
    circuit_state: ProviderHealth = ProviderHealth.HEALTHY
    total_response_time: float = 0.0

    @property
    def success_rate(self) -> float:
        """Calculate success rate (0.0 to 1.0)."""
        total = self.success_count + self.failure_count
        return self.success_count / total if total > 0 else 0.0

    @property
    def avg_response_time(self) -> float:
        """Calculate average response time in seconds."""
        return self.total_response_time / self.success_count if self.success_count > 0 else 0.0


class ContentSearchResult:
    """Represents a P2P content search result."""

    def __init__(self, title: str, magnet: str, size: str = "", seeders: int = 0,
                 leechers: int = 0, quality: str = ""):
        self.title = title
        self.magnet = magnet
        self.size = size
        self.seeders = seeders
        self.leechers = leechers
        self.quality = self._extract_quality(title) or quality
        self.is_placeholder = False

    def _extract_quality(self, title: str) -> Optional[str]:
        """Extract quality information from title."""
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
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                return match.group()
        return None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            'title': self.title,
            'magnet_url': self.magnet,
            'size': self.size,
            'seeders': self.seeders,
            'leechers': self.leechers,
            'quality': self.quality,
            'is_placeholder': self.is_placeholder
        }


class ContentSearchService:
    """
    Ultra-robust P2P content search service.
    
    Features:
    - Circuit breaker pattern for failing providers
    - Multi-tier provider fallback
    - Adaptive retry with exponential backoff
    - In-memory caching
    - Health monitoring
    - Graceful degradation
    """

    def __init__(self):
        self.timeout = 15.0  # Per-provider timeout
        self.max_retries = 5  # Maximum retry attempts

        # Caching
        self.memory_cache: Dict[str, Tuple[float, List[ContentSearchResult]]] = {}
        self.cache_ttl = 600  # 10 minutes

        # Circuit breaker settings
        self.provider_stats: Dict[str, ProviderStats] = {}
        self.circuit_failure_threshold = 5  # Open circuit after 5 failures
        self.circuit_reset_timeout = 300  # Try again after 5 minutes

        # Provider tiers (ordered by reliability).
        # Provenance notes (April 2026 audit against /api/diag/search/raw
        # from a Render datacenter IP):
        #  - knaben:   JSON aggregator over ~30 trackers; works from
        #              datacenter IPs. Primary.
        #  - nyaa:     anime-focused but reliably reachable; promoted to
        #              tier 1 to give us a second always-on source.
        #  - piratebay: kept on the list — apibay returns 403 from Render
        #              (Cloudflare "Just a moment..." page, cloudscraper
        #              can't solve it) but works fine from residential
        #              IPs / self-hosting.
        #  - btdig:    kept as tier-3 fallback; commonly rate-limits.
        #  - bitsearch: REMOVED. Site no longer exposes magnets in the
        #              search listing — only `/torrent/<id>` detail
        #              links. Parsing requires N+1 follow-up fetches.
        #              Code retained on the class for future revival.
        #  - yts:      REMOVED. yts.mx is NXDOMAIN globally as of this
        #              audit; yts.am does not respond either. Code
        #              retained on the class.
        self.tier1_providers = [
            ('knaben', self._search_knaben),
            ('nyaa', self._search_nyaa_api),
        ]
        self.tier2_providers = [
            ('piratebay', self._search_piratebay),
        ]
        self.tier3_providers = [
            ('btdig', self._search_btdig_api),
        ]

        logger.info("P2P content search service initialized")
        logger.info(f"   Tier 1 providers: {len(self.tier1_providers)}")
        logger.info(f"   Tier 2 providers: {len(self.tier2_providers)}")
        logger.info(f"   Tier 3 providers: {len(self.tier3_providers)}")

    async def search(self, query: str, max_results: int = 10) -> List[ContentSearchResult]:
        """
        Search for P2P content with ultra-robust fallback strategy.
        
        Args:
            query: Search query string
            max_results: Maximum number of results to return
            
        Returns:
            List of search results (always returns something, even if empty with helpful message)
        """
        logger.info(f"🔍 Searching P2P content for: {query}")

        # 1. Check cache first
        cache_key = f"{query}:{max_results}"
        cached = self._get_from_cache(cache_key)
        if cached:
            logger.info(f"✅ Cache hit for: {query}")
            return cached

        # Clean query
        clean_query = self._clean_query(query)

        # 2. Try tier 1 providers (most reliable)
        results = await self._search_tier(self.tier1_providers, clean_query, required_results=5)

        # 3. If insufficient results, try tier 2
        if len(results) < max_results:
            logger.info(f"📊 Tier 1 gave {len(results)} results, trying tier 2...")
            tier2_results = await self._search_tier(self.tier2_providers, clean_query, required_results=5)
            results.extend(tier2_results)

        # 4. If still insufficient, try tier 3
        if len(results) < max_results:
            logger.info(f"📊 Tier 2 gave {len(results)} total results, trying tier 3...")
            tier3_results = await self._search_tier(self.tier3_providers, clean_query, required_results=3)
            results.extend(tier3_results)

        # 5. Deduplicate and sort
        unique_results = self._deduplicate_results(results)
        sorted_results = sorted(unique_results, key=lambda x: x.seeders, reverse=True)

        # 6. Cache results (even if empty)
        self._save_to_cache(cache_key, sorted_results)

        # 7. Always return something - even if it's a helpful message
        if len(sorted_results) == 0:
            logger.warning(f"⚠️ No results found for '{query}' after all tiers")
            return self._create_fallback_results(query)

        logger.info(f"✅ Returning {len(sorted_results)} results for: {query}")
        return sorted_results[:max_results]

    async def _search_tier(self, providers: List[Tuple[str, Callable]],
                          query: str, required_results: int) -> List[ContentSearchResult]:
        """Search a tier of providers concurrently with circuit breaker protection."""
        available = [
            (name, func) for name, func in providers
            if self._is_provider_available(name)
        ]
        if not available:
            return []

        async def _run_provider(provider_name: str, provider_func: Callable) -> List[ContentSearchResult]:
            """Run a single provider with tracking."""
            # Small random delay to stagger requests and avoid bot detection
            await asyncio.sleep(random.uniform(0.5, 1.5))
            try:
                start_time = time.time()
                results = await self._search_with_adaptive_retry(
                    provider_name, provider_func, query
                )
                response_time = time.time() - start_time

                if results:
                    logger.info(f"{provider_name}: {len(results)} results ({response_time:.2f}s)")
                    self._record_success(provider_name, response_time)
                    return results
                else:
                    logger.debug(f"{provider_name}: 0 results")
                    return []
            except Exception as e:
                logger.warning(f"{provider_name} failed: {e}")
                self._record_failure(provider_name)
                return []

        # Run all available providers in this tier concurrently
        tasks = [_run_provider(name, func) for name, func in available]
        provider_results = await asyncio.gather(*tasks)

        all_results: List[ContentSearchResult] = []
        for results in provider_results:
            all_results.extend(results)

        return all_results

    async def _search_with_adaptive_retry(self, provider_name: str,
                                         search_func: Callable, query: str) -> List[ContentSearchResult]:
        """Retry search with exponential backoff, jitter, and rate-limit awareness."""
        last_exception = None

        for attempt in range(self.max_retries):
            try:
                return await asyncio.wait_for(
                    search_func(query),
                    timeout=self.timeout
                )
            except asyncio.TimeoutError:
                last_exception = TimeoutError(f"{provider_name} timeout")
                logger.debug(f"{provider_name} timeout on attempt {attempt + 1}/{self.max_retries}")
            except RateLimitError:
                # Special handling: wait 2s and retry once, then give up
                logger.debug(f"{provider_name} rate limited on attempt {attempt + 1}")
                if attempt == 0:
                    await asyncio.sleep(2.0)
                    continue
                last_exception = Exception(f"{provider_name} rate limited")
                break
            except Exception as e:
                last_exception = e
                logger.debug(f"{provider_name} error on attempt {attempt + 1}/{self.max_retries}: {e}")

            # Don't retry on last attempt
            if attempt < self.max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                logger.debug(f"Retrying {provider_name} in {wait_time:.1f}s...")
                await asyncio.sleep(wait_time)

        raise last_exception or Exception("Unknown error")

    def _is_provider_available(self, provider_name: str) -> bool:
        """Check if provider circuit breaker allows requests."""
        stats = self.provider_stats.get(provider_name)
        if not stats:
            return True

        # If circuit is open, check if enough time has passed to retry
        if stats.circuit_state == ProviderHealth.CIRCUIT_OPEN:
            if stats.last_failure:
                time_since_failure = (datetime.now() - stats.last_failure).total_seconds()
                if time_since_failure > self.circuit_reset_timeout:
                    logger.info(f"🔄 Resetting circuit for {provider_name}")
                    stats.circuit_state = ProviderHealth.DEGRADED
                    return True
            return False

        return True

    def _record_success(self, provider_name: str, response_time: float):
        """Record successful provider call."""
        if provider_name not in self.provider_stats:
            self.provider_stats[provider_name] = ProviderStats()

        stats = self.provider_stats[provider_name]
        stats.success_count += 1
        stats.last_success = datetime.now()
        stats.total_response_time += response_time

        # Reset circuit if it was degraded
        if stats.circuit_state == ProviderHealth.DEGRADED:
            if stats.success_rate > 0.5:  # 50% success rate
                stats.circuit_state = ProviderHealth.HEALTHY
                logger.info(f"✅ {provider_name} circuit restored to healthy (success rate: {stats.success_rate:.1%})")

    def _record_failure(self, provider_name: str):
        """Record failed provider call and update circuit breaker."""
        if provider_name not in self.provider_stats:
            self.provider_stats[provider_name] = ProviderStats()

        stats = self.provider_stats[provider_name]
        stats.failure_count += 1
        stats.last_failure = datetime.now()

        # Open circuit if too many failures
        if stats.failure_count >= self.circuit_failure_threshold:
            if stats.success_rate < 0.2:  # Less than 20% success
                stats.circuit_state = ProviderHealth.CIRCUIT_OPEN
                logger.warning(f"⚡ Circuit opened for {provider_name} (success rate: {stats.success_rate:.1%})")

    def _get_from_cache(self, cache_key: str) -> Optional[List[ContentSearchResult]]:
        """Get results from cache if not expired."""
        if cache_key in self.memory_cache:
            cached_time, cached_results = self.memory_cache[cache_key]
            if time.time() - cached_time < self.cache_ttl:
                return cached_results
            else:
                # Remove expired cache entry
                del self.memory_cache[cache_key]
        return None

    def _save_to_cache(self, cache_key: str, results: List[ContentSearchResult]):
        """Save results to cache."""
        self.memory_cache[cache_key] = (time.time(), results)

        # Remove expired entries (older than cache_ttl)
        now = time.time()
        expired_keys = [k for k, (ts, _) in self.memory_cache.items() if now - ts >= self.cache_ttl]
        for key in expired_keys:
            del self.memory_cache[key]

        # Simple cache cleanup: remove oldest entries if cache is still too large
        if len(self.memory_cache) > 100:
            # Remove oldest 20 entries
            sorted_keys = sorted(self.memory_cache.keys(),
                               key=lambda k: self.memory_cache[k][0])
            for key in sorted_keys[:20]:
                del self.memory_cache[key]

    def _create_fallback_results(self, query: str) -> List[ContentSearchResult]:
        """Create helpful fallback when no results found."""
        result = ContentSearchResult(
            title=f"No results found for '{query}'",
            magnet="",
            size="Try different search terms or check back later",
            seeders=0,
            leechers=0,
            quality="Suggestions: Use specific titles, include year, try alternative spellings"
        )
        result.is_placeholder = True
        return [result]

    def _clean_query(self, query: str) -> str:
        """Clean and normalize search query."""
        # Remove extra whitespace
        query = ' '.join(query.split())
        # Remove special characters that might break searches
        query = re.sub(r'[<>:"/\\|?*]', ' ', query)
        return query.strip()

    def _deduplicate_results(self, results: List[ContentSearchResult]) -> List[ContentSearchResult]:
        """Remove duplicate results based on magnet link hash."""
        seen_hashes = set()
        unique_results = []

        for result in results:
            # Skip placeholders
            if result.is_placeholder:
                continue

            # Create hash from magnet link
            if result.magnet:
                result_hash = hashlib.md5(result.magnet.encode()).hexdigest()
                if result_hash not in seen_hashes:
                    seen_hashes.add(result_hash)
                    unique_results.append(result)

        return unique_results

    # Provider implementations

    async def _search_bitsearch(self, query: str) -> List[ContentSearchResult]:
        """Search BitSearch - most reliable provider."""
        results = []
        try:
            async with httpx.AsyncClient() as client:
                url = f"https://bitsearch.to/search?q={urllib.parse.quote(query)}"
                response = await client.get(url, headers=_browser_headers(), timeout=self.timeout)

                if response.status_code == 429:
                    raise RateLimitError("BitSearch rate limited")

                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    items = soup.find_all('li', class_='search-result')

                    for item in items[:20]:  # Limit to 20 results
                        try:
                            title_elem = item.find('h5', class_='title')
                            if not title_elem:
                                continue

                            title = title_elem.get_text(strip=True)
                            magnet_elem = item.find('a', href=lambda x: x and x.startswith('magnet:'))

                            if magnet_elem:
                                magnet = magnet_elem['href']

                                # Extract stats
                                stats = item.find_all('div', class_='stats')
                                size = ""
                                seeders = 0
                                leechers = 0

                                for stat in stats:
                                    text = stat.get_text(strip=True)
                                    if 'Size' in text:
                                        size = text.replace('Size', '').strip()
                                    elif 'Seeders' in text:
                                        try:
                                            seeders = int(text.replace('Seeders', '').strip())
                                        except (ValueError, AttributeError, TypeError):
                                            pass
                                    elif 'Leechers' in text:
                                        try:
                                            leechers = int(text.replace('Leechers', '').strip())
                                        except (ValueError, AttributeError, TypeError):
                                            pass

                                results.append(ContentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                        except Exception as e:
                            logger.debug(f"Error parsing BitSearch item: {e}")
                            continue
        except Exception as e:
            logger.debug(f"BitSearch search failed: {e}")
            raise

        return results

    async def _search_nyaa_api(self, query: str) -> List[ContentSearchResult]:
        """Search Nyaa.si API - good for anime content."""
        results = []
        try:
            async with httpx.AsyncClient() as client:
                url = f"https://nyaa.si/?f=0&c=0_0&q={urllib.parse.quote(query)}"
                response = await client.get(url, headers=_browser_headers(), timeout=self.timeout)

                if response.status_code == 429:
                    raise RateLimitError("Nyaa rate limited")

                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    rows = soup.find_all('tr', class_='default')

                    for row in rows[:15]:  # Limit to 15 results
                        try:
                            cols = row.find_all('td')
                            if len(cols) < 6:
                                continue

                            title_elem = cols[1].find('a', class_=lambda x: x != 'comments')
                            if not title_elem:
                                continue

                            title = title_elem.get_text(strip=True)
                            magnet_elem = cols[2].find('a', href=lambda x: x and x.startswith('magnet:'))

                            if magnet_elem:
                                magnet = magnet_elem['href']
                                size = cols[3].get_text(strip=True)

                                try:
                                    seeders = int(cols[5].get_text(strip=True))
                                except (ValueError, AttributeError, TypeError):
                                    seeders = 0

                                try:
                                    leechers = int(cols[6].get_text(strip=True))
                                except (ValueError, AttributeError, TypeError):
                                    leechers = 0

                                results.append(ContentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeders,
                                    leechers=leechers
                                ))
                        except Exception as e:
                            logger.debug(f"Error parsing Nyaa item: {e}")
                            continue
        except Exception as e:
            logger.debug(f"Nyaa search failed: {e}")
            raise

        return results

    async def _search_btdig_api(self, query: str) -> List[ContentSearchResult]:
        """Search BTDigg API - may be rate limited."""
        results = []
        try:
            async with httpx.AsyncClient() as client:
                url = f"https://btdig.com/search?q={urllib.parse.quote(query)}"
                response = await client.get(url, headers=_browser_headers(), timeout=self.timeout)

                if response.status_code == 429:
                    raise RateLimitError("BTDigg rate limited")

                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    items = soup.find_all('div', class_='one_result')

                    for item in items[:10]:  # Limit to 10 results
                        try:
                            title_elem = item.find('div', class_='content_name')
                            if not title_elem:
                                continue

                            title = title_elem.get_text(strip=True)
                            info_hash_elem = item.find('div', class_='content_infohash')

                            if info_hash_elem:
                                info_hash = info_hash_elem.get_text(strip=True)
                                magnet = _build_magnet(info_hash, title)

                                size_elem = item.find('span', class_='content_size')
                                size = size_elem.get_text(strip=True) if size_elem else ""

                                results.append(ContentSearchResult(
                                    title=title,
                                    magnet=magnet,
                                    size=size,
                                    seeders=0,  # BTDigg doesn't provide seeder info
                                    leechers=0
                                ))
                        except Exception as e:
                            logger.debug(f"Error parsing BTDigg item: {e}")
                            continue
        except Exception as e:
            logger.debug(f"BTDigg search failed: {e}")
            raise

        return results

    async def _search_knaben(self, query: str) -> List[ContentSearchResult]:
        """Search Knaben.eu — meta-search aggregator with a POST JSON API.

        Aggregates ~30 trackers, returns hashes + seeders. Crucially it's
        not Cloudflare-fronted and tends to be reachable from datacenter
        IPs where apibay/bitsearch get 403'd.
        """
        results: List[ContentSearchResult] = []
        url = "https://api.knaben.org/v1"
        payload = {
            # "100%" filters to titles containing the query verbatim;
            # "score" returns trending content unfiltered.
            "search_type": "100%",
            "search_field": "title",
            "query": query,
            "order_by": "seeders",
            "order_direction": "desc",
            "size": 30,
            "from": 0,
        }
        headers = _browser_headers()
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, json=payload, headers=headers, timeout=self.timeout
                )

                if response.status_code == 429:
                    raise RateLimitError("Knaben rate limited")
                if response.status_code != 200:
                    raise RuntimeError(f"Knaben returned HTTP {response.status_code}")

                data = response.json()
                hits = data.get("hits") or []

                for hit in hits[:25]:
                    try:
                        title = hit.get("title") or ""
                        info_hash = hit.get("hash") or ""
                        if not title or not info_hash:
                            continue

                        # Knaben sometimes provides a magnet directly; prefer
                        # that, otherwise build from the hash.
                        magnet = hit.get("magnetUrl") or _build_magnet(info_hash, title)

                        raw_size = int(hit.get("bytes") or 0)
                        size = self._format_bytes(raw_size)

                        seeders = int(hit.get("seeders") or 0)
                        peers = int(hit.get("peers") or 0)
                        # Knaben reports total peers; estimate leechers
                        leechers = max(peers - seeders, 0)

                        results.append(ContentSearchResult(
                            title=title,
                            magnet=magnet,
                            size=size,
                            seeders=seeders,
                            leechers=leechers,
                        ))
                    except Exception as e:
                        logger.debug(f"Error parsing Knaben item: {e}")
                        continue
        except RateLimitError:
            raise
        except Exception as e:
            logger.debug(f"Knaben search failed: {e}")
            raise

        return results

    async def _search_piratebay(self, query: str) -> List[ContentSearchResult]:
        """Search The Pirate Bay via apibay.org JSON API.

        Tries cloudscraper first (transparently handles any Cloudflare
        challenge if apibay puts one up) and falls back to plain httpx
        if cloudscraper isn't available or errors out.
        """
        results = []
        url = f"https://apibay.org/q.php?q={urllib.parse.quote(query)}"
        headers = _browser_headers(referer="https://thepiratebay.org/")
        status_code = 0
        items: List[Dict[str, Any]] = []

        try:
            try:
                status_code, body_text = await _cloudscraper_get(
                    url, timeout=self.timeout, headers=headers
                )
                if status_code == 200:
                    import json as _json
                    try:
                        items = _json.loads(body_text)
                    except Exception:
                        items = []
            except Exception as cs_err:  # cloudscraper unavailable / failed
                logger.debug(f"PirateBay cloudscraper path failed, falling back to httpx: {cs_err}")
                async with httpx.AsyncClient() as client:
                    response = await client.get(url, headers=headers, timeout=self.timeout)
                    status_code = response.status_code
                    if status_code == 200:
                        try:
                            items = response.json()
                        except Exception:
                            items = []

            if status_code == 429:
                raise RateLimitError("PirateBay API rate limited")

            # 403 / 5xx from datacenter IPs is the typical apibay failure
            # mode on hosts like Render — surface it as a real error so the
            # circuit breaker opens instead of silently returning empty.
            if status_code and status_code != 200:
                raise RuntimeError(f"PirateBay API returned HTTP {status_code}")

            if status_code == 200:
                # apibay returns a list; a single item with id "0" means no results
                if not items or (len(items) == 1 and str(items[0].get('id')) == '0'):
                    return []

                for item in items[:20]:
                    try:
                        name = item.get('name', '')
                        info_hash = item.get('info_hash', '')
                        if not name or not info_hash:
                            continue

                        magnet = _build_magnet(info_hash, name)

                        # Size is in bytes — convert to human-readable
                        raw_size = int(item.get('size', 0))
                        size = self._format_bytes(raw_size)

                        seeders = int(item.get('seeders', 0))
                        leechers = int(item.get('leechers', 0))

                        results.append(ContentSearchResult(
                            title=name,
                            magnet=magnet,
                            size=size,
                            seeders=seeders,
                            leechers=leechers,
                        ))
                    except Exception as e:
                        logger.debug(f"Error parsing PirateBay item: {e}")
                        continue
        except RateLimitError:
            raise
        except Exception as e:
            logger.debug(f"PirateBay search failed: {e}")
            raise

        return results

    async def _search_yts(self, query: str) -> List[ContentSearchResult]:
        """Search YTS/YIFY JSON API - movies only, very reliable."""
        results = []
        try:
            async with httpx.AsyncClient() as client:
                url = f"https://yts.mx/api/v2/list_movies.json?query_term={urllib.parse.quote(query)}&limit=20"
                response = await client.get(url, headers=_browser_headers(), timeout=self.timeout)

                if response.status_code == 429:
                    raise RateLimitError("YTS rate limited")

                if response.status_code == 200:
                    data = response.json()
                    movies = data.get('data', {}).get('movies') or []

                    for movie in movies:
                        try:
                            title = movie.get('title_long') or movie.get('title', 'Unknown')
                            torrents = movie.get('torrents', [])

                            for torrent in torrents:
                                torrent_hash = torrent.get('hash', '')
                                if not torrent_hash:
                                    continue

                                quality = torrent.get('quality', '')
                                size = torrent.get('size', '')
                                seeds = int(torrent.get('seeds', 0))
                                peers = int(torrent.get('peers', 0))

                                display = f"{title} [{quality}]" if quality else title
                                magnet = _build_magnet(torrent_hash, display)

                                results.append(ContentSearchResult(
                                    title=display,
                                    magnet=magnet,
                                    size=size,
                                    seeders=seeds,
                                    leechers=peers,
                                    quality=quality,
                                ))
                        except Exception as e:
                            logger.debug(f"Error parsing YTS movie: {e}")
                            continue
        except RateLimitError:
            raise
        except Exception as e:
            logger.debug(f"YTS search failed: {e}")
            raise

        return results

    @staticmethod
    def _format_bytes(num_bytes: int) -> str:
        """Convert bytes to human-readable size string."""
        if num_bytes <= 0:
            return ""
        for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
            if abs(num_bytes) < 1024.0:
                return f"{num_bytes:.1f} {unit}"
            num_bytes /= 1024.0
        return f"{num_bytes:.1f} PB"

    async def diagnose_raw(self, query: str) -> Dict[str, Any]:
        """Inspect the raw HTTP response from each provider's search URL.

        Bypasses the parsers entirely — returns status code, content-type,
        body size, a body preview, and a heuristic ``cloudflare_challenge``
        flag. Use this when ``diagnose`` reports ``ok=true, result_count=0``
        and you need to know *why* (genuine empty vs Cloudflare challenge
        vs HTML-changed-on-us).
        """
        clean_query = self._clean_query(query)
        encoded = urllib.parse.quote(clean_query)

        # (provider name, URL, fetcher: "cloudscraper" | "httpx", referer)
        # NOTE: knaben uses POST so it's tested via the higher-level diagnose()
        # rather than this raw GET probe.
        targets: List[Tuple[str, str, str, Optional[str]]] = [
            ("nyaa", f"https://nyaa.si/?f=0&c=0_0&q={encoded}", "httpx", None),
            ("piratebay", f"https://apibay.org/q.php?q={encoded}", "cloudscraper",
             "https://thepiratebay.org/"),
            ("btdig", f"https://btdig.com/search?q={encoded}", "httpx", None),
            # Disabled providers kept here for ad-hoc reachability testing —
            # they're no longer in the active tier list.
            ("bitsearch_disabled", f"https://bitsearch.to/search?q={encoded}", "httpx", None),
            ("yts_disabled", f"https://yts.mx/api/v2/list_movies.json?query_term={encoded}&limit=5",
             "httpx", None),
        ]

        async def _probe(name: str, url: str, fetcher: str, referer: Optional[str]) -> Dict[str, Any]:
            start = time.monotonic()
            try:
                headers = _browser_headers(referer=referer)
                if fetcher == "cloudscraper":
                    try:
                        status_code, body_text = await _cloudscraper_get(
                            url, timeout=self.timeout, headers=headers
                        )
                        actual_fetcher = "cloudscraper"
                    except Exception:
                        # fall back to httpx for visibility
                        async with httpx.AsyncClient() as client:
                            r = await client.get(url, headers=headers, timeout=self.timeout)
                            status_code = r.status_code
                            body_text = r.text
                        actual_fetcher = "httpx (cloudscraper failed)"
                else:
                    async with httpx.AsyncClient() as client:
                        r = await client.get(url, headers=headers, timeout=self.timeout)
                        status_code = r.status_code
                        body_text = r.text
                    actual_fetcher = "httpx"

                elapsed_ms = int((time.monotonic() - start) * 1000)
                body_lower = body_text.lower()
                cloudflare_challenge = (
                    "cf-browser-verification" in body_lower
                    or "cf_chl_" in body_lower
                    or "checking your browser" in body_lower
                    or "just a moment..." in body_lower
                    or "attention required" in body_lower
                )
                return {
                    "provider": name,
                    "url": url,
                    "fetcher": actual_fetcher,
                    "ok": True,
                    "status_code": status_code,
                    "body_size": len(body_text),
                    "body_preview": body_text[:400],
                    "cloudflare_challenge": cloudflare_challenge,
                    "latency_ms": elapsed_ms,
                    "error": None,
                }
            except Exception as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                return {
                    "provider": name,
                    "url": url,
                    "fetcher": fetcher,
                    "ok": False,
                    "status_code": None,
                    "body_size": 0,
                    "body_preview": "",
                    "cloudflare_challenge": False,
                    "latency_ms": elapsed_ms,
                    "error": f"{type(e).__name__}: {e}",
                }

        probes = await asyncio.gather(*[_probe(*t) for t in targets])
        return {
            "query": clean_query,
            "cloudscraper_available": _CLOUDSCRAPER_AVAILABLE,
            "providers": list(probes),
        }

    async def diagnose(self, query: str) -> Dict[str, Any]:
        """Run every provider once (no retries, no circuit-breaker gating)
        and return per-provider diagnostics.

        Designed for ``GET /api/diag/search`` — when a deployed instance
        returns "no results found", this surfaces *which* providers the
        host can actually reach (status codes, latency, errors) so we can
        tell apart "code is broken" from "datacenter IP is blocked".
        """
        all_providers: List[Tuple[str, Callable]] = (
            self.tier1_providers + self.tier2_providers + self.tier3_providers
        )

        clean_query = self._clean_query(query)

        async def _run_one(name: str, func: Callable) -> Dict[str, Any]:
            start = time.monotonic()
            try:
                results = await asyncio.wait_for(func(clean_query), timeout=self.timeout)
                elapsed_ms = int((time.monotonic() - start) * 1000)
                return {
                    "provider": name,
                    "ok": True,
                    "result_count": len(results),
                    "latency_ms": elapsed_ms,
                    "error": None,
                }
            except asyncio.TimeoutError:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                return {
                    "provider": name,
                    "ok": False,
                    "result_count": 0,
                    "latency_ms": elapsed_ms,
                    "error": f"timeout after {self.timeout}s",
                }
            except Exception as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                return {
                    "provider": name,
                    "ok": False,
                    "result_count": 0,
                    "latency_ms": elapsed_ms,
                    "error": f"{type(e).__name__}: {e}",
                }

        diagnostics = await asyncio.gather(
            *[_run_one(n, f) for n, f in all_providers]
        )
        total = sum(d["result_count"] for d in diagnostics)
        return {
            "query": clean_query,
            "cloudscraper_available": _CLOUDSCRAPER_AVAILABLE,
            "total_results": total,
            "providers": list(diagnostics),
        }

    def get_provider_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get statistics for all providers."""
        stats = {}
        for provider_name, provider_stats in self.provider_stats.items():
            stats[provider_name] = {
                'success_count': provider_stats.success_count,
                'failure_count': provider_stats.failure_count,
                'success_rate': provider_stats.success_rate,
                'avg_response_time': provider_stats.avg_response_time,
                'circuit_state': provider_stats.circuit_state.value,
                'last_success': provider_stats.last_success.isoformat() if provider_stats.last_success else None,
                'last_failure': provider_stats.last_failure.isoformat() if provider_stats.last_failure else None,
            }
        return stats
