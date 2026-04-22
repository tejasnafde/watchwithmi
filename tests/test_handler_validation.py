"""
Regression tests for bugs #4, #5, #6, #7 in docs/polishing/01-critical-bugs.md:

  #4 — Queue title must be rejected when empty / whitespace-only.
  #5 — Queue reorder must reject out-of-bounds new_index values at the
       handler layer instead of silently clamping in the model.
  #6 — User name must be capped server-side so a multi-megabyte value
       can't be broadcast to every peer.
  #7 — Video reaction must emit a structured error on validation failure
       rather than silently returning (parity with other handlers).

All four are server-side validation holes. They're exercised here against
``SocketEventHandler`` with a mocked Socket.IO server so we can assert on
the error payload clients would actually receive.

Run with: pytest tests/test_handler_validation.py -v
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.handlers.socket_events import SocketEventHandler  # noqa: E402
from app.services.room_manager import RoomManager  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
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
    return sio


@pytest.fixture
def handler(mock_sio, rm):
    return SocketEventHandler(mock_sio, rm)


@pytest.fixture
def populated_room(rm):
    """A room with Alice as host and Bob as a plain user."""
    code = rm.create_room("Alice")
    rm.join_room(code, "sid_alice", "Alice", is_host=True)
    rm.join_room(code, "sid_bob", "Bob")
    return code


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _error_payloads(mock_sio):
    """Return list of payload dicts emitted as 'error' events."""
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
# Bug #4 — Queue title validation
# ---------------------------------------------------------------------------


class TestQueueAddTitleValidation:
    @pytest.mark.asyncio
    async def test_rejects_empty_title(self, handler, mock_sio, populated_room, rm):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {"url": "https://example.com/video", "title": "", "media_type": "youtube"},
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit when title is empty"
        assert any("title" in (e.get("message", "").lower()) for e in errors), (
            f"error should mention 'title'; got {errors}"
        )

        room = rm.get_room(populated_room)
        assert room.queue == [], "empty-title item must not land in the queue"

    @pytest.mark.asyncio
    async def test_rejects_whitespace_only_title(
        self, handler, mock_sio, populated_room, rm
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {
                "url": "https://example.com/video",
                "title": "   \t  ",
                "media_type": "youtube",
            },
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit for whitespace-only title"
        room = rm.get_room(populated_room)
        assert room.queue == []

    @pytest.mark.asyncio
    async def test_accepts_valid_title(self, handler, mock_sio, populated_room, rm):
        """Regression guard: a normal title still succeeds."""
        mock_sio.emit.reset_mock()
        await handler.handle_queue_add(
            "sid_bob",
            {
                "url": "https://example.com/video",
                "title": "My favorite song",
                "media_type": "youtube",
            },
        )

        errors = _error_payloads(mock_sio)
        assert errors == [], f"unexpected errors: {errors}"
        room = rm.get_room(populated_room)
        assert len(room.queue) == 1
        assert room.queue[0].title == "My favorite song"


# ---------------------------------------------------------------------------
# Bug #5 — Queue reorder bounds
# ---------------------------------------------------------------------------


class TestQueueReorderBounds:
    @pytest.fixture
    def room_with_queue(self, handler, mock_sio, populated_room, rm):
        """Seed the populated room with three queue items."""
        import asyncio

        async def _seed():
            for i in range(3):
                await handler.handle_queue_add(
                    "sid_alice",
                    {
                        "url": f"https://example.com/{i}",
                        "title": f"item {i}",
                        "media_type": "youtube",
                    },
                )

        asyncio.get_event_loop().run_until_complete(_seed())
        mock_sio.emit.reset_mock()
        return populated_room

    @pytest.mark.asyncio
    async def test_rejects_negative_new_index(
        self, handler, mock_sio, room_with_queue, rm
    ):
        room = rm.get_room(room_with_queue)
        item_id = room.queue[0].id
        original_order = [item.id for item in room.queue]

        await handler.handle_queue_reorder(
            "sid_alice", {"item_id": item_id, "new_index": -1}
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit for negative new_index"
        # Queue order must be unchanged.
        assert [item.id for item in rm.get_room(room_with_queue).queue] == original_order

    @pytest.mark.asyncio
    async def test_rejects_out_of_range_new_index(
        self, handler, mock_sio, room_with_queue, rm
    ):
        room = rm.get_room(room_with_queue)
        item_id = room.queue[0].id
        original_order = [item.id for item in room.queue]

        # queue has 3 items → valid indexes 0..2; 99 is out of range.
        await handler.handle_queue_reorder(
            "sid_alice", {"item_id": item_id, "new_index": 99}
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit for out-of-range new_index"
        assert [item.id for item in rm.get_room(room_with_queue).queue] == original_order

    @pytest.mark.asyncio
    async def test_accepts_valid_new_index(
        self, handler, mock_sio, room_with_queue, rm
    ):
        """Regression guard: a valid reorder still succeeds."""
        room = rm.get_room(room_with_queue)
        first_id = room.queue[0].id

        await handler.handle_queue_reorder(
            "sid_alice", {"item_id": first_id, "new_index": 2}
        )

        errors = _error_payloads(mock_sio)
        assert errors == [], f"unexpected errors: {errors}"
        new_order = [item.id for item in rm.get_room(room_with_queue).queue]
        assert new_order[2] == first_id, (
            f"expected first item to move to index 2, got order {new_order}"
        )


# ---------------------------------------------------------------------------
# Bug #6 — User name length cap
# ---------------------------------------------------------------------------


class TestUserNameLengthCap:
    LONG_NAME = "x" * 1000
    MAX_NAME = "a" * 50
    OVER_MAX_NAME = "a" * 51

    @pytest.mark.asyncio
    async def test_create_room_rejects_name_over_50(self, handler, mock_sio, rm):
        mock_sio.emit.reset_mock()
        await handler.handle_create_room(
            "sid_x", {"user_name": self.OVER_MAX_NAME, "room_code": "TESTRM"}
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit for over-long name"
        # Room should not have been created.
        assert rm.get_room("TESTRM") is None

    @pytest.mark.asyncio
    async def test_join_room_rejects_name_over_50(self, handler, mock_sio, rm):
        # Pre-existing room.
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)

        mock_sio.emit.reset_mock()
        await handler.handle_join_room(
            "sid_x", {"room_code": code, "user_name": self.LONG_NAME}
        )

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit for over-long name on join"
        room = rm.get_room(code)
        assert "sid_x" not in room.users

    @pytest.mark.asyncio
    async def test_create_room_accepts_exactly_50_chars(self, handler, mock_sio, rm):
        await handler.handle_create_room(
            "sid_x", {"user_name": self.MAX_NAME, "room_code": "OKROOM"}
        )

        errors = _error_payloads(mock_sio)
        assert errors == [], f"unexpected errors for 50-char name: {errors}"
        assert rm.get_room("OKROOM") is not None


# ---------------------------------------------------------------------------
# Bug #7 — Video reaction must emit errors on validation failure
# ---------------------------------------------------------------------------


class TestVideoReactionErrorEmits:
    @pytest.mark.asyncio
    async def test_empty_emoji_emits_error(self, handler, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_video_reaction("sid_bob", {"emoji": ""})

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit when emoji is empty"

    @pytest.mark.asyncio
    async def test_too_long_emoji_emits_error(self, handler, mock_sio, populated_room):
        mock_sio.emit.reset_mock()
        await handler.handle_video_reaction("sid_bob", {"emoji": "abcdef"})

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit when emoji exceeds length cap"

    @pytest.mark.asyncio
    async def test_non_string_emoji_emits_error(
        self, handler, mock_sio, populated_room
    ):
        mock_sio.emit.reset_mock()
        await handler.handle_video_reaction("sid_bob", {"emoji": 42})

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit when emoji is not a string"

    @pytest.mark.asyncio
    async def test_no_session_emits_error(self, handler, mock_sio, rm):
        """A user not in any room shouldn't silently no-op."""
        mock_sio.emit.reset_mock()
        await handler.handle_video_reaction("sid_ghost", {"emoji": "🎉"})

        errors = _error_payloads(mock_sio)
        assert errors, "expected an 'error' emit when user has no session"

    @pytest.mark.asyncio
    async def test_valid_emoji_broadcasts(self, handler, mock_sio, populated_room):
        """Regression guard: the happy path still broadcasts to the room."""
        mock_sio.emit.reset_mock()
        await handler.handle_video_reaction("sid_bob", {"emoji": "🎉"})

        errors = _error_payloads(mock_sio)
        assert errors == [], f"unexpected errors on happy path: {errors}"
        reactions = _event_payloads(mock_sio, "video_reaction")
        assert len(reactions) == 1
        assert reactions[0]["emoji"] == "🎉"
