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
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Dict, Optional, Callable, Tuple, Any
import httpx
from bs4 import BeautifulSoup
import urllib.parse

logger = logging.getLogger("watchwithmi.services.p2p_search")


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
        self.user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        
        # Caching
        self.memory_cache: Dict[str, Tuple[float, List[ContentSearchResult]]] = {}
        self.cache_ttl = 600  # 10 minutes
        
        # Circuit breaker settings
        self.provider_stats: Dict[str, ProviderStats] = {}
        self.circuit_failure_threshold = 5  # Open circuit after 5 failures
        self.circuit_reset_timeout = 300  # Try again after 5 minutes
        
        # Provider tiers (ordered by reliability)
        self.tier1_providers = [
            ('bitsearch', self._search_bitsearch),
        ]
        self.tier2_providers = [
            ('nyaa', self._search_nyaa_api),
        ]
        self.tier3_providers = [
            ('btdig', self._search_btdig_api),
            ('contentproject', self._search_contentproject_api),
        ]
        
        logger.info("✅ P2P content search service initialized")
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
        """Search a tier of providers with circuit breaker protection."""
        all_results = []
        
        for provider_name, provider_func in providers:
            # Check circuit breaker
            if not self._is_provider_available(provider_name):
                logger.debug(f"⚡ Circuit open for {provider_name}, skipping")
                continue
            
            try:
                start_time = time.time()
                results = await self._search_with_adaptive_retry(
                    provider_name, provider_func, query
                )
                response_time = time.time() - start_time
                
                if results:
                    logger.info(f"✅ {provider_name}: {len(results)} results ({response_time:.2f}s)")
                    all_results.extend(results)
                    self._record_success(provider_name, response_time)
                    
                    # Early exit if we have enough results
                    if len(all_results) >= required_results:
                        break
                else:
                    logger.debug(f"📭 {provider_name}: 0 results")
                    
            except Exception as e:
                logger.warning(f"❌ {provider_name} failed: {e}")
                self._record_failure(provider_name)
        
        return all_results
    
    async def _search_with_adaptive_retry(self, provider_name: str, 
                                         search_func: Callable, query: str) -> List[ContentSearchResult]:
        """Retry search with exponential backoff and jitter."""
        last_exception = None
        
        for attempt in range(self.max_retries):
            try:
                # Add timeout per attempt
                return await asyncio.wait_for(
                    search_func(query),
                    timeout=self.timeout
                )
            except asyncio.TimeoutError:
                last_exception = TimeoutError(f"{provider_name} timeout")
                logger.debug(f"⏱️ {provider_name} timeout on attempt {attempt + 1}/{self.max_retries}")
            except Exception as e:
                last_exception = e
                logger.debug(f"❌ {provider_name} error on attempt {attempt + 1}/{self.max_retries}: {e}")
            
            # Don't retry on last attempt
            if attempt < self.max_retries - 1:
                # Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                logger.debug(f"⏳ Retrying {provider_name} in {wait_time:.1f}s...")
                await asyncio.sleep(wait_time)
        
        # All retries failed
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
        
        # Simple cache cleanup: remove oldest entries if cache is too large
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
                response = await client.get(url, headers={'User-Agent': self.user_agent}, timeout=self.timeout)
                
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
                                        except:
                                            pass
                                    elif 'Leechers' in text:
                                        try:
                                            leechers = int(text.replace('Leechers', '').strip())
                                        except:
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
                response = await client.get(url, headers={'User-Agent': self.user_agent}, timeout=self.timeout)
                
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
                                except:
                                    seeders = 0
                                
                                try:
                                    leechers = int(cols[6].get_text(strip=True))
                                except:
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
                response = await client.get(url, headers={'User-Agent': self.user_agent}, timeout=self.timeout)
                
                if response.status_code == 429:
                    raise Exception("Rate limited")
                
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
                                magnet = f"magnet:?xt=urn:btih:{info_hash}"
                                
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
    
    async def _search_contentproject_api(self, query: str) -> List[ContentSearchResult]:
        """Search ContentProject - backup provider."""
        # Placeholder - implement if needed
        return []
    
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
