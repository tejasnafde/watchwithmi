"""
Regression tests for WebRTC signaling, chat messaging, video/audio toggle,
grant control, disconnect/reconnect, and error responses.

Run with: pytest tests/test_webrtc_and_chat.py -v
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

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
    """A room with a host (Alice) and two viewers (Bob, Carol)."""
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
    """Return list of (payload, kwargs) for all 'error' emits."""
    return [
        (c[0][1], c[1]) for c in mock_sio.emit.call_args_list if c[0][0] == "error"
    ]


def _calls_for_event(mock_sio, event_name):
    """Return list of call objects for a specific event name."""
    return [c for c in mock_sio.emit.call_args_list if c[0][0] == event_name]


# ===================================================================
# 1. TestWebRTCSignaling
# ===================================================================


class TestWebRTCSignaling:
    @pytest.mark.asyncio
    async def test_offer_forwarded_to_same_room_user(self, handler, rm, mock_sio, populated_room):
        """User A sends offer to User B in same room -> forwarded with from_user_id and from_user_name."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer(
            "sid_alice", {"target_user_id": "sid_bob", "offer": {"type": "offer", "sdp": "v=0..."}}
        )
        offer_calls = _calls_for_event(mock_sio, "webrtc_offer")
        assert len(offer_calls) == 1
        payload = offer_calls[0][0][1]
        assert payload["from_user_id"] == "sid_alice"
        assert payload["from_user_name"] == "Alice"
        assert payload["offer"] == {"type": "offer", "sdp": "v=0..."}
        # Targeted at Bob's sid
        assert offer_calls[0][1]["room"] == "sid_bob"

    @pytest.mark.asyncio
    async def test_offer_not_forwarded_to_user_in_different_room(self, handler, rm, mock_sio, populated_room):
        """User A sends offer to User B NOT in same room -> not forwarded."""
        # Create a separate room with Dave
        code2 = rm.create_room("Dave")
        rm.join_room(code2, "sid_dave", "Dave", is_host=True)

        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer(
            "sid_alice", {"target_user_id": "sid_dave", "offer": {"type": "offer", "sdp": "..."}}
        )
        offer_calls = _calls_for_event(mock_sio, "webrtc_offer")
        assert len(offer_calls) == 0

    @pytest.mark.asyncio
    async def test_offer_missing_target_user_id(self, handler, rm, mock_sio, populated_room):
        """Missing target_user_id -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer(
            "sid_alice", {"offer": {"type": "offer", "sdp": "..."}}
        )
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1
        assert "target_user_id" in errors[0][0]["message"].lower() or "missing" in errors[0][0]["message"].lower()

    @pytest.mark.asyncio
    async def test_offer_missing_offer_data(self, handler, rm, mock_sio, populated_room):
        """Missing offer data -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer(
            "sid_alice", {"target_user_id": "sid_bob"}
        )
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_answer_forwarded_correctly(self, handler, rm, mock_sio, populated_room):
        """User sends answer to User B -> forwarded correctly."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_answer(
            "sid_bob", {"target_user_id": "sid_alice", "answer": {"type": "answer", "sdp": "v=0..."}}
        )
        answer_calls = _calls_for_event(mock_sio, "webrtc_answer")
        assert len(answer_calls) == 1
        payload = answer_calls[0][0][1]
        assert payload["from_user_id"] == "sid_bob"
        assert payload["from_user_name"] == "Bob"
        assert payload["answer"] == {"type": "answer", "sdp": "v=0..."}
        assert answer_calls[0][1]["room"] == "sid_alice"

    @pytest.mark.asyncio
    async def test_ice_candidate_forwarded_correctly(self, handler, rm, mock_sio, populated_room):
        """User sends ICE candidate to User B -> forwarded correctly."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_ice_candidate(
            "sid_carol", {"target_user_id": "sid_alice", "candidate": {"candidate": "a]...", "sdpMid": "0"}}
        )
        ice_calls = _calls_for_event(mock_sio, "webrtc_ice_candidate")
        assert len(ice_calls) == 1
        payload = ice_calls[0][0][1]
        assert payload["from_user_id"] == "sid_carol"
        assert payload["from_user_name"] == "Carol"
        assert ice_calls[0][1]["room"] == "sid_alice"

    @pytest.mark.asyncio
    async def test_offer_from_user_not_in_any_room(self, handler, rm, mock_sio):
        """User not in any room sends offer -> no crash, no forwarding."""
        rm.update_user_session("sid_orphan", {"room_code": None, "user_name": "Orphan"})
        mock_sio.emit.reset_mock()
        # Should not raise
        await handler.handle_webrtc_offer(
            "sid_orphan", {"target_user_id": "sid_bob", "offer": {"type": "offer", "sdp": "..."}}
        )
        offer_calls = _calls_for_event(mock_sio, "webrtc_offer")
        assert len(offer_calls) == 0

    @pytest.mark.asyncio
    async def test_simultaneous_offers_both_forwarded(self, handler, rm, mock_sio, populated_room):
        """Both users send offers simultaneously -> both forwarded (no deadlock)."""
        mock_sio.emit.reset_mock()
        # Fire both concurrently
        await asyncio.gather(
            handler.handle_webrtc_offer(
                "sid_alice", {"target_user_id": "sid_bob", "offer": {"type": "offer", "sdp": "alice-sdp"}}
            ),
            handler.handle_webrtc_offer(
                "sid_bob", {"target_user_id": "sid_alice", "offer": {"type": "offer", "sdp": "bob-sdp"}}
            ),
        )
        offer_calls = _calls_for_event(mock_sio, "webrtc_offer")
        assert len(offer_calls) == 2
        targets = {c[1]["room"] for c in offer_calls}
        assert targets == {"sid_alice", "sid_bob"}


# ===================================================================
# 2. TestVideoAudioToggle
# ===================================================================


class TestVideoAudioToggle:
    @pytest.mark.asyncio
    async def test_toggle_video_on(self, handler, rm, mock_sio, populated_room):
        """User toggles video on -> room state updated, user_video_toggled emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_video("sid_bob", {"enabled": True})
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].video_enabled is True
        video_calls = _calls_for_event(mock_sio, "user_video_toggled")
        assert len(video_calls) == 1
        assert video_calls[0][0][1]["video_enabled"] is True

    @pytest.mark.asyncio
    async def test_toggle_video_off(self, handler, rm, mock_sio, populated_room):
        """User toggles video off -> room state updated, emitted."""
        # First enable it
        room = rm.get_room(populated_room)
        room.users["sid_bob"].video_enabled = True
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_video("sid_bob", {"enabled": False})
        assert room.users["sid_bob"].video_enabled is False
        video_calls = _calls_for_event(mock_sio, "user_video_toggled")
        assert len(video_calls) == 1
        assert video_calls[0][0][1]["video_enabled"] is False

    @pytest.mark.asyncio
    async def test_toggle_audio_on(self, handler, rm, mock_sio, populated_room):
        """User toggles audio on -> room state updated, user_audio_toggled emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_audio("sid_carol", {"enabled": True})
        room = rm.get_room(populated_room)
        assert room.users["sid_carol"].audio_enabled is True
        audio_calls = _calls_for_event(mock_sio, "user_audio_toggled")
        assert len(audio_calls) == 1
        assert audio_calls[0][0][1]["audio_enabled"] is True

    @pytest.mark.asyncio
    async def test_toggle_audio_off(self, handler, rm, mock_sio, populated_room):
        """User toggles audio off -> room state updated, emitted."""
        room = rm.get_room(populated_room)
        room.users["sid_carol"].audio_enabled = True
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_audio("sid_carol", {"enabled": False})
        assert room.users["sid_carol"].audio_enabled is False
        audio_calls = _calls_for_event(mock_sio, "user_audio_toggled")
        assert len(audio_calls) == 1
        assert audio_calls[0][0][1]["audio_enabled"] is False

    @pytest.mark.asyncio
    async def test_toggle_emits_users_updated(self, handler, rm, mock_sio, populated_room):
        """Toggle also emits users_updated to sync all clients."""
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_video("sid_bob", {"enabled": True})
        users_updated = _calls_for_event(mock_sio, "users_updated")
        assert len(users_updated) >= 1

    @pytest.mark.asyncio
    async def test_toggle_video_user_not_in_room(self, handler, rm, mock_sio):
        """User not in room toggles -> error emitted."""
        rm.update_user_session("sid_orphan", {"room_code": None, "user_name": "Orphan"})
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_video("sid_orphan", {"enabled": True})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_toggle_audio_user_not_in_room(self, handler, rm, mock_sio):
        """User not in room toggles audio -> error emitted."""
        rm.update_user_session("sid_orphan", {"room_code": None, "user_name": "Orphan"})
        mock_sio.emit.reset_mock()
        await handler.handle_toggle_audio("sid_orphan", {"enabled": True})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_video_audio_flags_in_room_state(self, handler, rm, mock_sio, populated_room):
        """Verify the user's video_enabled/audio_enabled flags in room state after toggle."""
        await handler.handle_toggle_video("sid_bob", {"enabled": True})
        await handler.handle_toggle_audio("sid_bob", {"enabled": True})
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].video_enabled is True
        assert room.users["sid_bob"].audio_enabled is True

        await handler.handle_toggle_video("sid_bob", {"enabled": False})
        assert room.users["sid_bob"].video_enabled is False
        assert room.users["sid_bob"].audio_enabled is True


# ===================================================================
# 3. TestChatMessaging
# ===================================================================


class TestChatMessaging:
    @pytest.mark.asyncio
    async def test_send_valid_message(self, handler, rm, mock_sio, populated_room):
        """Send valid message -> new_message emitted with correct user_name, message, timestamp."""
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_alice", {"message": "Hello everyone!"})
        msg_calls = _calls_for_event(mock_sio, "new_message")
        assert len(msg_calls) == 1
        payload = msg_calls[0][0][1]
        assert payload["message"] == "Hello everyone!"
        assert payload["user_name"] == "Alice"
        assert "timestamp" in payload

    @pytest.mark.asyncio
    async def test_send_empty_message(self, handler, rm, mock_sio, populated_room):
        """Send empty message -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_alice", {"message": ""})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Message cannot be empty"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_send_whitespace_only_message(self, handler, rm, mock_sio, populated_room):
        """Send whitespace-only message -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_alice", {"message": "   \t\n  "})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Message cannot be empty"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_send_message_not_in_room(self, handler, rm, mock_sio):
        """User not in room sends message -> error emitted."""
        rm.update_user_session("sid_orphan", {"room_code": None, "user_name": "Orphan"})
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_orphan", {"message": "hi"})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Not in a room"}, room="sid_orphan"
        )

    @pytest.mark.asyncio
    async def test_multiple_messages_in_sequence(self, handler, rm, mock_sio, populated_room):
        """Multiple messages in sequence -> all delivered in order."""
        mock_sio.emit.reset_mock()
        messages = ["First", "Second", "Third"]
        for msg in messages:
            await handler.handle_send_message("sid_alice", {"message": msg})
        msg_calls = _calls_for_event(mock_sio, "new_message")
        assert len(msg_calls) == 3
        for i, msg in enumerate(messages):
            assert msg_calls[i][0][1]["message"] == msg

    @pytest.mark.asyncio
    async def test_message_from_disconnected_user(self, handler, rm, mock_sio):
        """Message from disconnected user (no session at all) -> error / graceful handling."""
        # sid_ghost has no session whatsoever
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_ghost", {"message": "boo"})
        # Should emit error, not crash
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_chat_history_stored_in_room(self, handler, rm, mock_sio, populated_room):
        """Verify chat history is stored in room (check room.chat after messages)."""
        await handler.handle_send_message("sid_alice", {"message": "msg1"})
        await handler.handle_send_message("sid_bob", {"message": "msg2"})
        room = rm.get_room(populated_room)
        assert len(room.chat) == 2
        assert room.chat[0].message == "msg1"
        assert room.chat[0].user_name == "Alice"
        assert room.chat[1].message == "msg2"
        assert room.chat[1].user_name == "Bob"


# ===================================================================
# 4. TestGrantControl
# ===================================================================


class TestGrantControl:
    @pytest.mark.asyncio
    async def test_host_grants_control_to_viewer(self, handler, rm, mock_sio, populated_room):
        """Host grants control to viewer -> viewer's can_control becomes True."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_bob", "enabled": True}
        )
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is True

    @pytest.mark.asyncio
    async def test_host_revokes_control_from_viewer(self, handler, rm, mock_sio, populated_room):
        """Host revokes control from viewer -> viewer's can_control becomes False."""
        rm.set_user_control("sid_alice", "sid_bob", True)
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_bob", "enabled": False}
        )
        room = rm.get_room(populated_room)
        assert room.users["sid_bob"].can_control is False

    @pytest.mark.asyncio
    async def test_non_host_tries_to_grant(self, handler, rm, mock_sio, populated_room):
        """Non-host tries to grant -> rejected."""
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
    async def test_host_cannot_revoke_own_control(self, handler, rm, mock_sio, populated_room):
        """Host tries to revoke own control -> rejected (host always has control)."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_alice", "enabled": False}
        )
        room = rm.get_room(populated_room)
        assert room.users["sid_alice"].can_control is True
        mock_sio.emit.assert_any_call(
            "error", {"message": "Action failed or unauthorized"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_grant_to_nonexistent_user(self, handler, rm, mock_sio, populated_room):
        """Grant to non-existent user -> error."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_nobody", "enabled": True}
        )
        mock_sio.emit.assert_any_call(
            "error", {"message": "Action failed or unauthorized"}, room="sid_alice"
        )

    @pytest.mark.asyncio
    async def test_grant_emits_users_updated(self, handler, rm, mock_sio, populated_room):
        """After grant, verify users_updated emitted with updated permissions."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control(
            "sid_alice", {"user_id": "sid_bob", "enabled": True}
        )
        users_updated = _calls_for_event(mock_sio, "users_updated")
        assert len(users_updated) >= 1
        payload = users_updated[0][0][1]
        assert payload["users"]["sid_bob"]["can_control"] is True

    @pytest.mark.asyncio
    async def test_new_host_has_control_after_host_leaves(self, handler, rm, mock_sio, populated_room):
        """After host transfer (host leaves), new host automatically has can_control=True."""
        room = rm.get_room(populated_room)
        # Set deterministic join times
        room.users["sid_bob"].joined_at_ts = 1000.0
        room.users["sid_carol"].joined_at_ts = 2000.0

        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_alice")

        room = rm.get_room(populated_room)
        assert room is not None
        # Bob should be new host (earliest join)
        assert room.host_id == "sid_bob"
        assert room.users["sid_bob"].is_host is True
        assert room.users["sid_bob"].can_control is True


# ===================================================================
# 5. TestDisconnectReconnect
# ===================================================================


class TestDisconnectReconnect:
    @pytest.mark.asyncio
    async def test_user_disconnect_emits_user_left(self, handler, rm, mock_sio, populated_room):
        """User disconnects -> after grace period, user_left emitted."""
        mock_sio.emit.reset_mock()
        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_bob")
        user_left_calls = _calls_for_event(mock_sio, "user_left")
        assert len(user_left_calls) == 1
        assert user_left_calls[0][0][1]["user_id"] == "sid_bob"
        assert user_left_calls[0][0][1]["user_name"] == "Bob"

    @pytest.mark.asyncio
    async def test_reconnect_within_grace_period_no_user_left(self, handler, rm, mock_sio, populated_room):
        """User disconnects and reconnects within grace -> no user_left emitted (session preserved)."""
        # Simulate reconnect by adding a new session for Bob before disconnect fires
        rm.join_room(populated_room, "sid_bob_new", "Bob")
        mock_sio.emit.reset_mock()
        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_bob")
        user_left_calls = _calls_for_event(mock_sio, "user_left")
        assert len(user_left_calls) == 0
        # The new session should still exist
        room = rm.get_room(populated_room)
        assert "sid_bob_new" in room.users

    @pytest.mark.asyncio
    async def test_host_disconnect_transfers_host(self, handler, rm, mock_sio, populated_room):
        """Host disconnects -> host transfers to next user, user_left emitted."""
        room = rm.get_room(populated_room)
        room.users["sid_bob"].joined_at_ts = 1000.0
        room.users["sid_carol"].joined_at_ts = 2000.0

        mock_sio.emit.reset_mock()
        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_alice")

        user_left_calls = _calls_for_event(mock_sio, "user_left")
        assert len(user_left_calls) == 1
        assert user_left_calls[0][0][1]["new_host"] == "sid_bob"

        room = rm.get_room(populated_room)
        assert room.host_id == "sid_bob"

    @pytest.mark.asyncio
    async def test_all_users_disconnect_room_cleaned(self, handler, rm, mock_sio, populated_room):
        """All users disconnect -> room cleaned up."""
        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_alice")
            await handler.handle_disconnect("sid_bob")
            await handler.handle_disconnect("sid_carol")
        assert rm.get_room(populated_room) is None

    @pytest.mark.asyncio
    async def test_reconnect_to_deleted_room(self, handler, rm, mock_sio):
        """User disconnects, room gets deleted, user tries to reconnect -> handles gracefully."""
        code = rm.create_room("Solo")
        rm.join_room(code, "sid_solo", "Solo", is_host=True)

        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_solo")

        # Room should be gone
        assert rm.get_room(code) is None

        # Try to join the deleted room via handler -- should get error, not crash
        mock_sio.emit.reset_mock()
        await handler.handle_join_room("sid_solo_new", {"room_code": code, "user_name": "Solo"})
        mock_sio.emit.assert_any_call(
            "error", {"message": "Room not found"}, room="sid_solo_new"
        )

    @pytest.mark.asyncio
    async def test_users_updated_after_disconnect(self, handler, rm, mock_sio, populated_room):
        """Verify users_updated emitted after disconnect with correct user list."""
        mock_sio.emit.reset_mock()
        with patch("asyncio.sleep", new_callable=AsyncMock):
            await handler.handle_disconnect("sid_bob")

        users_updated = _calls_for_event(mock_sio, "users_updated")
        assert len(users_updated) >= 1
        payload = users_updated[-1][0][1]
        assert "sid_bob" not in payload["users"]
        assert "sid_alice" in payload["users"]
        assert "sid_carol" in payload["users"]


# ===================================================================
# 6. TestErrorResponses — Verify silent-return bugs are fixed
# ===================================================================


class TestErrorResponses:
    @pytest.mark.asyncio
    async def test_send_message_no_message_emits_error(self, handler, rm, mock_sio, populated_room):
        """send_message with no message -> error event emitted (not silent)."""
        mock_sio.emit.reset_mock()
        await handler.handle_send_message("sid_alice", {"message": ""})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1
        assert "empty" in errors[0][0]["message"].lower()

    @pytest.mark.asyncio
    async def test_webrtc_offer_no_target_emits_error(self, handler, rm, mock_sio, populated_room):
        """webrtc_offer with no target -> error event emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer("sid_alice", {"offer": {"sdp": "..."}})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_webrtc_answer_no_answer_emits_error(self, handler, rm, mock_sio, populated_room):
        """webrtc_answer with no answer -> error event emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_answer("sid_alice", {"target_user_id": "sid_bob"})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_webrtc_ice_no_candidate_emits_error(self, handler, rm, mock_sio, populated_room):
        """webrtc_ice_candidate with no candidate -> error event emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_ice_candidate("sid_alice", {"target_user_id": "sid_bob"})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_grant_control_no_target_emits_error(self, handler, rm, mock_sio, populated_room):
        """grant_control with no target -> error event emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_grant_control("sid_alice", {"enabled": True})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1
        assert "target" in errors[0][0]["message"].lower() or "missing" in errors[0][0]["message"].lower()

    @pytest.mark.asyncio
    async def test_media_control_no_action_silent_return(self, handler, rm, mock_sio, populated_room):
        """media_control with no action -> currently returns silently (no emit).
        This test documents the current behavior. If fixed, update to check for error emit."""
        mock_sio.emit.reset_mock()
        await handler.handle_media_control("sid_alice", {})
        # The handler currently returns silently when action is missing.
        # Verify no crash and no media events were emitted.
        media_events = [
            c for c in mock_sio.emit.call_args_list
            if c[0][0] in ("media_play", "media_pause", "media_seek", "media_changed")
        ]
        assert len(media_events) == 0

    @pytest.mark.asyncio
    async def test_media_control_unauthorized_user_emits_error(self, handler, rm, mock_sio, populated_room):
        """media_control from unauthorized user -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_media_control("sid_bob", {"action": "play", "timestamp": 10.0})
        mock_sio.emit.assert_any_call(
            "error",
            {"message": "You do not have permission to control media"},
            room="sid_bob",
        )

    @pytest.mark.asyncio
    async def test_webrtc_offer_no_data_at_all(self, handler, rm, mock_sio, populated_room):
        """webrtc_offer with empty data -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_offer("sid_alice", {})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_webrtc_answer_no_data_at_all(self, handler, rm, mock_sio, populated_room):
        """webrtc_answer with empty data -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_answer("sid_alice", {})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1

    @pytest.mark.asyncio
    async def test_webrtc_ice_no_data_at_all(self, handler, rm, mock_sio, populated_room):
        """webrtc_ice_candidate with empty data -> error emitted."""
        mock_sio.emit.reset_mock()
        await handler.handle_webrtc_ice_candidate("sid_alice", {})
        errors = _error_calls(mock_sio)
        assert len(errors) >= 1
