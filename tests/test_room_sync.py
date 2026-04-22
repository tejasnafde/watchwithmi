"""
Comprehensive tests for room sync logic, reconnection flow, and room management.

Run with: pytest tests/test_room_sync.py -v
"""

import time
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.room_manager import RoomManager
from app.models.room import Room, User, MediaState, generate_room_code
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


# ===================================================================
# 1. Room Management Tests
# ===================================================================


class TestRoomCreation:
    def test_create_room_exists(self, rm):
        code = rm.create_room("Alice")
        room = rm.get_room(code)
        assert room is not None
        assert room.room_code == code

    def test_create_room_join_host(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        room = rm.get_room(code)
        assert room.host_id == "sid_alice"
        assert room.users["sid_alice"].is_host is True
        assert room.users["sid_alice"].can_control is True

    def test_custom_room_code(self, rm):
        code = rm.create_room("Alice", requested_code="MYROOM")
        assert code == "MYROOM"
        assert rm.get_room("MYROOM") is not None

    def test_custom_room_code_already_taken(self, rm):
        rm.create_room("Alice", requested_code="TAKEN")
        code2 = rm.create_room("Bob", requested_code="TAKEN")
        # Should get a different auto-generated code
        assert code2 != "TAKEN"
        assert rm.get_room(code2) is not None

    def test_room_code_case_insensitive(self, rm):
        code = rm.create_room("Alice", requested_code="AbCdEf")
        assert code == "ABCDEF"
        # Look up with lowercase
        room = rm.get_room("abcdef")
        assert room is not None
        assert room.room_code == "ABCDEF"


class TestJoinLeave:
    def test_join_room_user_added(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        room = rm.get_room(code)
        assert "sid_alice" in room.users
        assert room.user_count == 1

    def test_join_room_multiple_users(self, rm, populated_room):
        room = rm.get_room(populated_room)
        assert room.user_count == 3

    def test_leave_room_user_removed(self, rm, populated_room):
        rm.leave_room(populated_room, "sid_bob")
        room = rm.get_room(populated_room)
        assert "sid_bob" not in room.users
        assert room.user_count == 2

    def test_host_leaves_transfers_to_earliest(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        # Give Bob an earlier joined_at_ts than Carol
        rm.join_room(code, "sid_bob", "Bob")
        room = rm.get_room(code)
        room.users["sid_bob"].joined_at_ts = 1000.0
        rm.join_room(code, "sid_carol", "Carol")
        room.users["sid_carol"].joined_at_ts = 2000.0

        new_host = rm.leave_room(code, "sid_alice")
        assert new_host == "sid_bob"
        room = rm.get_room(code)
        assert room.host_id == "sid_bob"
        assert room.users["sid_bob"].is_host is True
        assert room.users["sid_bob"].can_control is True

    def test_all_users_leave_room_cleaned(self, rm, populated_room):
        rm.leave_room(populated_room, "sid_alice")
        rm.leave_room(populated_room, "sid_bob")
        rm.leave_room(populated_room, "sid_carol")
        assert rm.get_room(populated_room) is None

    def test_max_users_limit(self, rm):
        code = rm.create_room("Host")
        rm.join_room(code, "sid_host", "Host", is_host=True)
        for i in range(49):
            assert rm.join_room(code, f"sid_{i}", f"User{i}") is True
        # 51st user should be rejected (1 host + 49 = 50 = MAX)
        assert rm.join_room(code, "sid_overflow", "Overflow") is False

    def test_leave_nonexistent_user(self, rm, populated_room):
        result = rm.leave_room(populated_room, "sid_nobody")
        assert result is None

    def test_join_nonexistent_room(self, rm):
        assert rm.join_room("NOPE", "sid_x", "X") is False


class TestRoomCodeGeneration:
    def test_generate_room_code_length(self):
        code = generate_room_code(6)
        assert len(code) == 6

    def test_generate_room_code_uppercase(self):
        for _ in range(20):
            code = generate_room_code()
            assert code == code.upper()


# ===================================================================
# 2. Media State Tests
# ===================================================================


class TestMediaState:
    def test_update_media_state(self, rm, populated_room):
        rm.update_media("sid_alice", state="playing", timestamp=42.5)
        room = rm.get_room(populated_room)
        assert room.media.state == "playing"
        assert room.media.timestamp == 42.5

    def test_host_can_control(self, rm, populated_room):
        result = rm.update_media("sid_alice", url="https://example.com/vid.mp4")
        assert result == populated_room

    def test_non_host_without_control_cannot(self, rm, populated_room):
        result = rm.update_media("sid_bob", url="https://example.com/vid.mp4")
        assert result is None

    def test_non_host_with_control_can(self, rm, populated_room):
        room = rm.get_room(populated_room)
        room.grant_control("sid_bob", True)
        result = rm.update_media("sid_bob", url="https://example.com/vid.mp4")
        assert result == populated_room

    def test_grant_control(self, rm, populated_room):
        success = rm.set_user_control("sid_alice", "sid_bob", True)
        assert success is True
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is True

    def test_revoke_control(self, rm, populated_room):
        rm.set_user_control("sid_alice", "sid_bob", True)
        success = rm.set_user_control("sid_alice", "sid_bob", False)
        assert success is True
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is False

    def test_cannot_revoke_host_control(self, rm, populated_room):
        success = rm.set_user_control("sid_alice", "sid_alice", False)
        assert success is False
        room = rm.get_room(populated_room)
        assert room.users["sid_alice"].can_control is True

    def test_non_host_cannot_grant(self, rm, populated_room):
        success = rm.set_user_control("sid_bob", "sid_carol", True)
        assert success is False

    def test_change_media_url(self, rm, populated_room):
        rm.update_media(
            "sid_alice",
            url="https://youtube.com/watch?v=abc",
            media_type="youtube",
            state="paused",
            timestamp=0,
            title="Test Video",
        )
        room = rm.get_room(populated_room)
        assert room.media.url == "https://youtube.com/watch?v=abc"
        assert room.media.title == "Test Video"
        assert room.media.type == "youtube"


class TestPlaylist:
    def test_load_playlist(self, rm, populated_room):
        items = [
            {"url": "https://youtube.com/watch?v=1", "title": "Song 1"},
            {"url": "https://youtube.com/watch?v=2", "title": "Song 2"},
            {"url": "https://youtube.com/watch?v=3", "title": "Song 3"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            media_type="youtube",
            state="paused",
            timestamp=0,
            title=items[0]["title"],
            is_playlist=True,
            playlist_id="PL123",
            playlist_title="My Playlist",
            playlist_items=items,
            current_index=0,
        )
        room = rm.get_room(populated_room)
        assert room.media.is_playlist is True
        assert room.media.playlist_id == "PL123"
        assert len(room.media.playlist_items) == 3
        assert room.media.current_index == 0

    def test_playlist_next(self, rm, populated_room):
        items = [
            {"url": "https://youtube.com/watch?v=1", "title": "Song 1"},
            {"url": "https://youtube.com/watch?v=2", "title": "Song 2"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
        )
        # Advance to next
        rm.update_media("sid_alice", url=items[1]["url"], current_index=1)
        room = rm.get_room(populated_room)
        assert room.media.current_index == 1
        assert room.media.url == items[1]["url"]

    def test_playlist_select_index(self, rm, populated_room):
        items = [
            {"url": "https://youtube.com/watch?v=1", "title": "S1"},
            {"url": "https://youtube.com/watch?v=2", "title": "S2"},
            {"url": "https://youtube.com/watch?v=3", "title": "S3"},
        ]
        rm.update_media(
            "sid_alice",
            url=items[0]["url"],
            is_playlist=True,
            playlist_items=items,
            current_index=0,
        )
        rm.update_media("sid_alice", url=items[2]["url"], current_index=2)
        room = rm.get_room(populated_room)
        assert room.media.current_index == 2


# ===================================================================
# 3. Reconnection Tests
# ===================================================================


class TestReconnection:
    @pytest.mark.asyncio
    async def test_reconnect_within_grace_period(self, handler, rm, mock_sio):
        """User disconnects and reconnects within grace period -- session maintained.

        The handler does ``import asyncio; await asyncio.sleep(30)`` inside
        the function body, so we patch the stdlib ``asyncio.sleep`` directly.
        """
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        # Add a second user so that when the old session is cleaned the room
        # is not deleted (it still has Bob).
        rm.join_room(code, "sid_bob", "Bob")

        # Also register a new session for Alice (simulating reconnect)
        rm.join_room(code, "sid_alice_new", "Alice")

        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_alice")

        room = rm.get_room(code)
        assert room is not None
        # The reconnected session should still be present
        assert "sid_alice_new" in room.users

    @pytest.mark.asyncio
    async def test_disconnect_after_grace_period(self, handler, rm, mock_sio):
        """User disconnects longer than grace period -- session cleaned up."""
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)

        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_alice")

        # Room should be cleaned up since Alice was the only user
        assert rm.get_room(code) is None

    @pytest.mark.asyncio
    async def test_multiple_users_same_name_different_rooms(self, rm):
        """Two users with the same name in different rooms don't interfere."""
        code1 = rm.create_room("Alice")
        rm.join_room(code1, "sid_alice1", "Alice", is_host=True)

        code2 = rm.create_room("Alice")
        rm.join_room(code2, "sid_alice2", "Alice", is_host=True)

        room1 = rm.get_room(code1)
        room2 = rm.get_room(code2)
        assert room1 is not None
        assert room2 is not None
        assert "sid_alice1" in room1.users
        assert "sid_alice2" in room2.users

    @pytest.mark.asyncio
    async def test_duplicate_name_replaces_old_session_in_room(self, rm):
        """When a user reconnects with the same name, the old session is evicted."""
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice1", "Alice", is_host=True)
        # Add another user to prevent the room from being deleted when
        # the duplicate cleanup removes sid_alice1 (briefly making it empty).
        rm.join_room(code, "sid_bob", "Bob")

        rm.join_room(code, "sid_alice2", "Alice")
        room = rm.get_room(code)
        assert room is not None
        assert "sid_alice2" in room.users
        assert "sid_alice1" not in room.users


# ===================================================================
# 4. Input Validation Tests (via socket handler)
# ===================================================================


class TestInputValidation:
    @pytest.mark.asyncio
    async def test_empty_message_rejected(self, handler, rm, mock_sio, populated_room):
        await handler.handle_send_message("sid_alice", {"message": ""})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Message cannot be empty"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_whitespace_message_rejected(self, handler, rm, mock_sio, populated_room):
        await handler.handle_send_message("sid_alice", {"message": "   "})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Message cannot be empty"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_invalid_media_url_rejected(self, handler, rm, mock_sio, populated_room):
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "ftp://bad.url/file.avi", "type": "video"},
        )
        mock_sio.emit.assert_any_call(
            "error", {"message": "Invalid media URL"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_valid_media_url_http(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {
                "action": "change",
                "url": "https://youtube.com/watch?v=abc",
                "type": "youtube",
                "title": "Test",
            },
        )
        # Should have emitted media_changed, not error
        error_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "error"
        ]
        assert len(error_calls) == 0

    @pytest.mark.asyncio
    async def test_valid_media_url_magnet(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {
                "action": "change",
                "url": "magnet:?xt=urn:btih:abc123",
                "type": "video",
                "title": "Torrent",
            },
        )
        error_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "error"
        ]
        assert len(error_calls) == 0

    @pytest.mark.asyncio
    async def test_invalid_media_type_rejected(self, handler, rm, mock_sio, populated_room):
        await handler.handle_media_control(
            "sid_alice",
            {"action": "change", "url": "https://example.com/vid.mp4", "type": "podcast"},
        )
        mock_sio.emit.assert_any_call(
            "error",
            {
                "message": "Invalid media type. Must be one of: youtube, video, audio, media"
            },
            room="sid_alice",
        )

    @pytest.mark.asyncio
    async def test_create_room_empty_name_rejected(self, handler, rm, mock_sio):
        await handler.handle_create_room("sid_x", {"user_name": "", "room_code": ""})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Name is required"}, room="sid_x"
        )

    @pytest.mark.asyncio
    async def test_join_room_missing_fields(self, handler, rm, mock_sio):
        await handler.handle_join_room("sid_x", {"room_code": "", "user_name": ""})
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "Room code and name are required"},
            room="sid_x",
        )

    @pytest.mark.asyncio
    async def test_join_nonexistent_room_error(self, handler, rm, mock_sio):
        await handler.handle_join_room(
            "sid_x", {"room_code": "NOPE99", "user_name": "Bob"}
        )
        mock_sio.emit.assert_any_call(
            "error", {"message": "Room not found"}, room="sid_x"
        )


# ===================================================================
# 5. User State Tests
# ===================================================================


class TestUserState:
    def test_joined_at_ts_set(self, rm):
        code = rm.create_room("Alice")
        before = time.time()
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        after = time.time()
        room = rm.get_room(code)
        ts = room.users["sid_alice"].joined_at_ts
        assert before <= ts <= after

    @pytest.mark.asyncio
    async def test_video_toggle(self, handler, rm, mock_sio, populated_room):
        await handler.handle_toggle_video("sid_bob", {"enabled": True})
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].video_enabled is True

        await handler.handle_toggle_video("sid_bob", {"enabled": False})
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].video_enabled is False

    @pytest.mark.asyncio
    async def test_audio_toggle(self, handler, rm, mock_sio, populated_room):
        await handler.handle_toggle_audio("sid_carol", {"enabled": True})
        room = rm.get_room(populated_room)
        assert room.users["sid_carol"].audio_enabled is True

        await handler.handle_toggle_audio("sid_carol", {"enabled": False})
        room = rm.get_room(populated_room)
        assert room.users["sid_carol"].audio_enabled is False

    def test_grant_control_updates_flag(self, rm, populated_room):
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is False
        rm.set_user_control("sid_alice", "sid_bob", True)
        assert room.users["sid_bob"].can_control is True

    def test_user_default_state(self, rm):
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob")
        room = rm.get_room(code)
        bob = room.users["sid_bob"]
        assert bob.video_enabled is False
        assert bob.audio_enabled is False
        assert bob.can_control is False
        assert bob.is_host is False


# ===================================================================
# 6. Media Control Permission Tests (via handler)
# ===================================================================


class TestMediaControlPermissions:
    @pytest.mark.asyncio
    async def test_host_can_play(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice", {"action": "play", "timestamp": 10.0}
        )
        media_play_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "media_play"
        ]
        assert len(media_play_calls) == 1

    @pytest.mark.asyncio
    async def test_non_host_no_control_rejected(self, handler, rm, mock_sio, populated_room):
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
    async def test_granted_user_can_control(self, handler, rm, mock_sio, populated_room):
        rm.set_user_control("sid_alice", "sid_bob", True)
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "pause", "timestamp": 20.0}
        )
        pause_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "media_pause"
        ]
        assert len(pause_calls) == 1

    @pytest.mark.asyncio
    async def test_revoked_user_cannot_control(self, handler, rm, mock_sio, populated_room):
        rm.set_user_control("sid_alice", "sid_bob", True)
        rm.set_user_control("sid_alice", "sid_bob", False)
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_bob", {"action": "seek", "timestamp": 30.0}
        )
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "You do not have permission to control media"},
            room="sid_bob",
        )


# ===================================================================
# 7. Grant Control Handler Tests
# ===================================================================


class TestGrantControlHandler:
    @pytest.mark.asyncio
    async def test_host_grants_control_via_handler(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_bob", "enabled": True}
        )
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is True
        # Should emit users_updated
        users_updated_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "users_updated"
        ]
        assert len(users_updated_calls) >= 1

    @pytest.mark.asyncio
    async def test_non_host_grant_rejected_via_handler(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_bob", {"user_id": "sid_carol", "enabled": True}
        )
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "Action failed or unauthorized"},
            room="sid_bob",
        )


# ===================================================================
# 8. Chat / Send Message Tests
# ===================================================================


class TestSendMessage:
    @pytest.mark.asyncio
    async def test_send_message_broadcasts(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_alice", {"message": "Hello everyone!"})
        new_msg_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "new_message"
        ]
        assert len(new_msg_calls) == 1
        payload = new_msg_calls[0][0][1]
        assert payload["message"] == "Hello everyone!"
        assert payload["user_name"] == "Alice"

    @pytest.mark.asyncio
    async def test_send_message_not_in_room(self, handler, rm, mock_sio):
        rm.update_user_session("sid_orphan", {"room_code": None, "user_name": "Orphan"})
        await handler.handle_send_message("sid_orphan", {"message": "hi"})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Not in a room"}, room="sid_orphan"
        )


# ===================================================================
# 9. Room Stats & Cleanup
# ===================================================================


class TestRoomStats:
    def test_get_room_stats(self, rm, populated_room):
        stats = rm.get_room_stats()
        assert stats["total_rooms"] == 1
        assert stats["total_users"] == 3

    def test_cleanup_empty_rooms(self, rm):
        code = rm.create_room("Alice")
        # Room exists but has no users (just created, nobody joined)
        room = rm.get_room(code)
        assert room is not None
        cleaned = rm.cleanup_empty_rooms()
        assert cleaned == 1
        assert rm.get_room(code) is None

    def test_is_user_host(self, rm, populated_room):
        assert rm.is_user_host("sid_alice") is True
        assert rm.is_user_host("sid_bob") is False
        assert rm.is_user_host("sid_nobody") is False


# ===================================================================
# 10. Playlist Handler Tests
# ===================================================================


class TestPlaylistHandler:
    @pytest.mark.asyncio
    async def test_load_playlist_via_handler(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        items = [
            {"url": "https://youtube.com/watch?v=a", "title": "Track A"},
            {"url": "https://youtube.com/watch?v=b", "title": "Track B"},
        ]
        await handler.handle_media_control(
            "sid_alice",
            {
                "action": "load_playlist",
                "items": items,
                "playlist_id": "PL1",
                "playlist_title": "My PL",
            },
        )
        media_changed_calls = [
            c for c in mock_sio.emit.call_args_list if c[0][0] == "media_changed"
        ]
        assert len(media_changed_calls) == 1
        payload = media_changed_calls[0][0][1]
        assert payload["is_playlist"] is True
        assert payload["current_index"] == 0

    @pytest.mark.asyncio
    async def test_playlist_next_via_handler(self, handler, rm, mock_sio, populated_room):
        # Set up playlist state
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
        await handler.handle_media_control("sid_alice", {"action": "playlist_next"})
        room = rm.get_room(populated_room)
        assert room.media.current_index == 1

    @pytest.mark.asyncio
    async def test_playlist_prev_via_handler(self, handler, rm, mock_sio, populated_room):
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
        await handler.handle_media_control("sid_alice", {"action": "playlist_prev"})
        room = rm.get_room(populated_room)
        assert room.media.current_index == 0

    @pytest.mark.asyncio
    async def test_playlist_select_via_handler(self, handler, rm, mock_sio, populated_room):
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

    @pytest.mark.asyncio
    async def test_no_active_playlist_error(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control("sid_alice", {"action": "playlist_next"})
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "No active playlist in this room"},
            room="sid_alice",
        )

    @pytest.mark.asyncio
    async def test_load_empty_playlist_rejected(self, handler, rm, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_media_control(
            "sid_alice",
            {"action": "load_playlist", "items": [], "playlist_id": "PL1"},
        )
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "Playlist has no playable items"},
            room="sid_alice",
        )
