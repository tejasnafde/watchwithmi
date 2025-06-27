"""
Room models and data structures for WatchWithMi.
"""

import logging
from datetime import datetime
from typing import Dict, Optional, List
from dataclasses import dataclass, asdict
import random
import string

logger = logging.getLogger("watchwithmi.models.room")

@dataclass
class MediaState:
    """Represents the current media state in a room."""
    url: str = ""
    type: str = "youtube"  # youtube, video, audio
    state: str = "paused"  # playing, paused
    timestamp: float = 0.0
    last_update: str = ""
    
    def to_dict(self) -> dict:
        return asdict(self)

@dataclass
class ChatMessage:
    """Represents a chat message in a room."""
    user_id: str
    user_name: str
    message: str
    timestamp: str
    
    def to_dict(self) -> dict:
        return asdict(self)

@dataclass
class User:
    """Represents a user in a room."""
    name: str
    joined_at: str
    is_host: bool = False
    
    def to_dict(self) -> dict:
        return asdict(self)

class Room:
    """Represents a room with all its data and operations."""
    
    def __init__(self, room_code: str, host_name: str):
        self.room_code = room_code
        self.host_id: Optional[str] = None
        self.users: Dict[str, User] = {}
        self.media = MediaState()
        self.chat: List[ChatMessage] = []
        self.created_at = datetime.now().isoformat()
        
        logger.info(f"🏠 Room {room_code} created")
    
    def add_user(self, user_id: str, user_name: str, is_host: bool = False) -> bool:
        """Add a user to the room."""
        try:
            user = User(
                name=user_name,
                joined_at=datetime.now().isoformat(),
                is_host=is_host
            )
            
            self.users[user_id] = user
            
            if is_host or self.host_id is None:
                self.host_id = user_id
                self.users[user_id].is_host = True
            
            logger.info(f"👤 User {user_name} ({user_id}) joined room {self.room_code}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to add user {user_name} to room {self.room_code}: {e}")
            return False
    
    def remove_user(self, user_id: str) -> Optional[str]:
        """Remove a user from the room. Returns new host ID if host changed."""
        if user_id not in self.users:
            return None
        
        user_name = self.users[user_id].name
        was_host = self.users[user_id].is_host
        del self.users[user_id]
        
        logger.info(f"👤 User {user_name} ({user_id}) left room {self.room_code}")
        
        # Handle host change
        if was_host and self.users:
            new_host_id = next(iter(self.users))
            self.host_id = new_host_id
            self.users[new_host_id].is_host = True
            logger.info(f"👑 New host in room {self.room_code}: {self.users[new_host_id].name}")
            return new_host_id
        elif not self.users:
            logger.info(f"🏠 Room {self.room_code} is now empty")
            
        return None
    
    def add_message(self, user_id: str, message: str) -> Optional[ChatMessage]:
        """Add a chat message to the room."""
        if user_id not in self.users:
            return None
        
        chat_message = ChatMessage(
            user_id=user_id,
            user_name=self.users[user_id].name,
            message=message,
            timestamp=datetime.now().isoformat()
        )
        
        self.chat.append(chat_message)
        logger.debug(f"💬 Message in room {self.room_code}: {self.users[user_id].name}: {message}")
        return chat_message
    
    def update_media(self, url: str = None, media_type: str = None, 
                    state: str = None, timestamp: float = None) -> None:
        """Update media state."""
        if url is not None:
            self.media.url = url
            logger.info(f"🎬 Media changed in room {self.room_code}: {url}")
        
        if media_type is not None:
            self.media.type = media_type
            
        if state is not None:
            self.media.state = state
            logger.debug(f"▶️ Media state in room {self.room_code}: {state}")
            
        if timestamp is not None:
            self.media.timestamp = timestamp
            
        self.media.last_update = datetime.now().isoformat()
    
    def to_dict(self) -> dict:
        """Convert room to dictionary for JSON serialization."""
        return {
            'room_code': self.room_code,
            'host': self.host_id,
            'users': {uid: user.to_dict() for uid, user in self.users.items()},
            'media': self.media.to_dict(),
            'chat': [msg.to_dict() for msg in self.chat],
            'created_at': self.created_at
        }
    
    @property
    def user_count(self) -> int:
        """Get the number of users in the room."""
        return len(self.users)
    
    @property
    def is_empty(self) -> bool:
        """Check if the room is empty."""
        return len(self.users) == 0

def generate_room_code(length: int = 6) -> str:
    """Generate a unique room code."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length)) 