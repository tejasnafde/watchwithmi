import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.handlers.socket_events import SocketEventHandler
from app.services.room_manager import RoomManager


class AnalyticsRecorder:
    def __init__(self):
        self.events = []

    def track(self, event, surface):
        self.events.append((event, surface))


@pytest.mark.asyncio
async def test_room_funnel_events_are_authoritative_and_deduplicated():
    sio = AsyncMock()
    sio.on = MagicMock(side_effect=lambda name: lambda fn: fn)
    analytics = AnalyticsRecorder()
    handler = SocketEventHandler(sio, RoomManager(), analytics)

    await handler.handle_create_room("host", {"user_name": "Host", "room_code": "ROOM1"})
    await handler.handle_join_room("guest", {"user_name": "Guest", "room_code": "ROOM1"})
    await handler.handle_media_control(
        "host",
        {"action": "change", "url": "https://example.com/video", "type": "video"},
    )
    await handler.handle_media_control("host", {"action": "play", "timestamp": 0})
    await handler.handle_media_control("host", {"action": "pause", "timestamp": 1})
    await handler.handle_media_control("host", {"action": "play", "timestamp": 1})

    assert analytics.events == [
        ("room_created", "home"),
        ("room_joined", "room"),
        ("room_activated", "room"),
        ("qualified_playback_reached", "room"),
    ]
