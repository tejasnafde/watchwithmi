"""
Room models and data structures for WatchWithMi.
"""

import logging
from datetime import datetime
from typing import Dict, Optional, List
from dataclasses import dataclass, asdict, field
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
    title: str = ""
    is_playlist: bool = False
    playlist_id: str = ""
    playlist_title: str = ""
    playlist_items: List[dict] = field(default_factory=list)
    current_index: int = 0
    
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
    can_control: bool = False  # Allows controlling media (DJ permissions)
    video_enabled: bool = False
    audio_enabled: bool = False
    
    def to_dict(self) -> dict:
        return asdict(self)

class Room:
    """Represents a room with all its data and operations."""
    
    def __init__(self, room_code: str):
        self.room_code = room_code
        self.host_id: Optional[str] = None
        self.users: Dict[str, User] = {}
        self.media = MediaState()
        self.chat: List[ChatMessage] = []
        self.created_at = datetime.now().isoformat()
        
        logger.info(f"Room {room_code} created")
    
    def add_user(self, user_id: str, user_name: str, is_host: bool = False) -> bool:
        """Add a user to the room."""
        try:
            user = User(
                name=user_name,
                joined_at=datetime.now().isoformat(),
                is_host=is_host,
                can_control=is_host  # Hosts ALWAYS have control
            )
            
            self.users[user_id] = user
            
            if is_host or self.host_id is None:
                self.host_id = user_id
                self.users[user_id].is_host = True
                self.users[user_id].can_control = True
            
            logger.info(f"User {user_name} ({user_id}) joined room {self.room_code} (host: {self.users[user_id].is_host})")
            return True
        except Exception as e:
            logger.error(f"Failed to add user {user_name} to room {self.room_code}: {e}")
            return False
    
    def remove_user(self, user_id: str) -> Optional[str]:
        """Remove a user from the room. Returns new host ID if host changed."""
        if user_id not in self.users:
            return None
        
        user_name = self.users[user_id].name
        was_host = self.users[user_id].is_host
        del self.users[user_id]
        
        logger.info(f"User {user_name} ({user_id}) left room {self.room_code}")
        
        # Handle host change
        if was_host and self.users:
            # Transfer host status to the next longest-joined user
            new_host_id = next(iter(self.users))
            self.host_id = new_host_id
            self.users[new_host_id].is_host = True
            self.users[new_host_id].can_control = True  # New host gets control
            logger.info(f"New host in room {self.room_code}: {self.users[new_host_id].name}")
            return new_host_id
        elif not self.users:
            logger.info(f"Room {self.room_code} is now empty")
            self.host_id = None  # Clear host when empty
            
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
        logger.debug(f"Message in room {self.room_code}: {self.users[user_id].name}: {message}")
        return chat_message

    def grant_control(self, user_id: str, enabled: bool) -> bool:
        """Grant or revoke control (DJ) permissions."""
        if user_id not in self.users:
            return False
            
        # Optional: Prevent revoking from host
        if self.users[user_id].is_host and not enabled:
            return False
            
        self.users[user_id].can_control = enabled
        logger.info(f"Control {'granted to' if enabled else 'revoked from'} {self.users[user_id].name} in {self.room_code}")
        return True
    
    def update_media(self, url: str = None, media_type: str = None,
                    state: str = None, timestamp: float = None,
                    title: str = None, is_playlist: bool = None,
                    playlist_id: str = None, playlist_title: str = None,
                    playlist_items: List[dict] = None, current_index: int = None) -> None:
        """Update media state."""
        if url is not None:
            self.media.url = url
            logger.info(f"Media changed in room {self.room_code}: {url}")
        
        if media_type is not None:
            self.media.type = media_type
            
        if state is not None:
            self.media.state = state
            logger.debug(f"Media state in room {self.room_code}: {state}")
            
        if timestamp is not None:
            self.media.timestamp = timestamp

        if title is not None:
            self.media.title = title

        if is_playlist is not None:
            self.media.is_playlist = is_playlist

        if playlist_id is not None:
            self.media.playlist_id = playlist_id

        if playlist_title is not None:
            self.media.playlist_title = playlist_title

        if playlist_items is not None:
            self.media.playlist_items = playlist_items

        if current_index is not None:
            self.media.current_index = current_index
            
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
