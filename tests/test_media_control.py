"""
Regression tests for media control bugs: buffer glitch prevention,
URL/type validation, playlist validation, permission cascades,
concurrent events, and state consistency.

Run with: pytest tests/test_media_control.py -v
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.room_manager import RoomManager
from app.handlers.socket_events import SocketEventHandler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def rm():
    """Fresh RoomManager for each test."""
    return RoomManager()


@pytest.fixture
def populated_room(rm):
    """A room with a host and two other users already joined."""
    code = rm.create_room("Alice")
    rm.join_room(code, "sid_alice", "Alice", is_host=True)
    rm.join_room(code, "sid_bob", "Bob")
    rm.join_room(code, "sid_carol", "Carol")
    return code


@pytest.fixture
def mock_sio():
    """Mock Socket.IO async server."""
    sio = AsyncMock()
    sio.on = MagicMock()  # .on() is called synchronously during __init__
    sio.emit = AsyncMock()
    sio.enter_room = AsyncMock()
    return sio


@pytest.fixture
def handler(mock_sio, rm):
    """SocketEventHandler backed by real RoomManager and mocked sio."""
    return SocketEventHandler(mock_sio, rm)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _error_calls(mock_sio):
    """Return list of (event, payload, kwargs) tuples for 'error' emissions."""
    return [c for c in mock_sio.emit.call_args_list if c[0][0] == "error"]


def _event_calls(mock_sio, event_name):
    """Return list of call objects for a specific event name."""
    return [c for c in mock_sio.emit.call_args_list if c[0][0] == event_name]


def _set_room_timestamp(rm, room_code, timestamp, state="playing"):
    """Directly set the room media timestamp and state for test setup."""
    room = rm.get_room(room_code)
    room.media.timestamp = timestamp
    room.media.state = state


# ===================================================================
# 1. TestBufferGlitchPrevention
# ===================================================================


class TestBufferGlitchPrevention:
    """Tests for the timestamp=0 rejection guard that prevents buffer glitches."""

    @pytest.mark.asyncio
    async def test_pause_at_zero_rejected_when_room_past_30(self, handler, rm, mock_sio, populated_room):
        """Host plays video at 120s, pause arrives with timestamp=0 -- rejected."""
        _set_room_timestamp(rm, populated_room, 120.0, "playing")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 0}
        )

        # Should NOT have emitted media_pause
        pause_calls = _event_calls(mock_sio, "media_pause")
        assert len(pause_calls) == 0

        # Room timestamp should remain unchanged
        room = rm.get_room(populated_room)
        assert room.media.timestamp == 120.0
        assert room.media.state == "playing"

    @pytest.mark.asyncio
    async def test_pause_at_115_accepted_when_room_at_120(self, handler, rm, mock_sio, populated_room):
        """Host plays at 120s, pause arrives with timestamp=115 -- accepted (normal pause)."""
        _set_room_timestamp(rm, populated_room, 120.0, "playing")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 115}
        )

        pause_calls = _event_calls(mock_sio, "media_pause")
        assert len(pause_calls) == 1

        room = rm.get_room(populated_room)
        assert room.media.state == "paused"
        assert room.media.timestamp == 115

    @pytest.mark.asyncio
    async def test_seek_to_zero_rejected_when_room_past_30(self, handler, rm, mock_sio, populated_room):
        """Host plays at 120s, seek arrives with timestamp=0 -- rejected."""
        _set_room_timestamp(rm, populated_room, 120.0, "playing")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "seek", "timestamp": 0}
        )

        seek_calls = _event_calls(mock_sio, "media_seek")
        assert len(seek_calls) == 0

        room = rm.get_room(populated_room)
        assert room.media.timestamp == 120.0

    @pytest.mark.asyncio
    async def test_pause_at_zero_accepted_when_room_under_30(self, handler, rm, mock_sio, populated_room):
        """Host plays at 25s, pause at 0 -- accepted (room timestamp < 30, guard doesn't apply)."""
        _set_room_timestamp(rm, populated_room, 25.0, "playing")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 0}
        )

        pause_calls = _event_calls(mock_sio, "media_pause")
        assert len(pause_calls) == 1

        room = rm.get_room(populated_room)
        assert room.media.state == "paused"
        assert room.media.timestamp == 0

    @pytest.mark.asyncio
    async def test_play_at_zero_rejected_when_room_past_30(self, handler, rm, mock_sio, populated_room):
        """Play event with timestamp=0 when room at 120s -- rejected."""
        _set_room_timestamp(rm, populated_room, 120.0, "paused")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 0}
        )

        play_calls = _event_calls(mock_sio, "media_play")
        assert len(play_calls) == 0

        room = rm.get_room(populated_room)
        assert room.media.timestamp == 120.0
        assert room.media.state == "paused"

    @pytest.mark.asyncio
    async def test_buffer_glitch_silent_rejection(self, handler, rm, mock_sio, populated_room):
        """Verify the handler silently returns without emitting an error on buffer glitch.

        The current implementation does a bare ``return`` (no error emitted to client).
        """
        _set_room_timestamp(rm, populated_room, 120.0, "playing")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 0}
        )

        # The handler does a silent return -- no error, no pause
        error_calls = _error_calls(mock_sio)
        pause_calls = _event_calls(mock_sio, "media_pause")
        assert len(pause_calls) == 0
        # The current code does NOT emit an error on buffer glitch -- it silently drops
        assert len(error_calls) == 0


# ===================================================================
# 2. TestMediaURLValidation
# ===================================================================


class TestMediaURLValidation:
    """Tests for media URL and type validation on the 'change' action."""

    # -- Valid URLs --

    @pytest.mark.asyncio
    async def test_valid_url_http(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "http://example.com/vid.mp4", "type": "video", "title": "T"},
        )
        assert len(_error_calls(mock_sio)) == 0
        assert len(_event_calls(mock_sio, "media_changed")) == 1

    @pytest.mark.asyncio
    async def test_valid_url_https(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://youtube.com/watch?v=abc", "type": "youtube", "title": "T"},
        )
        assert len(_error_calls(mock_sio)) == 0
        assert len(_event_calls(mock_sio, "media_changed")) == 1

    @pytest.mark.asyncio
    async def test_valid_url_magnet(self, handler, rm, mock_sio, populated_room):
        # Full SHA-1 info hash (40 hex chars) is what a real magnet would
        # carry. The prior lax check accepted the truncated form — tightened
        # by bug #5.2 in docs/polishing/05-security.md.
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {
                "action": "change",
                "url": "magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a",
                "type": "video",
                "title": "T",
            },
        )
        assert len(_error_calls(mock_sio)) == 0

    @pytest.mark.asyncio
    async def test_valid_url_absolute_path(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "/path/to/local/file.mp4", "type": "video", "title": "T"},
        )
        assert len(_error_calls(mock_sio)) == 0

    # -- Invalid URLs --

    @pytest.mark.asyncio
    async def test_invalid_url_javascript(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "javascript:alert(1)", "type": "video"},
        )
        mock_sio.emit.assert_any_call("error", {"message": "Invalid media URL"}, room="sid_alice")

    @pytest.mark.asyncio
    async def test_invalid_url_ftp(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "ftp://files.example.com/vid.avi", "type": "video"},
        )
        mock_sio.emit.assert_any_call("error", {"message": "Invalid media URL"}, room="sid_alice")

    @pytest.mark.asyncio
    async def test_invalid_url_data(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "data:text/html,<h1>hi</h1>", "type": "video"},
        )
        mock_sio.emit.assert_any_call("error", {"message": "Invalid media URL"}, room="sid_alice")

    @pytest.mark.asyncio
    async def test_invalid_url_empty(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "", "type": "video"},
        )
        mock_sio.emit.assert_any_call("error", {"message": "Invalid media URL"}, room="sid_alice")

    # -- Valid media types --

    @pytest.mark.asyncio
    @pytest.mark.parametrize("media_type", ["youtube", "video", "audio", "media"])
    async def test_valid_media_types(self, handler, rm, mock_sio, populated_room, media_type):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://example.com/v", "type": media_type, "title": "T"},
        )
        assert len(_error_calls(mock_sio)) == 0

    # -- Invalid media types --

    @pytest.mark.asyncio
    @pytest.mark.parametrize("media_type", ["script", "html", "unknown", ""])
    async def test_invalid_media_types(self, handler, rm, mock_sio, populated_room, media_type):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://example.com/v", "type": media_type},
        )
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1
        # Verify the error message mentions valid types
        error_msg = errors[0][0][1]["message"]
        assert "Invalid media type" in error_msg

    # -- Combined invalid cases --

    @pytest.mark.asyncio
    async def test_valid_url_invalid_type_rejected(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://example.com/v", "type": "podcast"},
        )
        assert len(_error_calls(mock_sio)) >= 1
        assert len(_event_calls(mock_sio, "media_changed")) == 0

    @pytest.mark.asyncio
    async def test_invalid_url_valid_type_rejected(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "ftp://bad.url/file.avi", "type": "video"},
        )
        assert len(_error_calls(mock_sio)) >= 1
        assert len(_event_calls(mock_sio, "media_changed")) == 0


# ===================================================================
# 3. TestPlaylistValidation
# ===================================================================


class TestPlaylistValidation:
    """Tests for playlist loading and navigation edge cases."""

    @pytest.mark.asyncio
    async def test_load_playlist_empty_items_rejected(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "load_playlist", "items": [], "playlist_id": "PL1"},
        )
        mock_sio.emit.assert_any_call(
            "error", {"message": "Playlist has no playable items"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_load_playlist_valid_items_accepted(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        await handler.handle_media_control(
            "sid_alice",
            {"action": "load_playlist", "items": items, "playlist_id": "PL1", "playlist_title": "My PL"},
        )
        assert len(_error_calls(mock_sio)) == 0
        assert len(_event_calls(mock_sio, "media_changed")) == 1

        room = rm.get_room(populated_room)
        assert room.media.is_playlist is True
        assert len(room.media.playlist_items) == 2
        assert room.media.current_index == 0

    @pytest.mark.asyncio
    async def test_load_playlist_first_item_no_url_rejected(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        items = [
            {"url": "", "title": "No URL"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        await handler.handle_media_control(
            "sid_alice",
            {"action": "load_playlist", "items": items, "playlist_id": "PL1"},
        )
        # The handler now reports the specific item index via
        # _validate_playlist_items (bug #3.4 in 03-chat-reactions-queue.md);
        # we check the shape of the error rather than a fixed string.
        error_calls = [
            c for c in mock_sio.emit.call_args_list
            if c.args and c.args[0] == "error"
        ]
        assert error_calls, "expected an 'error' emit for missing URL"
        messages = [c.args[1].get("message", "") for c in error_calls]
        assert any("url" in m.lower() for m in messages), (
            f"error message should mention the missing URL; got {messages}"
        )

    @pytest.mark.asyncio
    async def test_playlist_next_no_active_playlist_error(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control("sid_alice", {"action": "playlist_next"})
        mock_sio.emit.assert_any_call(
            "error", {"message": "No active playlist in this room"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_playlist_next_at_end_stays(self, handler, rm, mock_sio, populated_room):
        """Playlist next at the last item stays on the last item (no wrap)."""
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[1]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=1,
            playlist_id="PL1",
            playlist_title="PL",
        )
        mock_sio.emit.reset_mock()

        await handler.handle_media_control("sid_alice", {"action": "playlist_next"})

        # Index should remain at 1 (last item) -- the handler clamps, no wrap
        room = rm.get_room(populated_room)
        assert room.media.current_index == 1

    @pytest.mark.asyncio
    async def test_playlist_prev_at_start_stays(self, handler, rm, mock_sio, populated_room):
        """Playlist prev at the first item stays on the first item (no wrap)."""
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
            playlist_id="PL1",
            playlist_title="PL",
        )
        mock_sio.emit.reset_mock()

        await handler.handle_media_control("sid_alice", {"action": "playlist_prev"})

        room = rm.get_room(populated_room)
        assert room.media.current_index == 0

    @pytest.mark.asyncio
    async def test_playlist_select_out_of_bounds_ignored(self, handler, rm, mock_sio, populated_room):
        """Playlist select with out-of-bounds index stays on current index."""
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
            playlist_id="PL1",
            playlist_title="PL",
        )
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "playlist_select", "index": 99}
        )

        # Out-of-bounds index should be ignored; stays at 0
        room = rm.get_room(populated_room)
        assert room.media.current_index == 0

    @pytest.mark.asyncio
    async def test_playlist_select_valid_index_accepted(self, handler, rm, mock_sio, populated_room):
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
            {"url": "https://youtube.com/watch?v=c", "title": "C"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
            playlist_id="PL1",
            playlist_title="PL",
        )
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "playlist_select", "index": 2}
        )

        room = rm.get_room(populated_room)
        assert room.media.current_index == 2
        assert room.media.url == items[2]["url"]


# ===================================================================
# 4. TestMediaPermissionCascade
# ===================================================================


class TestMediaPermissionCascade:
    """Complex permission scenarios involving grant/revoke and host transfer."""

    @pytest.mark.asyncio
    async def test_host_grants_control_user_can_play_pause(self, handler, rm, mock_sio, populated_room):
        """Host grants control to User A -- User A can play/pause."""
        rm.set_user_control("sid_alice", "sid_bob", True)
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_bob", {"action": "play", "timestamp": 10.0}
        )
        assert len(_event_calls(mock_sio, "media_play")) == 1

        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "pause", "timestamp": 15.0}
        )
        assert len(_event_calls(mock_sio, "media_pause")) == 1

    @pytest.mark.asyncio
    async def test_host_revokes_control_user_cannot_play(self, handler, rm, mock_sio, populated_room):
        """Host grants then revokes control -- User A can no longer play/pause."""
        rm.set_user_control("sid_alice", "sid_bob", True)
        rm.set_user_control("sid_alice", "sid_bob", False)
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_bob", {"action": "play", "timestamp": 10.0}
        )
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "You do not have permission to control media"},
            room="sid_bob",
        )

    @pytest.mark.asyncio
    async def test_host_leaves_new_host_has_control(self, handler, rm, mock_sio, populated_room):
        """Host leaves, User A becomes new host -- automatically has control."""
        room = rm.get_room(populated_room)
        # Ensure Bob joined before Carol
        room.users["sid_bob"].joined_at_ts = 1000.0
        room.users["sid_carol"].joined_at_ts = 2000.0

        new_host = rm.leave_room(populated_room, "sid_alice")
        assert new_host == "sid_bob"

        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].is_host is True
        assert room.users["sid_bob"].can_control is True

        # Bob can now control media
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "play", "timestamp": 5.0}
        )
        assert len(_event_calls(mock_sio, "media_play")) == 1

    @pytest.mark.asyncio
    async def test_non_host_cannot_grant_control(self, handler, rm, mock_sio, populated_room):
        """User A (non-host) tries to grant control to User B -- rejected."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_bob", {"user_id": "sid_carol", "enabled": True}
        )
        mock_sio.emit.assert_any_call(
            "error", {"message": "Action failed or unauthorized"}, room="sid_bob"
        )

        room = rm.get_room(populated_room)
        assert room.users["sid_carol"].can_control is False

    @pytest.mark.asyncio
    async def test_host_grants_control_then_changes_media(self, handler, rm, mock_sio, populated_room):
        """Host grants control, then host changes media -- both operations succeed."""
        rm.set_user_control("sid_alice", "sid_bob", True)
        mock_sio.emit.reset_mock()

        # Host changes media
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://youtube.com/watch?v=new", "type": "youtube", "title": "New"},
        )
        assert len(_event_calls(mock_sio, "media_changed")) == 1

        # Bob still has control
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "play", "timestamp": 0}
        )
        assert len(_event_calls(mock_sio, "media_play")) == 1

    @pytest.mark.asyncio
    async def test_two_users_with_control_both_can_act(self, handler, rm, mock_sio, populated_room):
        """Two users with control -- one pauses, one plays -- both should work."""
        rm.set_user_control("sid_alice", "sid_bob", True)
        rm.set_user_control("sid_alice", "sid_carol", True)

        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "pause", "timestamp": 20.0}
        )
        assert len(_event_calls(mock_sio, "media_pause")) == 1

        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_carol", {"action": "play", "timestamp": 20.0}
        )
        assert len(_event_calls(mock_sio, "media_play")) == 1


# ===================================================================
# 5. TestConcurrentMediaEvents
# ===================================================================


class TestConcurrentMediaEvents:
    """Race condition and concurrent event tests."""

    @pytest.mark.asyncio
    async def test_unauthorized_and_authorized_simultaneous(self, handler, rm, mock_sio, populated_room):
        """Two users emit media_control simultaneously -- only authorized ones succeed."""
        mock_sio.emit.reset_mock()

        # Alice (host, authorized) and Bob (no control) both send play.
        # We don't inspect the return values — the assertion is on mock_sio emits.
        await asyncio.gather(
            handler.handle_media_control("sid_alice", {"action": "play", "timestamp": 10.0}),
            handler.handle_media_control("sid_bob", {"action": "play", "timestamp": 10.0}),
        )

        play_calls = _event_calls(mock_sio, "media_play")
        error_calls = _error_calls(mock_sio)

        # Alice should succeed, Bob should get an error
        assert len(play_calls) == 1
        assert len(error_calls) == 1
        assert error_calls[0][0][1]["message"] == "You do not have permission to control media"

    @pytest.mark.asyncio
    async def test_user_joins_gets_current_media_state(self, handler, rm, mock_sio, populated_room):
        """User joins while media is playing -- gets current state in room_joined."""
        # Set up some media state
        rm.update_media(
            "sid_alice",
            url="https://youtube.com/watch?v=abc",
            media_type="youtube",
            state="playing",
            timestamp=42.5,
            title="Test Video",
        )
        mock_sio.emit.reset_mock()

        # Dave joins the room
        await handler.handle_join_room("sid_dave", {"room_code": populated_room, "user_name": "Dave"})

        joined_calls = _event_calls(mock_sio, "room_joined")
        assert len(joined_calls) == 1

        payload = joined_calls[0][0][1]
        assert payload["media"]["url"] == "https://youtube.com/watch?v=abc"
        assert payload["media"]["state"] == "playing"
        assert payload["media"]["timestamp"] == 42.5

    @pytest.mark.asyncio
    async def test_host_changes_media_after_granting_control(self, handler, rm, mock_sio, populated_room):
        """Host changes media right after granting control -- both operations succeed."""
        mock_sio.emit.reset_mock()

        # Grant control and change media concurrently
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_bob", "enabled": True}
        )

        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is True

        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://youtube.com/watch?v=new", "type": "youtube", "title": "New"},
        )
        assert len(_event_calls(mock_sio, "media_changed")) == 1

        # Bob can still control
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "play", "timestamp": 0}
        )
        assert len(_event_calls(mock_sio, "media_play")) == 1


# ===================================================================
# 6. TestMediaStateConsistency
# ===================================================================


class TestMediaStateConsistency:
    """Tests that media state is correctly updated after various operations."""

    @pytest.mark.asyncio
    async def test_after_play_state_is_playing(self, handler, rm, mock_sio, populated_room):
        """After play: state is 'playing', timestamp updated."""
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 50.0}
        )

        room = rm.get_room(populated_room)
        assert room.media.state == "playing"
        assert room.media.timestamp == 50.0

    @pytest.mark.asyncio
    async def test_after_pause_state_is_paused(self, handler, rm, mock_sio, populated_room):
        """After pause: state is 'paused', timestamp updated."""
        # First play to set a non-zero timestamp
        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 30.0}
        )
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 35.0}
        )

        room = rm.get_room(populated_room)
        assert room.media.state == "paused"
        assert room.media.timestamp == 35.0

    @pytest.mark.asyncio
    async def test_after_seek_timestamp_updated_state_unchanged(self, handler, rm, mock_sio, populated_room):
        """After seek: timestamp updated, state unchanged."""
        # Set initial state to playing
        rm.update_media("sid_alice", state="playing", timestamp=20.0)
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice", {"action": "seek", "timestamp": 60.0}
        )

        room = rm.get_room(populated_room)
        assert room.media.timestamp == 60.0
        # Seek does not change play/pause state
        assert room.media.state == "playing"

    @pytest.mark.asyncio
    async def test_after_media_change_state_reset(self, handler, rm, mock_sio, populated_room):
        """After media change: URL updated, state reset to paused, timestamp reset to 0."""
        # Set some existing state
        rm.update_media("sid_alice", state="playing", timestamp=120.0, url="https://old.com")
        mock_sio.emit.reset_mock()

        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://new.com/video.mp4", "type": "video", "title": "New Vid"},
        )

        room = rm.get_room(populated_room)
        assert room.media.url == "https://new.com/video.mp4"
        assert room.media.state == "paused"
        assert room.media.timestamp == 0
        assert room.media.title == "New Vid"
        assert room.media.type == "video"

    @pytest.mark.asyncio
    async def test_rapid_play_pause_play_final_state(self, handler, rm, mock_sio, populated_room):
        """Rapid play/pause/play: final state is 'playing'."""
        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 10.0}
        )
        await handler.handle_media_control(
            "sid_alice", {"action": "pause", "timestamp": 12.0}
        )
        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 12.0}
        )

        room = rm.get_room(populated_room)
        assert room.media.state == "playing"
        assert room.media.timestamp == 12.0

    @pytest.mark.asyncio
    async def test_media_change_clears_playlist_state(self, handler, rm, mock_sio, populated_room):
        """After a single-media change, playlist fields are cleared."""
        # First load a playlist
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "A"},
            {"url": "https://youtube.com/watch?v=b", "title": "B"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
            playlist_id="PL1",
            playlist_title="PL",
        )

        # Now change to a single video
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://example.com/single.mp4", "type": "video", "title": "Single"},
        )

        room = rm.get_room(populated_room)
        assert room.media.is_playlist is False
        assert room.media.playlist_items == []
        assert room.media.playlist_id == ""
        assert room.media.current_index == 0
