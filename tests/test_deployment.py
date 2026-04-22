"""
Regression tests for docs/polishing/06-deployment-scaling.md items.

Covers:
  - /health JSON endpoint
  - content_type_for mapping (including the MKV fix)
  - RoomManager.cleanup_stale_sessions(active_sids) — orphaned-session sweep

Run with:
    pytest tests/test_deployment.py -v
"""

import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.api.media_bridge_api import content_type_for  # noqa: E402
from app.services.room_manager import RoomManager  # noqa: E402


# ---------------------------------------------------------------------------
# #06 "Content-Type for MKV files"
# ---------------------------------------------------------------------------


class TestContentTypeMapping:
    """Browsers refuse MKV when served as video/webm because the webm codec
    assumptions don't match. Map-based lookup so new extensions are easy
    to add and the MKV-specific regression can't silently come back."""

    def test_mp4_is_video_mp4(self):
        assert content_type_for("movie.mp4") == "video/mp4"

    def test_mkv_is_x_matroska_not_webm(self):
        # The specific regression this test pins.
        assert content_type_for("movie.mkv") == "video/x-matroska"
        assert content_type_for("movie.mkv") != "video/webm"

    def test_webm_is_video_webm(self):
        assert content_type_for("movie.webm") == "video/webm"

    def test_unknown_extension_falls_back_to_mp4(self):
        assert content_type_for("archive.zip") == "video/mp4"

    def test_case_insensitive(self):
        assert content_type_for("MOVIE.MKV") == "video/x-matroska"


# ---------------------------------------------------------------------------
# #06 "No real /health endpoint"
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """Dockerfile / Render healthcheck hits /health; needs a JSON response
    with enough structure to detect partial failures."""

    @pytest.fixture
    def client(self):
        # Use TestClient as a context manager so FastAPI runs the
        # `lifespan` function — that's what initializes room_manager,
        # which /health reports on.
        from app.main import app
        with TestClient(app) as c:
            yield c

    def test_returns_200_with_json_body(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        # Must be JSON, not HTML (which is what `/` currently serves).
        assert resp.headers["content-type"].startswith("application/json")

    def test_body_reports_status_and_room_count(self, client):
        resp = client.get("/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert "room_count" in body
        assert isinstance(body["room_count"], int)
        assert body["room_count"] >= 0

    def test_body_reports_uptime_seconds(self, client):
        resp = client.get("/health")
        body = resp.json()
        assert "uptime_s" in body
        assert isinstance(body["uptime_s"], (int, float))
        assert body["uptime_s"] >= 0

    def test_body_does_not_return_html(self, client):
        """Guard against a regression where someone wires a static-file
        handler over /health."""
        resp = client.get("/health")
        assert "<html" not in resp.text.lower()


# ---------------------------------------------------------------------------
# #06 "No cleanup job for orphaned sessions"
# ---------------------------------------------------------------------------


class TestOrphanedSessionCleanup:
    """A socket that vanishes without a clean disconnect (network drop,
    mobile background, etc.) can leave a user entry in a room's users
    map. We add a periodic sweep that takes the list of currently-active
    sids from Socket.IO and removes any RoomManager user whose sid is
    not in that set."""

    @pytest.fixture
    def rm(self):
        return RoomManager()

    def test_removes_orphaned_user_from_room(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob")

        # Socket.IO says only Alice is still connected.
        removed = rm.cleanup_stale_sessions({"sid_alice"})

        room = rm.get_room(code)
        assert "sid_bob" not in room.users
        assert "sid_alice" in room.users
        assert removed == 1

    def test_does_not_remove_users_with_active_sids(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob")

        removed = rm.cleanup_stale_sessions({"sid_alice", "sid_bob"})

        room = rm.get_room(code)
        assert set(room.users.keys()) == {"sid_alice", "sid_bob"}
        assert removed == 0

    def test_removes_orphaned_session_records(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_ghost", "Ghost")

        rm.cleanup_stale_sessions({"sid_alice"})

        # The _user_sessions dict also drops the stale entry so reconnect
        # logic doesn't see phantom session data.
        assert rm.get_user_session("sid_ghost") is None

    def test_deletes_room_if_cleanup_empties_it(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)

        # Nobody active — whole room should go.
        rm.cleanup_stale_sessions(set())

        assert rm.get_room(code) is None

    def test_handles_empty_state_without_error(self, rm):
        # No rooms, nothing to clean.
        assert rm.cleanup_stale_sessions({"anything"}) == 0

    def test_transfers_host_when_host_is_removed(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        # Small delay so Bob's joined_at_ts is strictly later than Alice's
        # (the host-transfer picks the earliest-joined user).
        time.sleep(0.01)
        rm.join_room(code, "sid_bob", "Bob")

        # Alice's socket vanished.
        rm.cleanup_stale_sessions({"sid_bob"})

        room = rm.get_room(code)
        assert room.host_id == "sid_bob"
        assert room.users["sid_bob"].is_host is True
