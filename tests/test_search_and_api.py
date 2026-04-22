"""
Regression tests for P2P search service and API validation.

Covers: caching, circuit breaker, deduplication, fallback, provider parsing,
API request models, and rate-limit retry logic.

Run with: pytest tests/test_search_and_api.py -v
"""

import asyncio
import hashlib
import time
import urllib.parse
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest
import pytest_asyncio

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.p2p_search import (
    ContentSearchService,
    ContentSearchResult,
    ProviderHealth,
    ProviderStats,
    RateLimitError,
    COMMON_TRACKERS,
    _build_magnet,
)

# ---------------------------------------------------------------------------
# HTML / JSON fixtures for provider parsing tests
# ---------------------------------------------------------------------------

BITSEARCH_HTML = """
<html><body>
<li class="search-result">
  <h5 class="title">Ubuntu 24.04 Desktop ISO</h5>
  <a href="magnet:?xt=urn:btih:abc123&dn=Ubuntu">Magnet</a>
  <div class="stats">Size 2.8 GB</div>
  <div class="stats">Seeders 150</div>
  <div class="stats">Leechers 42</div>
</li>
<li class="search-result">
  <h5 class="title">Fedora 40 Workstation 1080p</h5>
  <a href="magnet:?xt=urn:btih:def456&dn=Fedora">Magnet</a>
  <div class="stats">Size 1.9 GB</div>
  <div class="stats">Seeders 80</div>
  <div class="stats">Leechers 10</div>
</li>
</body></html>
"""

PIRATEBAY_JSON = [
    {
        "id": "123",
        "name": "Big Buck Bunny 720p",
        "info_hash": "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c",
        "size": "734003200",
        "seeders": "200",
        "leechers": "30",
    },
    {
        "id": "456",
        "name": "Sintel 1080p",
        "info_hash": "aabbccdd00112233445566778899aabbccddeeff",
        "size": "1468006400",
        "seeders": "95",
        "leechers": "15",
    },
]

PIRATEBAY_NO_RESULTS = [{"id": "0", "name": "No results returned"}]

YTS_JSON = {
    "status": "ok",
    "data": {
        "movie_count": 1,
        "movies": [
            {
                "title": "Inception",
                "title_long": "Inception (2010)",
                "torrents": [
                    {
                        "hash": "AABB1122CCDD3344EEFF",
                        "quality": "720p",
                        "size": "950.5 MB",
                        "seeds": 300,
                        "peers": 50,
                    },
                    {
                        "hash": "FFEE4433DDCC2211AABB",
                        "quality": "1080p",
                        "size": "1.85 GB",
                        "seeds": 500,
                        "peers": 100,
                    },
                ],
            }
        ],
    },
}

YTS_NO_MOVIES = {"status": "ok", "data": {"movie_count": 0, "movies": None}}

NYAA_HTML = """
<html><body><table>
<tr class="default">
  <td>Category</td>
  <td><a class="comments" href="#">2</a><a href="/view/123">Naruto Shippuden EP100 720p</a></td>
  <td>
    <a href="/download/123.torrent">DL</a>
    <a href="magnet:?xt=urn:btih:nyaa111222&dn=Naruto">Magnet</a>
  </td>
  <td>350 MiB</td>
  <td>2024-01-15</td>
  <td>45</td>
  <td>5</td>
  <td>100</td>
</tr>
</table></body></html>
"""

BTDIGG_HTML = """
<html><body>
<div class="one_result">
  <div class="content_name">Creative Commons Film</div>
  <div class="content_infohash">1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b</div>
  <span class="content_size">700 MB</span>
</div>
</body></html>
"""


# ---------------------------------------------------------------------------
# Helper to build a mock httpx.Response
# ---------------------------------------------------------------------------

def _mock_response(status_code=200, text="", json_data=None):
    """Create a mock httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    if json_data is not None:
        resp.json.return_value = json_data
    return resp


def _mock_client(response):
    """Return an AsyncMock that behaves like ``httpx.AsyncClient()`` context manager."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


# ===================================================================
# 1. TestSearchCache
# ===================================================================


class TestSearchCache:
    def test_cache_hit_on_second_search(self):
        svc = ContentSearchService()
        r1 = ContentSearchResult("A", "magnet:?xt=urn:btih:aaa", seeders=10)
        svc._save_to_cache("q1:10", [r1])

        cached = svc._get_from_cache("q1:10")
        assert cached is not None
        assert len(cached) == 1
        assert cached[0].title == "A"

    def test_cache_expires_after_ttl(self):
        svc = ContentSearchService()
        r1 = ContentSearchResult("A", "magnet:?xt=urn:btih:aaa")
        svc._save_to_cache("q_ttl:10", [r1])

        # Manually push cached timestamp into the past
        ts, results = svc.memory_cache["q_ttl:10"]
        svc.memory_cache["q_ttl:10"] = (ts - svc.cache_ttl - 1, results)

        assert svc._get_from_cache("q_ttl:10") is None

    def test_different_queries_different_entries(self):
        svc = ContentSearchService()
        svc._save_to_cache("alpha:10", [ContentSearchResult("A", "m:a")])
        svc._save_to_cache("beta:10", [ContentSearchResult("B", "m:b")])

        a = svc._get_from_cache("alpha:10")
        b = svc._get_from_cache("beta:10")
        assert a[0].title == "A"
        assert b[0].title == "B"

    def test_cache_cleanup_removes_expired(self):
        svc = ContentSearchService()
        # Insert an already-expired entry
        svc.memory_cache["old:10"] = (time.time() - svc.cache_ttl - 1,
                                       [ContentSearchResult("old", "m:o")])
        # Saving a new entry triggers cleanup
        svc._save_to_cache("new:10", [ContentSearchResult("new", "m:n")])
        assert "old:10" not in svc.memory_cache
        assert "new:10" in svc.memory_cache

    def test_cache_cleanup_removes_oldest_when_over_100(self):
        svc = ContentSearchService()
        now = time.time()
        # Fill cache with 105 entries, each 1 second apart
        for i in range(105):
            svc.memory_cache[f"k{i}:10"] = (now + i, [ContentSearchResult(f"t{i}", f"m:{i}")])

        # Trigger cleanup by saving one more
        svc._save_to_cache("trigger:10", [ContentSearchResult("trigger", "m:t")])

        # Should have dropped the 20 oldest, so max ~86 + trigger
        assert len(svc.memory_cache) <= 100


# ===================================================================
# 2. TestCircuitBreaker
# ===================================================================


class TestCircuitBreaker:
    def test_five_failures_opens_circuit(self):
        svc = ContentSearchService()
        for _ in range(5):
            svc._record_failure("prov")
        stats = svc.provider_stats["prov"]
        assert stats.circuit_state == ProviderHealth.CIRCUIT_OPEN

    def test_circuit_open_skips_provider(self):
        svc = ContentSearchService()
        svc.provider_stats["prov"] = ProviderStats(
            failure_count=5,
            circuit_state=ProviderHealth.CIRCUIT_OPEN,
            last_failure=datetime.now(),
        )
        assert svc._is_provider_available("prov") is False

    def test_circuit_resets_to_degraded_after_timeout(self):
        svc = ContentSearchService()
        svc.provider_stats["prov"] = ProviderStats(
            failure_count=5,
            circuit_state=ProviderHealth.CIRCUIT_OPEN,
            last_failure=datetime.now() - timedelta(seconds=svc.circuit_reset_timeout + 1),
        )
        # Calling _is_provider_available should flip to DEGRADED and return True
        assert svc._is_provider_available("prov") is True
        assert svc.provider_stats["prov"].circuit_state == ProviderHealth.DEGRADED

    def test_success_after_degraded_restores_healthy(self):
        svc = ContentSearchService()
        svc.provider_stats["prov"] = ProviderStats(
            success_count=5,
            failure_count=4,
            circuit_state=ProviderHealth.DEGRADED,
        )
        # success_rate = 5/9 ~= 0.556 > 0.5 -> should restore
        svc._record_success("prov", 0.5)
        assert svc.provider_stats["prov"].circuit_state == ProviderHealth.HEALTHY

    def test_mixed_stays_healthy_if_success_rate_above_20(self):
        svc = ContentSearchService()
        # 3 successes, 7 failures -> 30% > 20%
        for _ in range(3):
            svc._record_success("prov", 0.1)
        for _ in range(7):
            svc._record_failure("prov")
        stats = svc.provider_stats["prov"]
        # 3/(3+7) = 0.3 > 0.2 so circuit should NOT open
        assert stats.circuit_state == ProviderHealth.HEALTHY


# ===================================================================
# 3. TestSearchDeduplication
# ===================================================================


class TestSearchDeduplication:
    def test_same_magnet_deduped(self):
        svc = ContentSearchService()
        r1 = ContentSearchResult("Title A", "magnet:?xt=urn:btih:SAME", seeders=10)
        r2 = ContentSearchResult("Title B", "magnet:?xt=urn:btih:SAME", seeders=20)
        unique = svc._deduplicate_results([r1, r2])
        assert len(unique) == 1

    def test_different_magnets_both_kept(self):
        svc = ContentSearchService()
        r1 = ContentSearchResult("A", "magnet:?xt=urn:btih:AAA", seeders=10)
        r2 = ContentSearchResult("B", "magnet:?xt=urn:btih:BBB", seeders=20)
        unique = svc._deduplicate_results([r1, r2])
        assert len(unique) == 2

    def test_placeholder_filtered(self):
        svc = ContentSearchService()
        r1 = ContentSearchResult("Real", "magnet:?xt=urn:btih:REAL", seeders=5)
        placeholder = ContentSearchResult("No results", "", seeders=0)
        placeholder.is_placeholder = True
        unique = svc._deduplicate_results([r1, placeholder])
        assert len(unique) == 1
        assert unique[0].title == "Real"


# ===================================================================
# 4. TestSearchFallback
# ===================================================================


class TestSearchFallback:
    @pytest.mark.asyncio
    async def test_tier1_enough_results_skips_tier2(self):
        svc = ContentSearchService()
        results_t1 = [
            ContentSearchResult(f"T{i}", f"magnet:?xt=urn:btih:t1_{i}", seeders=100 - i)
            for i in range(10)
        ]

        async def fake_tier(providers, query, required_results):
            # Only tier1 should be called
            if providers is svc.tier1_providers:
                return results_t1
            # tier2/tier3 should never be reached
            raise AssertionError("tier2/3 should not be called")

        with patch.object(svc, "_search_tier", side_effect=fake_tier):
            results = await svc.search("test", max_results=10)

        assert len(results) == 10
        assert not any(r.is_placeholder for r in results)

    @pytest.mark.asyncio
    async def test_tier1_empty_calls_tier2(self):
        svc = ContentSearchService()
        tier2_results = [
            ContentSearchResult("From T2", "magnet:?xt=urn:btih:t2_0", seeders=5)
        ]
        call_log = []

        async def fake_tier(providers, query, required_results):
            if providers is svc.tier1_providers:
                call_log.append("tier1")
                return []
            if providers is svc.tier2_providers:
                call_log.append("tier2")
                return tier2_results
            call_log.append("tier3")
            return []

        with patch.object(svc, "_search_tier", side_effect=fake_tier):
            results = await svc.search("test", max_results=10)

        assert "tier1" in call_log
        assert "tier2" in call_log
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_all_tiers_empty_returns_fallback(self):
        svc = ContentSearchService()

        async def fake_tier(providers, query, required_results):
            return []

        with patch.object(svc, "_search_tier", side_effect=fake_tier):
            results = await svc.search("nothing_here", max_results=10)

        assert len(results) == 1
        assert results[0].is_placeholder is True

    @pytest.mark.asyncio
    async def test_results_sorted_by_seeders_descending(self):
        svc = ContentSearchService()
        mixed = [
            ContentSearchResult("Low", "magnet:?xt=urn:btih:lo", seeders=1),
            ContentSearchResult("High", "magnet:?xt=urn:btih:hi", seeders=999),
            ContentSearchResult("Mid", "magnet:?xt=urn:btih:mi", seeders=50),
        ]

        async def fake_tier(providers, query, required_results):
            if providers is svc.tier1_providers:
                return mixed
            return []

        with patch.object(svc, "_search_tier", side_effect=fake_tier):
            results = await svc.search("test", max_results=10)

        seeders = [r.seeders for r in results]
        assert seeders == sorted(seeders, reverse=True)


# ===================================================================
# 5. TestSearchProviderParsing
# ===================================================================


class TestSearchProviderParsing:
    @pytest.mark.asyncio
    async def test_bitsearch_parsing(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, text=BITSEARCH_HTML)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_bitsearch("ubuntu")

        assert len(results) == 2
        assert results[0].title == "Ubuntu 24.04 Desktop ISO"
        assert results[0].magnet.startswith("magnet:")
        assert results[0].size == "2.8 GB"
        assert results[0].seeders == 150

    @pytest.mark.asyncio
    async def test_piratebay_parsing(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, json_data=PIRATEBAY_JSON)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_piratebay("bunny")

        assert len(results) == 2
        assert results[0].title == "Big Buck Bunny 720p"
        assert "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c" in results[0].magnet
        assert results[0].seeders == 200

    @pytest.mark.asyncio
    async def test_yts_parsing(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, json_data=YTS_JSON)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_yts("inception")

        assert len(results) == 2
        # Both should have tracker strings in the magnet
        for r in results:
            assert "tr=" in r.magnet
        # Check quality extraction
        qualities = {r.quality for r in results}
        assert "720p" in qualities
        assert "1080p" in qualities

    @pytest.mark.asyncio
    async def test_nyaa_parsing(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, text=NYAA_HTML)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_nyaa_api("naruto")

        assert len(results) == 1
        assert "Naruto" in results[0].title
        assert results[0].magnet.startswith("magnet:")
        assert results[0].size == "350 MiB"
        assert results[0].seeders == 45

    @pytest.mark.asyncio
    async def test_btdigg_infohash_to_magnet(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, text=BTDIGG_HTML)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_btdig_api("film")

        assert len(results) == 1
        assert "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b" in results[0].magnet
        assert "dn=" in results[0].magnet
        assert "tr=" in results[0].magnet
        assert results[0].size == "700 MB"

    @pytest.mark.asyncio
    async def test_piratebay_no_results(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, json_data=PIRATEBAY_NO_RESULTS)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_piratebay("xyznonexistent")

        assert results == []

    @pytest.mark.asyncio
    async def test_yts_no_movies(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=200, json_data=YTS_NO_MOVIES)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            results = await svc._search_yts("xyznonexistent")

        assert results == []

    @pytest.mark.asyncio
    async def test_bitsearch_429_raises_ratelimit(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=429)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            with pytest.raises(RateLimitError):
                await svc._search_bitsearch("test")

    @pytest.mark.asyncio
    async def test_piratebay_429_raises_ratelimit(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=429)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            with pytest.raises(RateLimitError):
                await svc._search_piratebay("test")

    @pytest.mark.asyncio
    async def test_yts_429_raises_ratelimit(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=429)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            with pytest.raises(RateLimitError):
                await svc._search_yts("test")

    @pytest.mark.asyncio
    async def test_nyaa_429_raises_ratelimit(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=429)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            with pytest.raises(RateLimitError):
                await svc._search_nyaa_api("test")

    @pytest.mark.asyncio
    async def test_btdigg_429_raises_ratelimit(self):
        svc = ContentSearchService()
        mock_resp = _mock_response(status_code=429)
        mock_cl = _mock_client(mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_cl):
            with pytest.raises(RateLimitError):
                await svc._search_btdig_api("test")


# ===================================================================
# 6. TestAPIValidation
# ===================================================================


class TestAPIValidation:
    """Test Pydantic request models from app.main."""

    def _import_models(self):
        """Import models; isolated to avoid triggering app startup side effects."""
        from app.main import ContentSearchRequest
        from app.api.media_bridge_api import AddMediaRequest
        return ContentSearchRequest, AddMediaRequest

    # -- ContentSearchRequest --

    def test_valid_query(self):
        CSR, _ = self._import_models()
        req = CSR(query="ubuntu 24.04")
        assert req.query == "ubuntu 24.04"

    def test_query_too_short(self):
        CSR, _ = self._import_models()
        with pytest.raises(Exception):
            CSR(query="a")

    def test_query_too_long(self):
        CSR, _ = self._import_models()
        with pytest.raises(Exception):
            CSR(query="x" * 201)

    def test_query_dangerous_chars(self):
        CSR, _ = self._import_models()
        for ch in ["<", ">", ";", "&", "|"]:
            with pytest.raises(Exception):
                CSR(query=f"test{ch}injection")

    # -- AddMediaRequest --

    def test_valid_magnet_url(self):
        _, AMR = self._import_models()
        req = AMR(magnet_url="magnet:?xt=urn:btih:abc123")
        assert req.magnet_url.startswith("magnet:")

    def test_valid_http_url(self):
        _, AMR = self._import_models()
        req = AMR(magnet_url="https://example.com/file.torrent")
        assert req.magnet_url.startswith("https://")

    def test_invalid_url_prefix(self):
        _, AMR = self._import_models()
        with pytest.raises(Exception):
            AMR(magnet_url="ftp://example.com/bad")

    # -- Room code regex (from app.main.get_room_info) --

    def test_room_code_valid(self):
        import re
        pattern = r"^[A-Z0-9]{1,20}$"
        assert re.match(pattern, "ABC123") is not None

    def test_room_code_invalid(self):
        import re
        pattern = r"^[A-Z0-9]{1,20}$"
        assert re.match(pattern, "abc!@#") is None


# ===================================================================
# 7. TestRateLimitRetry
# ===================================================================


class TestRateLimitRetry:
    @pytest.mark.asyncio
    async def test_first_429_retries_once_after_2s(self):
        """On first 429, the code sleeps 2 s and retries once."""
        svc = ContentSearchService()
        call_count = 0

        async def rate_limited_then_ok(query):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RateLimitError("429")
            return [ContentSearchResult("ok", "magnet:?xt=urn:btih:ok", seeders=1)]

        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            results = await svc._search_with_adaptive_retry(
                "prov", rate_limited_then_ok, "q"
            )

        assert len(results) == 1
        # Should have slept 2 s for the rate-limit back-off
        mock_sleep.assert_any_call(2.0)

    @pytest.mark.asyncio
    async def test_second_429_gives_up(self):
        """If both attempt 0 and attempt 1 get 429, it should break early."""
        svc = ContentSearchService()

        async def always_rate_limited(query):
            raise RateLimitError("429")

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(Exception, match="rate limited"):
                await svc._search_with_adaptive_retry(
                    "prov", always_rate_limited, "q"
                )

    @pytest.mark.asyncio
    async def test_non_429_retries_with_backoff(self):
        """Non-rate-limit errors should use exponential back-off across all retries."""
        svc = ContentSearchService()
        call_count = 0

        async def fail_then_ok(query):
            nonlocal call_count
            call_count += 1
            if call_count <= 3:
                raise ConnectionError("network")
            return [ContentSearchResult("ok", "magnet:?xt=urn:btih:ok", seeders=1)]

        sleep_durations = []

        async def capture_sleep(duration):
            sleep_durations.append(duration)

        with patch("asyncio.sleep", side_effect=capture_sleep):
            results = await svc._search_with_adaptive_retry(
                "prov", fail_then_ok, "q"
            )

        assert len(results) == 1
        assert call_count == 4
        # Backoff durations should be roughly 2^0+jitter, 2^1+jitter, 2^2+jitter
        assert len(sleep_durations) == 3
        assert sleep_durations[0] < 2  # 1 + [0,1)
        assert sleep_durations[1] < 3  # 2 + [0,1)
        assert sleep_durations[2] < 5  # 4 + [0,1)
