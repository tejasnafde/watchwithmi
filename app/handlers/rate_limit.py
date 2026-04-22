"""
Sliding-window rate limiter for Socket.IO events.

Used by SocketEventHandler to throttle per-sid event floods (bug #5.7 in
docs/polishing/05-security.md). Pure Python, no background tasks — each
`allow()` call lazily prunes expired entries for the key being checked.

Thread-safety: not thread-safe. Socket.IO's async event loop runs one
coroutine at a time on a single thread in the default ``asyncio`` mode,
so sharing a single limiter instance across handlers is safe there.
"""

import time
from collections import deque
from typing import Callable, Deque, Dict, Optional


# Default knobs. Overridable via env vars when instantiating in main.py.
DEFAULT_MAX_EVENTS_PER_WINDOW = 20
DEFAULT_WINDOW_SECONDS = 1.0


class SlidingWindowLimiter:
    """A fixed-capacity sliding-window counter keyed by opaque strings.

    Concretely: at most ``max_events`` calls to ``allow(key)`` return True
    in any ``window_seconds`` interval. Older events age out of the
    window automatically on the next ``allow(key)`` call.
    """

    def __init__(
        self,
        max_events: int = DEFAULT_MAX_EVENTS_PER_WINDOW,
        window_seconds: float = DEFAULT_WINDOW_SECONDS,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        if max_events < 1:
            raise ValueError("max_events must be >= 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")

        self._max = max_events
        self._window = window_seconds
        # Injected clock makes the behavior deterministic in tests.
        self._now = now or time.monotonic
        self._events: Dict[str, Deque[float]] = {}

    def allow(self, key: str) -> bool:
        """Return True if an event at `now` stays under the cap for ``key``.

        If True, the event's timestamp is recorded. If False, no state
        is mutated for the caller.
        """
        now = self._now()
        cutoff = now - self._window

        q = self._events.get(key)
        if q is None:
            q = deque()
            self._events[key] = q

        while q and q[0] <= cutoff:
            q.popleft()

        if len(q) >= self._max:
            return False

        q.append(now)
        return True

    def forget(self, key: str) -> None:
        """Drop all state for ``key`` (e.g. on socket disconnect)."""
        self._events.pop(key, None)
