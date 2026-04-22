"""
Regression tests for docs/polishing/05-security.md items.

These pin defensive behaviors on the backend: server-side HTML escaping,
magnet URL structural checks, HTTP range parsing, path traversal
protection, and production config fail-fast. Run with:

    pytest tests/test_security.py -v

Each section maps to a specific bug in the security doc.
"""

import html
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.handlers.socket_events import SocketEventHandler  # noqa: E402
from app.services.room_manager import RoomManager  # noqa: E402


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def rm():
    return RoomManager()


@pytest.fixture
def mock_sio():
    sio = AsyncMock()
    sio.on = MagicMock()
    sio.emit = AsyncMock()
    sio.enter_room = AsyncMock()
    sio.disconnect = AsyncMock()
    return sio


@pytest.fixture
def handler(mock_sio, rm):
    return SocketEventHandler(mock_sio, rm)


@pytest.fixture
def populated_room(rm):
    code = rm.create_room("Alice")
    rm.join_room(code, "sid_alice", "Alice", is_host=True)
    rm.join_room(code, "sid_bob", "Bob")
    return code


def _error_payloads(mock_sio):
    return [
        c.args[1]
        for c in mock_sio.emit.call_args_list
        if c.args and c.args[0] == "error"
    ]


def _event_payloads(mock_sio, event_name):
    return [
        c.args[1]
        for c in mock_sio.emit.call_args_list
        if c.args and c.args[0] == event_name
    ]


# ---------------------------------------------------------------------------
# Bug #5.1 — Server-side XSS escaping
# ---------------------------------------------------------------------------


class TestXSSEscaping:
    """The frontend's React auto-escaping is the first line of defense; we
    apply html.escape() at ingress for chat messages and user names so a
    future `dangerouslySetInnerHTML` regression (or a non-browser client)
    still can't read raw HTML tags. See 05-security.md item #5.1."""

    MALICIOUS_SCRIPT = "<script>alert(1)</script>"
    MALICIOUS_IMG = '<img src=x onerror="alert(1)">'

    @pytest.mark.asyncio
    async def test_chat_message_is_html_escaped(self, handler, mock_sio, populated_room, rm):
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_bob", {"message": self.MALICIOUS_SCRIPT})

        room = rm.get_room(populated_room)
        assert room.chat, "expected message to be stored"
        stored = room.chat[-1].message
        assert "<script>" not in stored
        assert stored == html.escape(self.MALICIOUS_SCRIPT)

        # The broadcast payload must also be escaped (the frontend + any
        # non-browser client both see the safe form).
        broadcasts = _event_payloads(mock_sio, "new_message")
        assert broadcasts
        assert broadcasts[-1]["message"] == html.escape(self.MALICIOUS_SCRIPT)

    @pytest.mark.asyncio
    async def test_user_name_is_html_escaped_on_create(self, handler, mock_sio, rm):
        await handler.handle_create_room(
            "sid_mallory",
            {"user_name": self.MALICIOUS_IMG, "room_code": "XSSROOM"},
        )

        room = rm.get_room("XSSROOM")
        assert room is not None
        stored_name = room.users["sid_mallory"].name
        assert "<img" not in stored_name
        assert stored_name == html.escape(self.MALICIOUS_IMG)

    @pytest.mark.asyncio
    async def test_user_name_is_html_escaped_on_join(self, handler, mock_sio, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)

        await handler.handle_join_room(
            "sid_bob", {"room_code": code, "user_name": self.MALICIOUS_IMG}
        )

        room = rm.get_room(code)
        stored_name = room.users["sid_bob"].name
        assert stored_name == html.escape(self.MALICIOUS_IMG)

    @pytest.mark.asyncio
    async def test_safe_message_is_unchanged(self, handler, mock_sio, populated_room, rm):
        """Regression guard: plain text without HTML characters passes through."""
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_bob", {"message": "hello world"})

        room = rm.get_room(populated_room)
        assert room.chat[-1].message == "hello world"


# ---------------------------------------------------------------------------
# Bug #5.2 — Magnet URL structural check
# ---------------------------------------------------------------------------


class TestMagnetUrlValidation:
    """The plain prefix check (startswith 'magnet:') accepted arbitrary
    junk after the scheme. A well-formed magnet URI must include at least
    one `xt=urn:btih:<hash>` parameter where hash is 40 hex chars (SHA-1)
    or 32 base32 chars. See 05-security.md item #5.2."""

    VALID_HEX = "magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a"
    VALID_BASE32 = "magnet:?xt=urn:btih:YEX6DQDLXISUTHOJ6UM3GNNKPQJWPKEK"
    VALID_WITH_TRACKERS = (
        "magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a"
        "&dn=example&tr=udp://tracker.example.com:80"
    )

    @pytest.mark.asyncio
    async def test_queue_add_rejects_magnet_without_xt(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {
                "url": "magnet:?bogus=1",
                "title": "junk",
                "media_type": "media",
            },
        )
        errors = _error_payloads(mock_sio)
        assert errors, "expected error for magnet URL missing xt=urn:btih:"
        room = rm.get_room(populated_room)
        assert room.queue == []

    @pytest.mark.asyncio
    async def test_queue_add_rejects_malformed_hash(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {
                "url": "magnet:?xt=urn:btih:notahash",
                "title": "junk",
                "media_type": "media",
            },
        )
        errors = _error_payloads(mock_sio)
        assert errors

    @pytest.mark.asyncio
    async def test_queue_add_accepts_hex_magnet(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {"url": self.VALID_HEX, "title": "ok", "media_type": "media"},
        )
        errors = _error_payloads(mock_sio)
        assert not errors, f"unexpected errors for valid hex magnet: {errors}"

    @pytest.mark.asyncio
    async def test_queue_add_accepts_base32_magnet(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {"url": self.VALID_BASE32, "title": "ok", "media_type": "media"},
        )
        errors = _error_payloads(mock_sio)
        assert not errors

    @pytest.mark.asyncio
    async def test_queue_add_accepts_magnet_with_tracker_params(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {"url": self.VALID_WITH_TRACKERS, "title": "ok", "media_type": "media"},
        )
        errors = _error_payloads(mock_sio)
        assert not errors


# ---------------------------------------------------------------------------
# Bug #5.3 — HTTP Range header hardening
# ---------------------------------------------------------------------------


class TestRangeHeaderParsing:
    """A pure parser extracted from media_bridge_api so the edge cases can
    be exercised without spinning up FastAPI. See 05-security.md item #5.3."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.api.media_bridge_api import parse_range_header  # noqa: E402
        self.parse = parse_range_header

    def test_normal_bytes_range_is_parsed(self):
        assert self.parse("bytes=0-99", 1000) == (0, 99)

    def test_missing_end_clamps_to_file_size_minus_one(self):
        assert self.parse("bytes=500-", 1000) == (500, 999)

    def test_missing_start_is_rejected(self):
        # HTTP suffix ranges (bytes=-500) are technically valid but we
        # never produced them; treat as malformed for now.
        assert self.parse("bytes=-500", 1000) is None

    def test_end_greater_than_file_size_is_clamped(self):
        assert self.parse("bytes=0-9999", 1000) == (0, 999)

    def test_start_beyond_file_size_returns_none(self):
        assert self.parse("bytes=1500-1600", 1000) is None

    def test_non_numeric_start_returns_none(self):
        assert self.parse("bytes=abc-99", 1000) is None

    def test_non_numeric_end_returns_none(self):
        assert self.parse("bytes=0-zzz", 1000) is None

    def test_missing_bytes_prefix_returns_none(self):
        assert self.parse("items=0-99", 1000) is None

    def test_multiple_dashes_return_none(self):
        assert self.parse("bytes=0-10-20", 1000) is None

    def test_negative_start_returns_none(self):
        assert self.parse("bytes=-5-10", 1000) is None

    def test_empty_header_returns_none(self):
        assert self.parse("", 1000) is None

    def test_start_greater_than_end_returns_none(self):
        assert self.parse("bytes=500-100", 1000) is None


# ---------------------------------------------------------------------------
# Bug #5.4 — Path traversal via symlink
# ---------------------------------------------------------------------------


class TestPathTraversalProtection:
    """A `..` in a torrent's file path is caught by `normpath`, but a
    *symlink* inside the temp dir pointing outside it is not. Switching
    to `realpath` resolves the symlink first so the containment check
    is meaningful. See 05-security.md item #5.4."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.services.media_bridge import safe_media_path
        self.safe_media_path = safe_media_path

    def test_plain_nested_path_is_accepted(self, tmp_path):
        base = tmp_path / "media"
        base.mkdir()
        result = self.safe_media_path(str(base), "movie.mp4")
        assert result is not None
        assert result.endswith("movie.mp4")

    def test_parent_traversal_is_rejected(self, tmp_path):
        base = tmp_path / "media"
        base.mkdir()
        outside = tmp_path / "secrets.txt"
        outside.write_text("oops")

        assert self.safe_media_path(str(base), "../secrets.txt") is None

    def test_symlink_escaping_base_is_rejected(self, tmp_path):
        """The original `normpath`-only check passed this case."""
        base = tmp_path / "media"
        base.mkdir()
        outside = tmp_path / "secret.mkv"
        outside.write_text("x")

        # Symlink inside base that points outside.
        link = base / "naughty.mkv"
        os.symlink(outside, link)

        assert self.safe_media_path(str(base), "naughty.mkv") is None

    def test_symlink_inside_base_is_accepted(self, tmp_path):
        base = tmp_path / "media"
        base.mkdir()
        target = base / "real.mp4"
        target.write_text("y")
        link = base / "alias.mp4"
        os.symlink(target, link)

        result = self.safe_media_path(str(base), "alias.mp4")
        assert result is not None
        # realpath resolves to the actual target, still inside base.
        assert os.path.dirname(result) == str(base.resolve())

    def test_nonexistent_child_of_base_is_accepted_for_future_write(self, tmp_path):
        """libtorrent often asks about paths that aren't on disk yet; the
        helper should evaluate containment based on the lexical result."""
        base = tmp_path / "media"
        base.mkdir()
        result = self.safe_media_path(str(base), "not-yet-downloaded.mp4")
        assert result is not None


# ---------------------------------------------------------------------------
# Bugs #5.5 + #5.6 — Production config fail-fast
# ---------------------------------------------------------------------------


class TestProductionConfigFailFast:
    """When ENV=production, startup refuses to boot with the in-repo
    SECRET_KEY default or a wildcard CORS policy. See 05-security.md
    items #5.5 and #5.6."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.config import (
            validate_production_config,
            DEFAULT_SECRET_KEY,
        )
        self.validate = validate_production_config
        self.default_key = DEFAULT_SECRET_KEY

    def test_dev_env_allows_defaults(self, monkeypatch):
        monkeypatch.setenv("ENV", "development")
        monkeypatch.setenv("SECRET_KEY", self.default_key)
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
        # Doesn't raise.
        self.validate()

    def test_production_rejects_default_secret_key(self, monkeypatch):
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setenv("SECRET_KEY", self.default_key)
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://example.com")
        with pytest.raises(RuntimeError, match=r"SECRET_KEY"):
            self.validate()

    def test_production_rejects_missing_secret_key(self, monkeypatch):
        monkeypatch.setenv("ENV", "production")
        monkeypatch.delenv("SECRET_KEY", raising=False)
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://example.com")
        with pytest.raises(RuntimeError, match=r"SECRET_KEY"):
            self.validate()

    def test_production_rejects_wildcard_cors(self, monkeypatch):
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setenv("SECRET_KEY", "a-real-strong-secret-key-value")
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
        with pytest.raises(RuntimeError, match=r"CORS"):
            self.validate()

    def test_production_rejects_missing_cors(self, monkeypatch):
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setenv("SECRET_KEY", "a-real-strong-secret-key-value")
        monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
        with pytest.raises(RuntimeError, match=r"CORS"):
            self.validate()

    def test_production_accepts_explicit_config(self, monkeypatch):
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setenv("SECRET_KEY", "a-real-strong-secret-key-value")
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://watch.example.com")
        # Doesn't raise.
        self.validate()


# ---------------------------------------------------------------------------
# Bug #5.7 — Per-sid socket rate limiting
# ---------------------------------------------------------------------------


class TestSlidingWindowLimiter:
    """Unit-test the pure sliding-window limiter used by the Socket.IO
    event dispatcher. See 05-security.md item #5.7."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.handlers.rate_limit import SlidingWindowLimiter
        self.Cls = SlidingWindowLimiter

    def test_allows_events_under_the_cap(self):
        lim = self.Cls(max_events=5, window_seconds=1.0, now=lambda: 0.0)
        for _ in range(5):
            assert lim.allow("sid-a") is True

    def test_blocks_events_over_the_cap_in_same_window(self):
        lim = self.Cls(max_events=5, window_seconds=1.0, now=lambda: 0.0)
        for _ in range(5):
            lim.allow("sid-a")
        assert lim.allow("sid-a") is False

    def test_window_slides_forward(self):
        time_now = [0.0]
        lim = self.Cls(max_events=2, window_seconds=1.0, now=lambda: time_now[0])
        assert lim.allow("sid-a") is True
        time_now[0] = 0.5
        assert lim.allow("sid-a") is True
        time_now[0] = 0.9
        assert lim.allow("sid-a") is False  # cap hit

        # Advance past the first event's window.
        time_now[0] = 1.51
        assert lim.allow("sid-a") is True  # first event aged out

    def test_isolates_keys(self):
        lim = self.Cls(max_events=1, window_seconds=1.0, now=lambda: 0.0)
        assert lim.allow("sid-a") is True
        assert lim.allow("sid-b") is True  # different key
        assert lim.allow("sid-a") is False  # same key over cap

    def test_forget_clears_key(self):
        time_now = [0.0]
        lim = self.Cls(max_events=1, window_seconds=1.0, now=lambda: time_now[0])
        assert lim.allow("sid-a") is True
        assert lim.allow("sid-a") is False
        lim.forget("sid-a")
        assert lim.allow("sid-a") is True


class TestHandlerRateLimiting:
    """End-to-end check that send_message is throttled once the limit is
    reached. The default is 10 events per second per sid; we instantiate
    the handler with a tighter cap to keep the test fast."""

    @pytest.fixture
    def rm(self):
        return RoomManager()

    @pytest.fixture
    def mock_sio(self):
        sio = AsyncMock()
        sio.on = MagicMock()
        sio.emit = AsyncMock()
        sio.enter_room = AsyncMock()
        sio.disconnect = AsyncMock()
        return sio

    @pytest.fixture
    def handler(self, mock_sio, rm):
        h = SocketEventHandler(mock_sio, rm)
        # Tighten the cap for this test (the handler exposes the
        # limiter for injection in tests only).
        from app.handlers.rate_limit import SlidingWindowLimiter
        h._rate_limiter = SlidingWindowLimiter(max_events=3, window_seconds=60.0)
        return h

    @pytest.fixture
    def populated_room(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob")
        return code

    @pytest.mark.asyncio
    async def test_rapid_send_message_gets_throttled(
        self, handler, mock_sio, populated_room
    ):
        # With cap=3, the first 3 messages succeed; the 4th is rejected
        # with an 'error' event mentioning rate limit.
        for i in range(3):
            await handler.handle_send_message("sid_bob", {"message": f"msg {i}"})
        mock_sio.emit.reset_mock()

        await handler.handle_send_message("sid_bob", {"message": "msg 4"})

        error_calls = [
            c for c in mock_sio.emit.call_args_list
            if c.args and c.args[0] == "error"
        ]
        assert error_calls, "expected an 'error' emit on the 4th message"
        msg = error_calls[-1].args[1]["message"].lower()
        assert "rate" in msg or "too fast" in msg or "slow" in msg

    @pytest.mark.asyncio
    async def test_other_sids_not_affected(
        self, handler, mock_sio, populated_room
    ):
        for i in range(3):
            await handler.handle_send_message("sid_alice", {"message": f"a{i}"})

        # Bob's first message should still succeed.
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_bob", {"message": "hi"})

        error_calls = [
            c for c in mock_sio.emit.call_args_list
            if c.args and c.args[0] == "error"
        ]
        assert not error_calls
