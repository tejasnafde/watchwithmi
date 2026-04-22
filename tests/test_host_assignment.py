"""
Tests for Bug #3 (docs/polishing/01-critical-bugs.md):
  "Host race condition on simultaneous join" — socket_events.py:183-199.

The handler computes `is_host` from `room.host_id is None` and
`room.user_count == 0` BEFORE calling `join_room`. When two clients join
an empty room in the same event-loop tick, both observations read the same
pre-commit state and both pass `is_host=True`. The current Room.add_user
trusts that flag and ends up marking both users as host, with `host_id`
pointing at whichever wrote last.

The invariant we want to pin: after any sequence of join_room calls,
  * at most one user in the room has `is_host=True`, and
  * `room.host_id` is either None (empty room) or points at the user who
    is currently marked host.

Even when callers pass stale `is_host=True`, the model must be the single
source of truth and refuse to promote a second host.

Run with: pytest tests/test_host_assignment.py -v
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.room_manager import RoomManager  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def rm():
    return RoomManager()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hosts(room):
    """Return the list of users currently marked as host."""
    return [uid for uid, user in room.users.items() if user.is_host]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestHostRaceOnJoin:
    def test_two_users_claiming_host_on_empty_room_produces_one_host(self, rm):
        """The canonical bug: both handlers saw an empty room."""
        code = rm.create_room("Alice")

        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob", is_host=True)

        room = rm.get_room(code)
        hosts = _hosts(room)

        assert len(hosts) == 1, f"expected exactly one host, got {hosts}"
        assert room.host_id == hosts[0], (
            "room.host_id must match the user marked is_host=True"
        )

    def test_first_claimer_wins_the_host_role(self, rm):
        """The user who lands in add_user first should be the host."""
        code = rm.create_room("Alice")

        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob", is_host=True)

        room = rm.get_room(code)

        assert room.host_id == "sid_alice"
        assert room.users["sid_alice"].is_host is True
        assert room.users["sid_alice"].can_control is True
        assert room.users["sid_bob"].is_host is False

    def test_late_joiner_cannot_steal_host_even_with_is_host_flag(self, rm):
        """
        A client arriving after a host exists must not take over just because
        its handler passed is_host=True (which can happen if the handler's
        snapshot of host_id was stale).
        """
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)

        # Simulate a stale handler that still thinks host_id is None.
        rm.join_room(code, "sid_carol", "Carol", is_host=True)

        room = rm.get_room(code)
        hosts = _hosts(room)
        assert hosts == ["sid_alice"]
        assert room.host_id == "sid_alice"

    def test_normal_second_join_does_not_become_host(self, rm):
        """Regression guard: baseline non-host join still works."""
        code = rm.create_room("Alice")
        rm.join_room(code, "sid_alice", "Alice", is_host=True)
        rm.join_room(code, "sid_bob", "Bob", is_host=False)

        room = rm.get_room(code)
        assert _hosts(room) == ["sid_alice"]
        assert room.users["sid_bob"].is_host is False
