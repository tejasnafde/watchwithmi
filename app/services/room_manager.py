"""
Room management service for WatchWithMi.
"""

import logging
from typing import Dict, Optional, Tuple
import time
import uuid
from ..models.room import Room, QueueItem, generate_room_code
from ..config import MAX_USERS_PER_ROOM, ROOM_CODE_LENGTH

logger = logging.getLogger("watchwithmi.services.room_manager")

class RoomManager:
    """Manages all room operations and state."""

    def __init__(self):
        self._rooms: Dict[str, Room] = {}
        self._user_sessions: Dict[str, Dict] = {}
        logger.info("RoomManager initialized")

    def create_room(self, host_name: str, requested_code: Optional[str] = None) -> str:
        """Create a new room and return the room code."""
        if requested_code:
            requested_code = requested_code.upper()
            if requested_code not in self._rooms:
                room_code = requested_code
            else:
                room_code = self._generate_unique_room_code()
        else:
            room_code = self._generate_unique_room_code()

        room = Room(room_code)
        self._rooms[room_code] = room

        logger.info(f"Created room {room_code} for host {host_name}")
        return room_code

    def get_room(self, room_code: str) -> Optional[Room]:
        """Get a room by its code."""
        return self._rooms.get(room_code.upper())

    def join_room(self, room_code: str, user_id: str, user_name: str, is_host: bool = False) -> bool:
        """Add a user to a room."""
        room_code = room_code.upper()
        room = self.get_room(room_code)

        if not room:
            logger.warning(f" Attempted to join non-existent room {room_code}")
            return False

        if room.user_count >= MAX_USERS_PER_ROOM:
            logger.warning(f" Room {room_code} is full ({MAX_USERS_PER_ROOM} users)")
            return False

        # Remove any existing sessions for the same user name to prevent duplicates
        existing_user_ids = []
        for existing_user_id, existing_user in room.users.items():
            if existing_user.name == user_name and existing_user_id != user_id:
                existing_user_ids.append(existing_user_id)

        # Remove duplicate users
        for existing_user_id in existing_user_ids:
            logger.info(f"Removing duplicate session for {user_name} (old SID: {existing_user_id}, new SID: {user_id})")
            self.leave_room(room_code, existing_user_id)

        success = room.add_user(user_id, user_name, is_host)
        if success:
            self._user_sessions[user_id] = {
                'room_code': room_code,
                'user_name': user_name
            }
            logger.debug(f"User session updated for {user_id} in {room_code}")

        return success

    def leave_room(self, room_code: str, user_id: str) -> Optional[str]:
        """Remove a user from a room. Returns new host ID if host changed."""
        room = self.get_room(room_code)
        if not room:
            return None

        new_host_id = room.remove_user(user_id)

        # Remove user session
        if user_id in self._user_sessions:
            del self._user_sessions[user_id]

        # Clean up empty rooms
        if room.is_empty:
            if room_code in self._rooms:
                del self._rooms[room_code]
                logger.info(f" Cleaned up empty room {room_code}")

        return new_host_id

    def get_user_session(self, user_id: str) -> Optional[Dict]:
        """Get user session data."""
        return self._user_sessions.get(user_id)

    def update_user_session(self, user_id: str, session_data: Dict) -> None:
        """Update user session data."""
        if user_id in self._user_sessions:
            self._user_sessions[user_id].update(session_data)
        else:
            self._user_sessions[user_id] = session_data

    def send_message(self, user_id: str, message: str) -> Optional[tuple]:
        """Send a chat message. Returns (room_code, chat_message) if successful."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room:
            return None

        chat_message = room.add_message(user_id, message)
        if chat_message:
            return room_code, chat_message

        return None

    def update_media(self, user_id: str, **media_updates) -> Optional[str]:
        """Update media state. Returns room_code if successful."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room:
            return None

        # Check if user has permission to control media
        if user_id not in room.users or not room.users[user_id].can_control:
            logger.warning(f"🚫 User {user_id} attempted media update without control permissions in room {room_code}")
            return None

        room.update_media(**media_updates)
        return room_code

    def set_user_control(self, requester_id: str, target_id: str, enabled: bool) -> bool:
        """Set control permissions for a target user. Only host can do this."""
        session = self.get_user_session(requester_id)
        if not session:
            return False

        room_code = session.get('room_code')
        room = self.get_room(room_code) if room_code else None

        if not room:
            return False

        # Only the actual room creator/host can grant/revoke control
        if room.host_id != requester_id:
            logger.warning(f"🚫 User {requester_id} (non-host) tried to manage controls in room {room_code}")
            return False

        return room.grant_control(target_id, enabled)

    def toggle_reaction(self, user_id: str, message_id: str, emoji: str) -> Optional[Tuple[str, str, Dict]]:
        """Toggle a reaction on a message. Returns (room_code, message_id, updated_reactions) or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room:
            return None

        updated_reactions = room.toggle_reaction(message_id, emoji, user_id)
        if updated_reactions is None:
            return None

        return room_code, message_id, updated_reactions

    def add_to_queue(self, user_id: str, url: str, title: str, media_type: str, thumbnail: str = "") -> Optional[Tuple[str, QueueItem]]:
        """Add an item to the room queue. Returns (room_code, queue_item) or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room or user_id not in room.users:
            return None

        item = QueueItem(
            id=str(uuid.uuid4()),
            url=url,
            title=title,
            media_type=media_type,
            added_by=user_id,
            added_by_name=room.users[user_id].name,
            added_at=time.time(),
            thumbnail=thumbnail,
        )

        if room.add_to_queue(item):
            return room_code, item
        return None

    def remove_from_queue(self, user_id: str, item_id: str) -> Optional[str]:
        """Remove an item from the room queue. Returns room_code or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room or user_id not in room.users:
            return None

        if room.remove_from_queue(item_id, user_id):
            return room_code
        return None

    def reorder_queue(self, user_id: str, item_id: str, new_index: int) -> Optional[str]:
        """Reorder a queue item. Returns room_code or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room or user_id not in room.users:
            return None

        if room.reorder_queue(item_id, new_index, user_id):
            return room_code
        return None

    def play_next_from_queue(self, user_id: str) -> Optional[Tuple[str, QueueItem]]:
        """Pop the next queue item. Only host/can_control. Returns (room_code, item) or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room or user_id not in room.users:
            return None

        # Permission check: host or DJ
        if user_id != room.host_id and not room.users[user_id].can_control:
            return None

        item = room.pop_next_from_queue()
        if item:
            return room_code, item
        return None

    def clear_queue(self, user_id: str) -> Optional[str]:
        """Clear the entire queue. Host only. Returns room_code or None."""
        session = self.get_user_session(user_id)
        if not session or not session.get('room_code'):
            return None

        room_code = session['room_code']
        room = self.get_room(room_code)
        if not room or user_id not in room.users:
            return None

        if room.clear_queue(user_id):
            return room_code
        return None

    def is_user_host(self, user_id: str) -> bool:
        """Check if a user is the host of their room."""
        session = self.get_user_session(user_id)
        if not session:
            return False

        room = self.get_room(session.get('room_code', ''))
        if not room or user_id not in room.users:
            return False

        return room.users[user_id].is_host

    def _generate_unique_room_code(self) -> str:
        """Generate a unique room code."""
        while True:
            code = generate_room_code(ROOM_CODE_LENGTH)
            if code not in self._rooms:
                return code

    def get_room_stats(self) -> Dict:
        """Get statistics about all rooms."""
        total_rooms = len(self._rooms)
        total_users = sum(room.user_count for room in self._rooms.values())

        return {
            'total_rooms': total_rooms,
            'total_users': total_users,
            'rooms': {code: room.user_count for code, room in self._rooms.items()}
        }

    def cleanup_empty_rooms(self) -> int:
        """Clean up empty rooms. Returns number of rooms cleaned."""
        empty_rooms = [code for code, room in self._rooms.items() if room.is_empty]

        for room_code in empty_rooms:
            del self._rooms[room_code]
            logger.info(f" Cleaned up empty room {room_code}")

        return len(empty_rooms)

    def cleanup_stale_sessions(self, active_sids) -> int:
        """Remove users whose ``sid`` isn't in the live Socket.IO session
        set. Returns the number of user entries dropped.

        Sockets that vanish without a clean disconnect (network drops,
        mobile backgrounding, tab close mid-handshake) can leave ghost
        entries in the room's users map. A periodic sweep that consults
        ``AsyncServer.manager.get_participants(...)`` and invokes this
        method keeps the view honest.

        Orphaned rooms (empty after cleanup) are deleted in the same
        pass, so the caller doesn't need to follow up with
        ``cleanup_empty_rooms``.

        See docs/polishing/06-deployment-scaling.md bug "No cleanup job
        for orphaned sessions".
        """
        active = set(active_sids) if not isinstance(active_sids, set) else active_sids
        removed = 0

        for room_code in list(self._rooms.keys()):
            room = self._rooms[room_code]
            stale = [sid for sid in list(room.users.keys()) if sid not in active]
            for sid in stale:
                # Use the existing leave_room path so host-transfer and
                # session-dict cleanup stay in one place.
                self.leave_room(room_code, sid)
                removed += 1

        return removed
