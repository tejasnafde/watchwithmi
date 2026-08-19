import asyncio
import json
import logging
import urllib.request

from ..config import ENV


logger = logging.getLogger("watchwithmi.services.product_analytics")
EVENT_SURFACES = {
    "room_created": "home",
    "room_joined": "room",
    "qualified_playback_reached": "room",
    "room_activated": "room",
}


class ProductAnalytics:
    def track(self, event: str, surface: str) -> None:
        if ENV != "production":
            return
        if EVENT_SURFACES.get(event) != surface:
            logger.warning("Product analytics rejected event=%s surface=%s", event, surface)
            return
        asyncio.create_task(self.send(event, surface))

    async def send(self, event: str, surface: str) -> None:
        payload = {
            "event": event,
            "event_version": 1,
            "product": "watchwithmi",
            "surface": surface,
            "environment": "production",
            "authority": "server",
            "platform": "server",
            "properties": {},
        }
        request = urllib.request.Request(
            "https://analytics.tn07.dev/v1/events",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Origin": "https://watchwithmi.tn07.dev",
            },
            method="POST",
        )
        try:
            await asyncio.to_thread(urllib.request.urlopen, request, timeout=3)
        except OSError as exc:
            logger.warning("Product analytics delivery failed for %s: %s", event, type(exc).__name__)


product_analytics = ProductAnalytics()
