"""
Socket.IO event handlers for WatchWithMi.
"""

import html
import logging
import os
import re
from typing import Any, Dict, List
import socketio

from ..config import MAX_USER_NAME_LENGTH
from .rate_limit import (
    DEFAULT_MAX_EVENTS_PER_WINDOW,
    DEFAULT_WINDOW_SECONDS,
    SlidingWindowLimiter,
)

logger = logging.getLogger("watchwithmi.handlers.socket_events")


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

# Matches strings composed entirely of emoji-related code points.
#
# Covers the practical set of emoji the UI sends:
#   U+1F300-1F6FF: Misc symbols/pictographs, Emoticons, Ornamental Dingbats,
#                  Transport & map
#   U+1F900-1F9FF: Supplemental symbols & pictographs
#   U+1FA70-1FAFF: Symbols & pictographs Extended-A
#   U+1F1E6-1F1FF: Regional indicator (flag halves)
#   U+2600-27BF  : Misc symbols + Dingbats
#   U+1F3FB-1F3FF: Skin-tone modifiers
#   U+FE0F       : Variation Selector-16 (presentation)
#   U+200D       : Zero-Width Joiner (for composed sequences)
#   U+20E3       : Combining Enclosing Keycap
_EMOJI_RE = re.compile(
    r'^[\U0001F300-\U0001F6FF'
    r'\U0001F900-\U0001F9FF'
    r'\U0001FA70-\U0001FAFF'
    r'\U0001F1E6-\U0001F1FF'
    r'\U00002600-\U000027BF'
    r'\U0001F3FB-\U0001F3FF'
    r'\u200D\uFE0F\u20E3]+$'
)

MAX_EMOJI_LENGTH = 8  # grapheme clusters (ZWJ sequences with modifiers).
MAX_PLAYLIST_ITEMS = 500


def _is_allowed_emoji(s: Any) -> bool:
    """Return True iff ``s`` is a short string of emoji-range code points."""
    if not isinstance(s, str) or not s:
        return False
    if len(s) > MAX_EMOJI_LENGTH:
        return False
    return bool(_EMOJI_RE.match(s))


def _is_allowed_thumbnail(s: Any) -> bool:
    """Thumbnails must either be blank or an http(s) URL."""
    if not isinstance(s, str) or s == "":
        return True
    return s.startswith(("http://", "https://"))


# Matches a well-formed BitTorrent magnet URI: a `xt=urn:btih:<hash>` param
# where the hash is either 40 hex chars (SHA-1 info hash) or 32 base32 chars.
# The prefix-only check that existed before accepted arbitrary junk after
# `magnet:?`. See bug #5.2 in docs/polishing/05-security.md.
_MAGNET_BTIH_RE = re.compile(
    r'^magnet:\?'               # scheme
    r'(?:[^#]*&)?'              # optional leading params
    r'xt=urn:btih:'             # info-hash param
    r'(?:[A-F0-9]{40}|[A-Z2-7]{32})'  # hex(40) or base32(32), case-insensitive handled by flag
    r'(?:&[^#]*)?$',            # optional trailing params
    re.IGNORECASE,
)


def _is_valid_magnet_url(s: Any) -> bool:
    """Return True iff ``s`` is a magnet URI with a well-formed btih hash."""
    if not isinstance(s, str):
        return False
    return bool(_MAGNET_BTIH_RE.match(s))


def _is_allowed_media_url(s: Any) -> bool:
    """Permitted media URL schemes: http(s), magnet (with valid btih), or
    a local server path (leading '/'). Magnet strings are structurally
    validated here rather than accepted on prefix alone."""
    if not isinstance(s, str):
        return False
    if s.startswith(("http://", "https://", "/")):
        return True
    if s.startswith("magnet:"):
        return _is_valid_magnet_url(s)
    return False


def _validate_playlist_items(items: List[Any]) -> str:
    """Return an empty string if ``items`` is a valid playlist, else an
    error message describing the first problem found. Used by the
    load_playlist branch in handle_media_control."""
    if len(items) > MAX_PLAYLIST_ITEMS:
        return f"Playlist has too many items (max {MAX_PLAYLIST_ITEMS})"
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            return f"Playlist item #{idx} is not an object"
        url = (item.get("url") or "").strip() if isinstance(item.get("url"), str) else ""
        title = item.get("title")
        if not url:
            return f"Playlist item #{idx} is missing a URL"
        if not isinstance(title, str) or not title.strip():
            return f"Playlist item #{idx} is missing a title"
    return ""

class SocketEventHandler:
    """Handles all Socket.IO events.

    Per-sid sliding-window rate limiting is applied to every event handler
    except `connect` / `disconnect` (which are bookkeeping; connect is
    rate-limited at the transport layer by Socket.IO, and disconnect needs
    to run to clean up limiter state). See bug #5.7 in
    docs/polishing/05-security.md.
    """

    def __init__(self, sio: socketio.AsyncServer, room_manager):
        self.sio = sio
        self.room_manager = room_manager

        # Pull configuration from env (with sensible defaults). Tests can
        # overwrite `_rate_limiter` directly with a tighter cap.
        max_events = int(
            os.getenv("SOCKET_RATE_LIMIT_MAX", DEFAULT_MAX_EVENTS_PER_WINDOW)
        )
        window_seconds = float(
            os.getenv("SOCKET_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS)
        )
        self._rate_limiter = SlidingWindowLimiter(
            max_events=max_events,
            window_seconds=window_seconds,
        )

        # Wrap before registering so the Socket.IO dispatcher picks up
        # the rate-limited versions. Must also be safe to call again if
        # a test swaps `_rate_limiter`; see `_rewrap_rate_limited_handlers`.
        self._wrap_rate_limited_handlers()
        self._register_events()
        logger.info("Socket event handlers registered")

    # Every handler listed here is wrapped with a rate-limit gate in
    # `_wrap_rate_limited_handlers`. `connect`/`disconnect` are excluded:
    # Socket.IO caps connections at the transport layer, and disconnect
    # must always run so limiter state can be cleaned up.
    _RATE_LIMITED_HANDLERS = (
        'create_room', 'join_room', 'send_message', 'media_control',
        'toggle_video', 'toggle_audio',
        'webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate',
        'grant_control', 'toggle_reaction',
        'queue_add', 'queue_remove', 'queue_reorder',
        'queue_play_next', 'queue_clear', 'video_reaction',
    )

    def _wrap_rate_limited_handlers(self):
        """Replace each rate-limited `handle_X` instance attribute with a
        wrapped version that consults `_rate_limiter` first. Late-binds
        `self._rate_limiter` / `self.sio` so tests that swap the limiter
        after construction still take effect.
        """
        outer_self = self

        def _make_wrapper(raw, name):
            async def _wrapped(sid, *args, **kwargs):
                if not outer_self._rate_limiter.allow(sid):
                    logger.warning(f"Rate limit hit for sid={sid} on {name}")
                    await outer_self.sio.emit(
                        'error',
                        {'message': 'Rate limit exceeded. Please slow down.'},
                        room=sid,
                    )
                    return None
                return await raw(sid, *args, **kwargs)
            _wrapped.__name__ = f"_rl_{name}"
            return _wrapped

        for short in self._RATE_LIMITED_HANDLERS:
            attr = f'handle_{short}'
            raw = getattr(self, attr)
            setattr(self, attr, _make_wrapper(raw, short))

    def _register_events(self):
        """Register all Socket.IO event handlers."""
        self.sio.on('connect')(self.handle_connect)
        self.sio.on('disconnect')(self.handle_disconnect)
        self.sio.on('create_room')(self.handle_create_room)
        self.sio.on('join_room')(self.handle_join_room)
        self.sio.on('send_message')(self.handle_send_message)
        self.sio.on('media_control')(self.handle_media_control)
        self.sio.on('toggle_video')(self.handle_toggle_video)
        self.sio.on('toggle_audio')(self.handle_toggle_audio)
        self.sio.on('webrtc_offer')(self.handle_webrtc_offer)
        self.sio.on('webrtc_answer')(self.handle_webrtc_answer)
        self.sio.on('webrtc_ice_candidate')(self.handle_webrtc_ice_candidate)
        self.sio.on('grant_control')(self.handle_grant_control)
        self.sio.on('toggle_reaction')(self.handle_toggle_reaction)
        self.sio.on('queue_add')(self.handle_queue_add)
        self.sio.on('queue_remove')(self.handle_queue_remove)
        self.sio.on('queue_reorder')(self.handle_queue_reorder)
        self.sio.on('queue_play_next')(self.handle_queue_play_next)
        self.sio.on('queue_clear')(self.handle_queue_clear)
        self.sio.on('video_reaction')(self.handle_video_reaction)

    async def handle_connect(self, sid: str, environ: Dict):
        """Handle client connection."""
        logger.info(f" Client {sid} connected")
        self.room_manager.update_user_session(sid, {'room_code': None, 'user_name': None})

    async def handle_disconnect(self, sid: str):
        """Handle client disconnection."""
        logger.info(f" Client {sid} disconnected")

        # Drop any rate-limit state for this sid so reconnecting with the
        # same id doesn't start with a full bucket from before.
        self._rate_limiter.forget(sid)

        try:
            session = self.room_manager.get_user_session(sid)
            if session and session.get('room_code'):
                room_code = session['room_code']
                user_name = session.get('user_name')

                # Add a longer delay to allow for page transitions and reconnections
                # This prevents immediate cleanup when user navigates between pages or refreshes
                import asyncio
                await asyncio.sleep(30)  # Increased from 3 to 30 seconds

                # Check if user has reconnected with a different session
                room = self.room_manager.get_room(room_code)
                if room and sid in room.users:
                    # Check if there's another active session for the same user
                    has_other_session = False
                    for other_sid, other_user in room.users.items():
                        if other_sid != sid and other_user.name == user_name:
                            has_other_session = True
                            break

                    # Only remove if user hasn't reconnected with different session
                    if not has_other_session:
                        new_host_id = self.room_manager.leave_room(room_code, sid)

                        # Notify room about user leaving
                        await self.sio.emit('user_left', {
                            'user_id': sid,
                            'user_name': user_name,
                            'new_host': new_host_id
                        }, room=room_code)

                        # Update user list for room
                        updated_room = self.room_manager.get_room(room_code)
                        if updated_room:
                            await self.sio.emit('users_updated', {
                                'users': {uid: user.to_dict() for uid, user in updated_room.users.items()},
                                'host': updated_room.host_id
                            }, room=room_code)
                    else:
                        # Just remove the session without notifications since user is still present
                        logger.info(f"User {user_name} has active session, cleaning up old session {sid}")
                        self.room_manager.leave_room(room_code, sid)
        except Exception as e:
            logger.error(f"Error handling disconnect for {sid}: {e}")

    async def handle_create_room(self, sid: str, data: Dict[str, Any]):
        """Handle room creation."""
        user_name = data.get('user_name', '').strip()
        requested_code = data.get('room_code', '').strip().upper()

        if not user_name:
            await self.sio.emit('error', {'message': 'Name is required'}, room=sid)
            return

        if len(user_name) > MAX_USER_NAME_LENGTH:
            await self.sio.emit(
                'error',
                {'message': f'Name must be {MAX_USER_NAME_LENGTH} characters or fewer'},
                room=sid,
            )
            return

        # Defense-in-depth: HTML-escape at ingress so non-browser clients
        # and any future `dangerouslySetInnerHTML` regression can't see raw
        # tags (bug #5.1 in docs/polishing/05-security.md).
        user_name = html.escape(user_name)

        try:
            # Create room
            room_code = self.room_manager.create_room(user_name, requested_code if requested_code else None)

            # Join Socket.IO room BEFORE updating room state to keep them atomic.
            # If enter_room fails, we don't leave orphaned state in room_manager.
            try:
                await self.sio.enter_room(sid, room_code)
            except Exception as e:
                logger.error(f"Failed to enter Socket.IO room {room_code}: {e}")
                await self.sio.emit('error', {'message': 'Failed to create room'}, room=sid)
                return

            # Join as host
            success = self.room_manager.join_room(room_code, sid, user_name, True)

            if success:
                logger.debug(f" User {sid} entered Socket.IO room {room_code}")

                # Get room data
                room = self.room_manager.get_room(room_code)

                # Send response
                await self.sio.emit('room_created', {
                    'room_code': room_code,
                    'user_id': sid,
                    'is_host': True,
                    'media': room.media.to_dict(),
                    'users': {uid: user.to_dict() for uid, user in room.users.items()},
                    'chat': [msg.to_dict() for msg in room.chat],
                    'queue': [item.to_dict() for item in room.queue]
                }, room=sid)

                logger.info(f" Room {room_code} created successfully by {user_name}")
            else:
                await self.sio.emit('error', {'message': 'Failed to create room'}, room=sid)

        except Exception as e:
            logger.error(f" Error creating room: {e}")
            await self.sio.emit('error', {'message': 'Server error occurred'}, room=sid)

    async def handle_join_room(self, sid: str, data: Dict[str, Any]):
        """Handle user joining a room."""
        room_code = data.get('room_code', '').strip().upper()
        user_name = data.get('user_name', '').strip()

        if not room_code or not user_name:
            await self.sio.emit('error', {'message': 'Room code and name are required'}, room=sid)
            return

        if len(user_name) > MAX_USER_NAME_LENGTH:
            await self.sio.emit(
                'error',
                {'message': f'Name must be {MAX_USER_NAME_LENGTH} characters or fewer'},
                room=sid,
            )
            return

        # Defense-in-depth HTML escape (bug #5.1).
        user_name = html.escape(user_name)

        try:
            # Check if room exists
            room = self.room_manager.get_room(room_code)
            if not room:
                await self.sio.emit('error', {'message': 'Room not found'}, room=sid)
                return

            # Check if this user is reconnecting by matching their previous session ID.
            # We don't match by username because names aren't unique -- two different
            # people could share the same display name.
            existing_user = None
            was_existing_host = False
            previous_session = self.room_manager.get_user_session(sid)
            previous_sid = previous_session.get('previous_sid') if previous_session else None
            if previous_sid and previous_sid in room.users:
                existing_user = room.users[previous_sid]
                was_existing_host = existing_user.is_host
            elif sid in room.users:
                existing_user = room.users[sid]
                was_existing_host = existing_user.is_host

            # Determine if user should be host
            # Case 1: Empty room - first user becomes host
            # Case 2: Reconnecting as previous host
            # Case 3: Room exists but no active host (dead host session)
            is_host = (room.user_count == 0 or
                      was_existing_host or
                      room.host_id is None or
                      room.host_id not in room.users)

            # Join Socket.IO room BEFORE updating room state to keep them atomic.
            # If enter_room fails, we don't leave orphaned state in room_manager.
            try:
                await self.sio.enter_room(sid, room_code)
            except Exception as e:
                logger.error(f"Failed to enter Socket.IO room {room_code}: {e}")
                await self.sio.emit('error', {'message': 'Failed to join room'}, room=sid)
                return

            logger.info(f"Adding user {user_name} to room {room_code} (as host: {is_host})")
            success = self.room_manager.join_room(room_code, sid, user_name, is_host)

            if success:
                # Log host assignment details after join
                updated_room = self.room_manager.get_room(room_code)
                is_actually_host = updated_room.users[sid].is_host

                if existing_user:
                    logger.info(f"User {user_name} reconnected (was_host: {was_existing_host}, now_host: {is_actually_host})")
                else:
                    logger.info(f"New user {user_name} joined (is_host: {is_actually_host})")

                # Prepare response payload
                user_list = {uid: user.to_dict() for uid, user in updated_room.users.items()}
                logger.debug(f"Room {room_code} state - users: {list(user_list.keys())}, host: {updated_room.host_id}")

                # Send success response to user
                await self.sio.emit('room_joined', {
                    'room_code': room_code,
                    'user_id': sid,
                    'is_host': is_actually_host,
                    'media': updated_room.media.to_dict(),
                    'users': user_list,
                    'chat': [msg.to_dict() for msg in updated_room.chat],
                    'queue': [item.to_dict() for item in updated_room.queue]
                }, room=sid)

                # Only notify others if this is a new user (not a reconnection)
                if not existing_user:
                    logger.info(f"🔔 Sending user_joined event for {user_name} to room {room_code} (excluding {sid})")
                    await self.sio.emit('user_joined', {
                        'user_id': sid,
                        'user_name': user_name,
                        'is_host': updated_room.users[sid].is_host
                    }, room=room_code, skip_sid=sid)
                else:
                    logger.info(f"User {user_name} reconnected to room {room_code}, not sending join notification")

                # Update user list for everyone
                await self.sio.emit('users_updated', {
                    'users': {uid: user.to_dict() for uid, user in updated_room.users.items()},
                    'host': updated_room.host_id
                }, room=room_code)

                logger.info(f" User {user_name} joined room {room_code} (total users: {len(updated_room.users)})")
            else:
                await self.sio.emit('error', {'message': 'Failed to join room'}, room=sid)

        except Exception as e:
            logger.error(f" Error joining room: {e}")
            await self.sio.emit('error', {'message': 'Server error occurred'}, room=sid)

    async def handle_send_message(self, sid: str, data: Dict[str, Any]):
        """Handle chat messages."""
        message = data.get('message', '').strip()
        if not message:
            await self.sio.emit('error', {'message': 'Message cannot be empty'}, room=sid)
            return

        # Defense-in-depth HTML escape so the stored + broadcast payload is
        # safe for any consumer (not just React's auto-escaped text nodes).
        # See bug #5.1 in docs/polishing/05-security.md.
        message = html.escape(message)

        try:
            # Debug session and room info
            session = self.room_manager.get_user_session(sid)
            logger.debug(f" Send message attempt - SID: {sid}, Session: {session}, Message: {message}")

            result = self.room_manager.send_message(sid, message)
            if result:
                room_code, chat_message = result
                logger.debug(f" Broadcasting to room {room_code}: {chat_message.to_dict()}")

                # Broadcast to room
                await self.sio.emit('new_message', chat_message.to_dict(), room=room_code)
                logger.debug(f" Message sent in room {room_code}: {chat_message.user_name}: {message}")
            else:
                logger.warning(f" User {sid} not in a room when trying to send message")
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)

        except Exception as e:
            logger.error(f" Error sending message: {e}")
            await self.sio.emit('error', {'message': 'Failed to send message'}, room=sid)

    async def handle_media_control(self, sid: str, data: Dict[str, Any]):
        """Handle media control events (play, pause, seek, change)."""
        action = data.get('action')
        if not action:
            return

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room:
                await self.sio.emit('error', {'message': 'Room not found'}, room=sid)
                return

            # Compatibility path for older clients that emit AV toggle as media_control.
            if action == 'video_toggle':
                await self.handle_toggle_video(sid, {'enabled': bool(data.get('enabled', False))})
                return
            if action == 'audio_toggle':
                await self.handle_toggle_audio(sid, {'enabled': bool(data.get('enabled', False))})
                return

            room_user = room.users.get(sid)
            can_control = room_user.can_control if room_user else False

            # Check permissions for all control actions
            # Only users with 'can_control=True' can perform these actions
            if not can_control:
                logger.warning(f"🚫 Unauthorized media control attempt by {session.get('user_name')} ({sid}) in room {room_code}")
                await self.sio.emit('error', {'message': 'You do not have permission to control media'}, room=sid)
                return

            user_name = session.get('user_name', 'Unknown')

            if action == 'play':
                timestamp = data.get('timestamp', room.media.timestamp)

                # Guard against buffer glitch: timestamp 0 when room is well past the start
                if timestamp == 0 and room.media.timestamp > 30:
                    logger.warning(
                        f"⚠️ Rejecting play event with timestamp=0 from {user_name} in room {room_code} "
                        f"(room timestamp is {room.media.timestamp}s) — likely a buffer glitch"
                    )
                    return

                self.room_manager.update_media(sid, state='playing', timestamp=timestamp)
                logger.info(f"▶️ Broadcasting media_play to room {room_code} at {timestamp}s (users: {list(room.users.keys())})")
                await self.sio.emit('media_play', {
                    'timestamp': timestamp,
                    'user_name': user_name
                }, room=room_code)

            elif action == 'pause':
                timestamp = data.get('timestamp', room.media.timestamp)

                # Guard against buffer glitch: timestamp 0 when room is well past the start
                if timestamp == 0 and room.media.timestamp > 30:
                    logger.warning(
                        f"⚠️ Rejecting pause event with timestamp=0 from {user_name} in room {room_code} "
                        f"(room timestamp is {room.media.timestamp}s) — likely a buffer glitch"
                    )
                    return

                self.room_manager.update_media(sid, state='paused', timestamp=timestamp)
                logger.info(f" Broadcasting media_pause to room {room_code} (users: {list(room.users.keys())})")
                await self.sio.emit('media_pause', {
                    'timestamp': timestamp,
                    'user_name': user_name
                }, room=room_code)

            elif action == 'seek':
                timestamp = data.get('timestamp', 0)

                # Guard against buffer glitch: timestamp 0 when room is well past the start
                if timestamp == 0 and room.media.timestamp > 30:
                    logger.warning(
                        f"⚠️ Rejecting seek event with timestamp=0 from {user_name} in room {room_code} "
                        f"(room timestamp is {room.media.timestamp}s) — likely a buffer glitch"
                    )
                    return

                self.room_manager.update_media(sid, timestamp=timestamp)
                await self.sio.emit('media_seek', {
                    'timestamp': timestamp,
                    'user_name': user_name
                }, room=room_code)

            elif action == 'change' or action == 'change_media':
                media_url = data.get('url', '').strip()
                media_type = data.get('type', 'youtube')
                media_title = data.get('title', '')

                # Validate media_url scheme + (for magnet) structural btih check.
                if not _is_allowed_media_url(media_url):
                    await self.sio.emit('error', {'message': 'Invalid media URL'}, room=sid)
                    return

                # Validate media_type is one of the supported types
                allowed_media_types = ('youtube', 'video', 'audio', 'media')
                if media_type not in allowed_media_types:
                    await self.sio.emit('error', {'message': f'Invalid media type. Must be one of: {", ".join(allowed_media_types)}'}, room=sid)
                    return

                if media_url:
                    self.room_manager.update_media(
                        sid,
                        url=media_url,
                        media_type=media_type,
                        state='paused',
                        timestamp=0,
                        title=media_title,
                        is_playlist=False,
                        playlist_id='',
                        playlist_title='',
                        playlist_items=[],
                        current_index=0
                    )

                    logger.info(f"📺 Broadcasting media_changed to room {room_code}: {media_title}")
                    await self.sio.emit('media_changed', {
                        'url': media_url,
                        'type': media_type,
                        'title': media_title,
                        'user_name': user_name,
                        'is_playlist': False,
                        'playlist_id': '',
                        'playlist_title': '',
                        'playlist_items': [],
                        'current_index': 0
                    }, room=room_code)

            elif action == 'load_playlist':
                playlist_items = data.get('items') or []
                if not isinstance(playlist_items, list) or len(playlist_items) == 0:
                    await self.sio.emit('error', {'message': 'Playlist has no playable items'}, room=sid)
                    return

                # Per-item validation and a size cap so a 10k-item payload
                # with malformed entries can't be broadcast wholesale
                # (bug #3.4 in 03-chat-reactions-queue.md).
                validation_error = _validate_playlist_items(playlist_items)
                if validation_error:
                    await self.sio.emit('error', {'message': validation_error}, room=sid)
                    return

                playlist_id = (data.get('playlist_id') or '').strip()
                playlist_title = (data.get('playlist_title') or '').strip()
                current_index = 0
                first_item = playlist_items[current_index]
                media_url = (first_item.get('url') or '').strip()
                media_title = first_item.get('title', '')

                self.room_manager.update_media(
                    sid,
                    url=media_url,
                    media_type='youtube',
                    state='paused',
                    timestamp=0,
                    title=media_title,
                    is_playlist=True,
                    playlist_id=playlist_id,
                    playlist_title=playlist_title,
                    playlist_items=playlist_items,
                    current_index=current_index
                )

                await self.sio.emit('media_changed', {
                    'url': media_url,
                    'type': 'youtube',
                    'title': media_title,
                    'user_name': user_name,
                    'is_playlist': True,
                    'playlist_id': playlist_id,
                    'playlist_title': playlist_title,
                    'playlist_items': playlist_items,
                    'current_index': current_index
                }, room=room_code)

                await self.sio.emit('playlist_updated', {
                    'playlist_id': playlist_id,
                    'playlist_title': playlist_title,
                    'playlist_items': playlist_items,
                    'current_index': current_index,
                    'user_name': user_name
                }, room=room_code)

            elif action in ('playlist_next', 'playlist_prev', 'playlist_select'):
                playlist_items = room.media.playlist_items or []
                if not room.media.is_playlist or not playlist_items:
                    await self.sio.emit('error', {'message': 'No active playlist in this room'}, room=sid)
                    return

                current_index = room.media.current_index or 0
                new_index = current_index

                if action == 'playlist_next':
                    if current_index < len(playlist_items) - 1:
                        new_index = current_index + 1
                elif action == 'playlist_prev':
                    if current_index > 0:
                        new_index = current_index - 1
                elif action == 'playlist_select':
                    requested_index = data.get('index')
                    if isinstance(requested_index, int) and 0 <= requested_index < len(playlist_items):
                        new_index = requested_index

                selected_item = playlist_items[new_index]
                media_url = (selected_item.get('url') or '').strip()
                media_title = selected_item.get('title', '')
                if not media_url:
                    await self.sio.emit('error', {'message': 'Selected playlist item is invalid'}, room=sid)
                    return

                self.room_manager.update_media(
                    sid,
                    url=media_url,
                    media_type='youtube',
                    state='paused',
                    timestamp=0,
                    title=media_title,
                    is_playlist=True,
                    playlist_id=room.media.playlist_id,
                    playlist_title=room.media.playlist_title,
                    playlist_items=playlist_items,
                    current_index=new_index
                )

                await self.sio.emit('media_changed', {
                    'url': media_url,
                    'type': 'youtube',
                    'title': media_title,
                    'user_name': user_name,
                    'is_playlist': True,
                    'playlist_id': room.media.playlist_id,
                    'playlist_title': room.media.playlist_title,
                    'playlist_items': playlist_items,
                    'current_index': new_index
                }, room=room_code)

                await self.sio.emit('playlist_updated', {
                    'playlist_id': room.media.playlist_id,
                    'playlist_title': room.media.playlist_title,
                    'playlist_items': playlist_items,
                    'current_index': new_index,
                    'user_name': user_name
                }, room=room_code)

            elif action == 'start_loading':
                media_type = data.get('type', 'media')
                media_title = data.get('title', 'Loading media...')

                logger.info(f" Broadcasting media_loading to room {room_code} - {media_title}")
                await self.sio.emit('media_loading', {
                    'type': media_type,
                    'title': media_title,
                    'user_name': user_name
                }, room=room_code)

            elif action == 'media_progress':
                media_status = data.get('media_status')

                if media_status:
                    logger.debug(f" Broadcasting media_progress to room {room_code}: {media_status.get('progress', 0) * 100:.1f}%")
                    await self.sio.emit('media_progress', {
                        'media_status': media_status,
                        'user_name': user_name
                    }, room=room_code)

            logger.debug(f"🎮 Media control in room {room_code}: {action} by {user_name}")

        except Exception as e:
            logger.error(f" Error handling media control: {e}")
            await self.sio.emit('error', {'message': 'Media control failed'}, room=sid)

    async def handle_toggle_video(self, sid: str, data: Dict[str, Any]):
        """Handle video toggle events."""
        enabled = data.get('enabled', False)

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room or sid not in room.users:
                await self.sio.emit('error', {'message': 'User not in room'}, room=sid)
                return

            # Update user's video state
            room.users[sid].video_enabled = enabled
            user_name = room.users[sid].name

            # Broadcast to all users in room
            await self.sio.emit('user_video_toggled', {
                'user_id': sid,
                'user_name': user_name,
                'video_enabled': enabled
            }, room=room_code)

            # Update user list for everyone
            await self.sio.emit('users_updated', {
                'users': {uid: user.to_dict() for uid, user in room.users.items()},
                'host': room.host_id
            }, room=room_code)

            logger.info(f"📹 User {user_name} {'enabled' if enabled else 'disabled'} video in room {room_code}")

        except Exception as e:
            logger.error(f" Error toggling video: {e}")
            await self.sio.emit('error', {'message': 'Failed to toggle video'}, room=sid)

    async def handle_toggle_audio(self, sid: str, data: Dict[str, Any]):
        """Handle audio toggle events."""
        enabled = data.get('enabled', False)

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room or sid not in room.users:
                await self.sio.emit('error', {'message': 'User not in room'}, room=sid)
                return

            # Update user's audio state
            room.users[sid].audio_enabled = enabled
            user_name = room.users[sid].name

            # Broadcast to all users in room
            await self.sio.emit('user_audio_toggled', {
                'user_id': sid,
                'user_name': user_name,
                'audio_enabled': enabled
            }, room=room_code)

            # Update user list for everyone
            await self.sio.emit('users_updated', {
                'users': {uid: user.to_dict() for uid, user in room.users.items()},
                'host': room.host_id
            }, room=room_code)

            logger.info(f"🎤 User {user_name} {'enabled' if enabled else 'disabled'} audio in room {room_code}")

        except Exception as e:
            logger.error(f" Error toggling audio: {e}")
            await self.sio.emit('error', {'message': 'Failed to toggle audio'}, room=sid)

    async def handle_webrtc_offer(self, sid: str, data: Dict[str, Any]):
        """Handle WebRTC offer signaling."""
        target_user_id = data.get('target_user_id')
        offer = data.get('offer')

        if not target_user_id or not offer:
            await self.sio.emit('error', {'message': 'Missing target_user_id or offer'}, room=sid)
            return

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room or sid not in room.users or target_user_id not in room.users:
                return

            # Forward offer to target user
            await self.sio.emit('webrtc_offer', {
                'from_user_id': sid,
                'from_user_name': room.users[sid].name,
                'offer': offer
            }, room=target_user_id)

            logger.debug(f" WebRTC offer forwarded from {sid} to {target_user_id} in room {room_code}")

        except Exception as e:
            logger.error(f" Error handling WebRTC offer: {e}")

    async def handle_webrtc_answer(self, sid: str, data: Dict[str, Any]):
        """Handle WebRTC answer signaling."""
        target_user_id = data.get('target_user_id')
        answer = data.get('answer')

        if not target_user_id or not answer:
            await self.sio.emit('error', {'message': 'Missing target_user_id or answer'}, room=sid)
            return

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room or sid not in room.users or target_user_id not in room.users:
                return

            # Forward answer to target user
            await self.sio.emit('webrtc_answer', {
                'from_user_id': sid,
                'from_user_name': room.users[sid].name,
                'answer': answer
            }, room=target_user_id)

            logger.debug(f" WebRTC answer forwarded from {sid} to {target_user_id} in room {room_code}")

        except Exception as e:
            logger.error(f" Error handling WebRTC answer: {e}")

    async def handle_webrtc_ice_candidate(self, sid: str, data: Dict[str, Any]):
        """Handle WebRTC ICE candidate signaling."""
        target_user_id = data.get('target_user_id')
        candidate = data.get('candidate')

        if not target_user_id or not candidate:
            await self.sio.emit('error', {'message': 'Missing target_user_id or candidate'}, room=sid)
            return

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                return

            room_code = session['room_code']
            room = self.room_manager.get_room(room_code)

            if not room or sid not in room.users or target_user_id not in room.users:
                return

            # Forward ICE candidate to target user
            await self.sio.emit('webrtc_ice_candidate', {
                'from_user_id': sid,
                'from_user_name': room.users[sid].name,
                'candidate': candidate
            }, room=target_user_id)

            logger.debug(f" WebRTC ICE candidate forwarded from {sid} to {target_user_id} in room {room_code}")

        except Exception as e:
            logger.error(f" Error handling WebRTC ICE candidate: {e}")

    async def handle_grant_control(self, sid: str, data: Dict[str, Any]):
        """Handle granting/revoking control (DJ) permissions."""
        target_user_id = data.get('user_id')
        enabled = data.get('enabled', False)

        if not target_user_id:
            await self.sio.emit('error', {'message': 'Missing target user_id'}, room=sid)
            return

        try:
            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)
                return

            room_code = session['room_code']

            # Use RoomManager to update permission (handles host check)
            success = self.room_manager.set_user_control(sid, target_user_id, enabled)

            if success:
                # Update everyone in the room with the new user state
                updated_room = self.room_manager.get_room(room_code)
                if updated_room:
                    await self.sio.emit('users_updated', {
                        'users': {uid: user.to_dict() for uid, user in updated_room.users.items()},
                        'host': updated_room.host_id
                    }, room=room_code)

                    target_name = updated_room.users[target_user_id].name
                    logger.info(f"Host {session.get('user_name')} {'granted' if enabled else 'revoked'} control for {target_name} in {room_code}")
            else:
                await self.sio.emit('error', {'message': 'Action failed or unauthorized'}, room=sid)

        except Exception as e:
            logger.error(f" Error handling grant_control: {e}")

    async def handle_toggle_reaction(self, sid: str, data: Dict[str, Any]):
        """Handle toggling an emoji reaction on a chat message."""
        message_id = data.get('message_id', '')
        emoji = data.get('emoji', '')

        if not message_id or not emoji:
            await self.sio.emit('error', {'message': 'message_id and emoji are required'}, room=sid)
            return

        # Whitelist: only characters in known emoji ranges are accepted.
        # A bare `len(emoji) <= 2` check accepted arbitrary two-character
        # payloads (e.g. "ab", "<b") — tracked as bug #3.1 in
        # docs/polishing/03-chat-reactions-queue.md.
        if not _is_allowed_emoji(emoji):
            await self.sio.emit('error', {'message': 'Invalid emoji'}, room=sid)
            return

        try:
            result = self.room_manager.toggle_reaction(sid, message_id, emoji)
            if result:
                room_code, msg_id, updated_reactions = result
                await self.sio.emit('reaction_updated', {
                    'message_id': msg_id,
                    'reactions': updated_reactions
                }, room=room_code)
            else:
                await self.sio.emit('error', {'message': 'Message not found or not in a room'}, room=sid)

        except Exception as e:
            logger.error(f"Error handling toggle_reaction: {e}")
            await self.sio.emit('error', {'message': 'Failed to toggle reaction'}, room=sid)

    async def _emit_queue_updated(self, room_code: str):
        """Helper to emit queue_updated with the current queue state."""
        room = self.room_manager.get_room(room_code)
        if room:
            await self.sio.emit('queue_updated', {
                'queue': [item.to_dict() for item in room.queue]
            }, room=room_code)

    async def handle_queue_add(self, sid: str, data: Dict[str, Any]):
        """Handle adding an item to the media queue. Any user in the room can add."""
        url = (data.get('url') or '').strip()
        title = (data.get('title') or '').strip()
        media_type = data.get('media_type', 'youtube')
        thumbnail = (data.get('thumbnail') or '').strip()

        # Validate URL scheme + (for magnet) btih structure.
        if not _is_allowed_media_url(url):
            await self.sio.emit('error', {'message': 'Invalid media URL'}, room=sid)
            return

        # Validate title -- empty or whitespace-only titles aren't useful and
        # cause blank rows in the queue UI (bug #4 in 01-critical-bugs.md).
        if not title:
            await self.sio.emit('error', {'message': 'Title is required'}, room=sid)
            return

        # Validate thumbnail URL. Blank is fine; anything else must be http(s).
        # Accepting arbitrary strings let javascript: or relative paths leak
        # into the UI (bug #3.6 in 03-chat-reactions-queue.md).
        if not _is_allowed_thumbnail(thumbnail):
            await self.sio.emit(
                'error',
                {'message': 'Thumbnail must be an http:// or https:// URL'},
                room=sid,
            )
            return

        # Validate media_type
        allowed_media_types = ('youtube', 'video', 'audio', 'media')
        if media_type not in allowed_media_types:
            await self.sio.emit('error', {
                'message': f'Invalid media type. Must be one of: {", ".join(allowed_media_types)}'
            }, room=sid)
            return

        try:
            result = self.room_manager.add_to_queue(sid, url, title, media_type, thumbnail)
            if result:
                room_code, queue_item = result
                logger.info(f"Queue item added in room {room_code}: '{title}' by {queue_item.added_by_name}")
                await self._emit_queue_updated(room_code)
            else:
                await self.sio.emit('error', {'message': 'Failed to add to queue (queue may be full)'}, room=sid)
        except Exception as e:
            logger.error(f"Error handling queue_add: {e}")
            await self.sio.emit('error', {'message': 'Failed to add to queue'}, room=sid)

    async def handle_queue_remove(self, sid: str, data: Dict[str, Any]):
        """Handle removing an item from the media queue."""
        item_id = data.get('item_id', '')
        if not item_id:
            await self.sio.emit('error', {'message': 'item_id is required'}, room=sid)
            return

        try:
            room_code = self.room_manager.remove_from_queue(sid, item_id)
            if room_code:
                logger.info(f"Queue item {item_id} removed in room {room_code}")
                await self._emit_queue_updated(room_code)
            else:
                await self.sio.emit('error', {'message': 'Failed to remove item (not found or unauthorized)'}, room=sid)
        except Exception as e:
            logger.error(f"Error handling queue_remove: {e}")
            await self.sio.emit('error', {'message': 'Failed to remove from queue'}, room=sid)

    async def handle_queue_reorder(self, sid: str, data: Dict[str, Any]):
        """Handle reordering a queue item. Host or DJ only."""
        item_id = data.get('item_id', '')
        new_index = data.get('new_index')

        if not item_id or not isinstance(new_index, int):
            await self.sio.emit('error', {'message': 'item_id and new_index (int) are required'}, room=sid)
            return

        # Validate bounds explicitly at the handler layer -- the model
        # clamps silently, which hides client bugs (bug #5 in
        # docs/polishing/01-critical-bugs.md).
        session = self.room_manager.get_user_session(sid)
        room = self.room_manager.get_room(session.get('room_code')) if session else None
        if room is not None:
            queue_len = len(room.queue)
            if new_index < 0 or new_index >= queue_len:
                await self.sio.emit(
                    'error',
                    {
                        'message': (
                            f'new_index {new_index} is out of range '
                            f'(queue length {queue_len})'
                        )
                    },
                    room=sid,
                )
                return

        try:
            room_code = self.room_manager.reorder_queue(sid, item_id, new_index)
            if room_code:
                logger.info(f"Queue item {item_id} reordered to index {new_index} in room {room_code}")
                await self._emit_queue_updated(room_code)
            else:
                await self.sio.emit('error', {'message': 'Failed to reorder (not found or unauthorized)'}, room=sid)
        except Exception as e:
            logger.error(f"Error handling queue_reorder: {e}")
            await self.sio.emit('error', {'message': 'Failed to reorder queue'}, room=sid)

    async def handle_queue_play_next(self, sid: str, data: Dict[str, Any]):
        """Handle playing the next item from the queue. Host or DJ only."""
        try:
            result = self.room_manager.play_next_from_queue(sid)
            if result:
                room_code, queue_item = result
                session = self.room_manager.get_user_session(sid)
                user_name = session.get('user_name', 'Unknown') if session else 'Unknown'

                # Update room media state to the queue item
                self.room_manager.update_media(
                    sid,
                    url=queue_item.url,
                    media_type=queue_item.media_type,
                    state='paused',
                    timestamp=0,
                    title=queue_item.title,
                    is_playlist=False,
                    playlist_id='',
                    playlist_title='',
                    playlist_items=[],
                    current_index=0
                )

                # Emit media_changed
                await self.sio.emit('media_changed', {
                    'url': queue_item.url,
                    'type': queue_item.media_type,
                    'title': queue_item.title,
                    'user_name': user_name,
                    'is_playlist': False,
                    'playlist_id': '',
                    'playlist_title': '',
                    'playlist_items': [],
                    'current_index': 0
                }, room=room_code)

                # Emit queue_updated
                await self._emit_queue_updated(room_code)

                logger.info(f"Playing next from queue in room {room_code}: '{queue_item.title}'")
            else:
                await self.sio.emit('error', {'message': 'Queue is empty or unauthorized'}, room=sid)
        except Exception as e:
            logger.error(f"Error handling queue_play_next: {e}")
            await self.sio.emit('error', {'message': 'Failed to play next from queue'}, room=sid)

    async def handle_queue_clear(self, sid: str, data: Dict[str, Any]):
        """Handle clearing the entire queue. Host only."""
        try:
            room_code = self.room_manager.clear_queue(sid)
            if room_code:
                logger.info(f"Queue cleared in room {room_code}")
                await self._emit_queue_updated(room_code)
            else:
                await self.sio.emit('error', {'message': 'Failed to clear queue (unauthorized)'}, room=sid)
        except Exception as e:
            logger.error(f"Error handling queue_clear: {e}")
            await self.sio.emit('error', {'message': 'Failed to clear queue'}, room=sid)

    async def handle_video_reaction(self, sid: str, data: Dict[str, Any]):
        """Handle ephemeral video reactions. Fire and forget — no storage.

        Validation failures emit a structured ``error`` event to the sender,
        matching the pattern used by other handlers (bug #7 in
        docs/polishing/01-critical-bugs.md). Silent returns made these
        failures undiagnosable from the client.
        """
        try:
            emoji = data.get('emoji', '')
            if not isinstance(emoji, str) or len(emoji) == 0 or len(emoji) > 2:
                await self.sio.emit(
                    'error',
                    {'message': 'Invalid emoji (must be a 1-2 character string)'},
                    room=sid,
                )
                return

            session = self.room_manager.get_user_session(sid)
            if not session or not session.get('room_code'):
                await self.sio.emit(
                    'error',
                    {'message': 'You must be in a room to send reactions'},
                    room=sid,
                )
                return

            room_code = session['room_code']
            user_name = session.get('user_name', 'Unknown')

            await self.sio.emit('video_reaction', {
                'emoji': emoji,
                'user_name': user_name,
                'user_id': sid,
            }, room=room_code)
        except Exception as e:
            logger.error(f"Error handling video_reaction: {e}")
            await self.sio.emit('error', {'message': 'Failed to send reaction'}, room=sid)
