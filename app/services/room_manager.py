"""
Room management service for WatchWithMi.
"""

import logging
from typing import Dict, Optional
from ..models.room import Room, generate_room_code
from ..config import MAX_USERS_PER_ROOM, ROOM_CODE_LENGTH

logger = logging.getLogger("watchwithmi.services.room_manager")

class RoomManager:
    """Manages all room operations and state."""
    
    def __init__(self):
        self._rooms: Dict[str, Room] = {}
        self._user_sessions: Dict[str, Dict] = {}
        logger.info("🏢 RoomManager initialized")
    
    def create_room(self, host_name: str) -> str:
        """Create a new room and return the room code."""
        room_code = self._generate_unique_room_code()
        room = Room(room_code, host_name)
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
            logger.info(f"Removing duplicate session for {user_name}: {existing_user_id}")
            room.remove_user(existing_user_id)
            if existing_user_id in self._user_sessions:
                del self._user_sessions[existing_user_id]
        
        success = room.add_user(user_id, user_name, is_host)
        if success:
            self._user_sessions[user_id] = {
                'room_code': room_code,
                'user_name': user_name
            }
        
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
        
        # Check if user is host for certain operations
        if user_id not in room.users:
            return None
        
        room.update_media(**media_updates)
        return room_code
    
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