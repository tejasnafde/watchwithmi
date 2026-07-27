"""
Regression tests for the search-layer diagnostics & placeholder hygiene.

Covers:
  - ContentSearchService.diagnose() returns one entry per provider with
    {provider, ok, result_count, latency_ms, error}.
  - GET /api/diag/search returns the same structure end-to-end.
  - POST /api/search-content strips is_placeholder rows from the response
    and surfaces an `all_providers_failed` flag.
  - _browser_headers() includes Accept / Accept-Language / Accept-Encoding
    on top of User-Agent.

Run with:
    pytest tests/test_search_diagnostics.py -v
"""

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.p2p_search import (  # noqa: E402
    ContentSearchResult,
    ContentSearchService,
    _browser_headers,
)


# ---------------------------------------------------------------------------
# _browser_headers
# ---------------------------------------------------------------------------


class TestBrowserHeaders:
    """Real browsers send more than just UA; sending UA-only is the easiest
    bot fingerprint for a provider to flag."""

    def test_includes_user_agent(self):
        headers = _browser_headers()
        assert "User-Agent" in headers
        assert "Mozilla" in headers["User-Agent"]

    def test_includes_accept_language_and_encoding(self):
        headers = _browser_headers()
        assert "Accept" in headers
        assert "Accept-Language" in headers
        assert "Accept-Encoding" in headers

    def test_referer_is_optional(self):
        assert "Referer" not in _browser_headers()
        assert _browser_headers(referer="https://x/")["Referer"] == "https://x/"


# ---------------------------------------------------------------------------
# ContentSearchService.diagnose
# ---------------------------------------------------------------------------


class TestSearchDiagnose:
    @pytest.mark.asyncio
    async def test_returns_one_entry_per_provider(self):
        svc = ContentSearchService()
        # Stub every provider so we don't hit the network.
        async def _ok(_q):
            return [ContentSearchResult("Title", "magnet:?xt=urn:btih:" + "a" * 40)]

        async def _fail(_q):
            raise RuntimeError("simulated outage")

        svc.tier1_providers = [("alpha", _ok), ("beta", _fail)]
        svc.tier2_providers = []
        svc.tier3_providers = [("gamma", _ok)]

        result = await svc.diagnose("test")

        names = [p["provider"] for p in result["providers"]]
        assert names == ["alpha", "beta", "gamma"]

    @pytest.mark.asyncio
    async def test_records_ok_and_error_separately(self):
        svc = ContentSearchService()

        async def _ok(_q):
            return [ContentSearchResult("Title", "magnet:?xt=urn:btih:" + "a" * 40)]

        async def _fail(_q):
            raise RuntimeError("boom")

        svc.tier1_providers = [("ok_one", _ok), ("bad_one", _fail)]
        svc.tier2_providers = []
        svc.tier3_providers = []

        report = await svc.diagnose("anything")

        by_name = {p["provider"]: p for p in report["providers"]}
        assert by_name["ok_one"]["ok"] is True
        assert by_name["ok_one"]["result_count"] == 1
        assert by_name["ok_one"]["error"] is None
        assert by_name["bad_one"]["ok"] is False
        assert "boom" in by_name["bad_one"]["error"]
        assert by_name["bad_one"]["result_count"] == 0

    @pytest.mark.asyncio
    async def test_envelope_fields(self):
        svc = ContentSearchService()

        async def _ok(_q):
            return [ContentSearchResult("T", "magnet:?xt=urn:btih:" + "b" * 40)]

        svc.tier1_providers = [("p", _ok)]
        svc.tier2_providers = []
        svc.tier3_providers = []

        report = await svc.diagnose("hello world")

        assert report["query"] == "hello world"
        assert "cloudscraper_available" in report
        assert isinstance(report["cloudscraper_available"], bool)
        assert report["total_results"] == 1


# ---------------------------------------------------------------------------
# Placeholder stripping in /api/search-content
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def media_bridge_enabled(monkeypatch):
    """Turn the WIP P2P feature on for the duration of one test.

    The search and media endpoints ship gated behind
    ``config.MEDIA_BRIDGE_ENABLED`` (default false), so tests that exercise the
    real search behaviour have to opt in. Each module reads the flag from its
    own namespace at call time, so both have to be patched: ``app.main`` for the
    search/diag routes and ``app.api.media_bridge_api`` for the router-level
    dependency guarding ``/api/media/*``.
    """
    monkeypatch.setattr("app.main.MEDIA_BRIDGE_ENABLED", True)
    monkeypatch.setattr("app.api.media_bridge_api.MEDIA_BRIDGE_ENABLED", True)


def _placeholder_result() -> ContentSearchResult:
    r = ContentSearchResult(title="No results found for 'x'", magnet="")
    r.is_placeholder = True
    return r


def _real_result() -> ContentSearchResult:
    return ContentSearchResult(
        title="Big Buck Bunny 1080p",
        magnet="magnet:?xt=urn:btih:" + "f" * 40,
        size="1.5 GB",
        seeders=42,
        leechers=3,
    )


@pytest.mark.usefixtures("media_bridge_enabled")
class TestSearchContentPlaceholderHygiene:
    def test_strips_placeholder_when_real_results_exist(self, client):
        with patch("app.main.content_search.search", new=AsyncMock(
            return_value=[_real_result(), _placeholder_result()]
        )):
            resp = client.post("/api/search-content", json={"query": "buck"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["all_providers_failed"] is False
        assert all(not r["is_placeholder"] for r in body["results"])

    def test_all_placeholder_yields_empty_results_with_flag(self, client):
        with patch("app.main.content_search.search", new=AsyncMock(
            return_value=[_placeholder_result()]
        )):
            resp = client.post("/api/search-content", json={"query": "nothing"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 0
        assert body["results"] == []
        assert body["all_providers_failed"] is True

    def test_real_results_only_passes_through_unchanged(self, client):
        with patch("app.main.content_search.search", new=AsyncMock(
            return_value=[_real_result(), _real_result()]
        )):
            resp = client.post("/api/search-content", json={"query": "buck"})
        body = resp.json()
        assert body["count"] == 2
        assert body["all_providers_failed"] is False


# ---------------------------------------------------------------------------
# GET /api/diag/search end-to-end
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("media_bridge_enabled")
class TestDiagSearchEndpoint:
    def test_requires_non_empty_query(self, client):
        resp = client.get("/api/diag/search?q=")
        assert resp.status_code == 400

    def test_returns_per_provider_report(self, client):
        async def fake_diagnose(q):
            return {
                "query": q,
                "cloudscraper_available": True,
                "total_results": 3,
                "providers": [
                    {"provider": "bitsearch", "ok": False, "result_count": 0,
                     "latency_ms": 12, "error": "HTTPStatusError: 523"},
                    {"provider": "piratebay", "ok": True, "result_count": 3,
                     "latency_ms": 800, "error": None},
                ],
            }

        with patch("app.main.content_search.diagnose", new=AsyncMock(side_effect=fake_diagnose)):
            resp = client.get("/api/diag/search?q=ubuntu")

        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "ubuntu"
        assert body["total_results"] == 3
        assert {p["provider"] for p in body["providers"]} == {"bitsearch", "piratebay"}


# ---------------------------------------------------------------------------
# WIP gate on the P2P surface
# ---------------------------------------------------------------------------


class TestMediaBridgeWipGate:
    """The P2P/torrent surface ships disabled. These assert the gate holds,
    because the failure mode if it silently opens is a server that starts
    downloading torrents on a shared cloud project.

    Note there is no `media_bridge_enabled` fixture here: this class deliberately
    exercises the default (off) configuration.
    """

    def test_search_content_is_gated(self, client):
        resp = client.post("/api/search-content", json={"query": "anything"})
        assert resp.status_code == 501
        assert "work in progress" in resp.json()["detail"].lower()

    def test_diag_search_is_gated(self, client):
        assert client.get("/api/diag/search?q=ubuntu").status_code == 501

    def test_diag_search_raw_is_gated(self, client):
        assert client.get("/api/diag/search/raw?q=ubuntu").status_code == 501

    @pytest.mark.parametrize("path", ["/api/media/list", "/api/media/status/abc"])
    def test_media_routes_are_gated(self, client, path):
        assert client.get(path).status_code == 501

    def test_media_add_is_gated(self, client):
        resp = client.post(
            "/api/media/add",
            json={"magnet_url": "magnet:?xt=urn:btih:" + "0" * 40},
        )
        assert resp.status_code == 501

    def test_gate_is_not_503_so_the_player_does_not_retry(self, client):
        """MediaPlayer.tsx treats 503 as "still buffering" and retries five
        times with backoff. A disabled feature must not look retryable."""
        assert client.get("/api/media/list").status_code != 503

    def test_health_is_not_gated(self, client):
        assert client.get("/health").status_code == 200
