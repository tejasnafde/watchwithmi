"""
Socket.IO event handlers for WatchWithMi.
"""

import logging
from typing import Dict, Any
import socketio

logger = logging.getLogger("watchwithmi.handlers.socket_events")

class SocketEventHandler:
    """Handles all Socket.IO events."""
    
    def __init__(self, sio: socketio.AsyncServer, room_manager):
        self.sio = sio
        self.room_manager = room_manager
        self._register_events()
        logger.info("🔌 Socket event handlers registered")
    
    def _register_events(self):
        """Register all Socket.IO event handlers."""
        self.sio.on('connect')(self.handle_connect)
        self.sio.on('disconnect')(self.handle_disconnect)
        self.sio.on('create_room')(self.handle_create_room)
        self.sio.on('join_room')(self.handle_join_room)
        self.sio.on('send_message')(self.handle_send_message)
        self.sio.on('media_control')(self.handle_media_control)
    
    async def handle_connect(self, sid: str, environ: Dict):
        """Handle client connection."""
        logger.info(f"🔗 Client {sid} connected")
        self.room_manager.update_user_session(sid, {'room_code': None, 'user_name': None})
    
    async def handle_disconnect(self, sid: str):
        """Handle client disconnection."""
        logger.info(f"🔗 Client {sid} disconnected")
        
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
                    logger.info(f"🔄 User {user_name} has active session, cleaning up old session {sid}")
                    self.room_manager.leave_room(room_code, sid)
    
    async def handle_create_room(self, sid: str, data: Dict[str, Any]):
        """Handle room creation."""
        user_name = data.get('user_name', '').strip()
        
        if not user_name:
            await self.sio.emit('error', {'message': 'Name is required'}, room=sid)
            return
        
        try:
            # Create room
            room_code = self.room_manager.create_room(user_name)
            
            # Join as host
            success = self.room_manager.join_room(room_code, sid, user_name, True)
            
            if success:
                # Join Socket.IO room
                await self.sio.enter_room(sid, room_code)
                logger.debug(f"🏠 User {sid} entered Socket.IO room {room_code}")
                
                # Get room data
                room = self.room_manager.get_room(room_code)
                
                # Send response
                await self.sio.emit('room_created', {
                    'room_code': room_code,
                    'user_id': sid,
                    'is_host': True,
                    'media': room.media.to_dict(),
                    'users': {uid: user.to_dict() for uid, user in room.users.items()},
                    'chat': [msg.to_dict() for msg in room.chat]
                }, room=sid)
                
                logger.info(f"✅ Room {room_code} created successfully by {user_name}")
            else:
                await self.sio.emit('error', {'message': 'Failed to create room'}, room=sid)
                
        except Exception as e:
            logger.error(f"❌ Error creating room: {e}")
            await self.sio.emit('error', {'message': 'Server error occurred'}, room=sid)
    
    async def handle_join_room(self, sid: str, data: Dict[str, Any]):
        """Handle user joining a room."""
        room_code = data.get('room_code', '').strip().upper()
        user_name = data.get('user_name', '').strip()
        
        if not room_code or not user_name:
            await self.sio.emit('error', {'message': 'Room code and name are required'}, room=sid)
            return
        
        try:
            # Check if room exists
            room = self.room_manager.get_room(room_code)
            if not room:
                await self.sio.emit('error', {'message': 'Room not found'}, room=sid)
                return
            
            # Check if this user is already in the room (reconnection scenario)
            existing_user = None
            was_existing_host = False
            for existing_sid, user in room.users.items():
                if user.name == user_name:
                    existing_user = user
                    was_existing_host = user.is_host
                    break
            
            # Determine if user should be host
            # Case 1: Empty room - first user becomes host
            # Case 2: Reconnecting as previous host
            # Case 3: Room exists but no active host (all disconnected)
            is_host = (room.user_count == 0 or 
                      was_existing_host or 
                      room.host_id is None or 
                      room.host_id not in room.users)
            
            success = self.room_manager.join_room(room_code, sid, user_name, is_host)
            
            if success:
                # Log host assignment details
                if existing_user:
                    logger.info(f"🔄 User {user_name} reconnecting to room {room_code} (was_host: {was_existing_host}, now_host: {is_host})")
                else:
                    logger.info(f"🆕 New user {user_name} joining room {room_code} (is_host: {is_host})")
                # Join Socket.IO room
                await self.sio.enter_room(sid, room_code)
                logger.debug(f"🏠 User {sid} entered Socket.IO room {room_code}")
                
                # Get updated room data
                updated_room = self.room_manager.get_room(room_code)
                
                # Send success response to user
                await self.sio.emit('room_joined', {
                    'room_code': room_code,
                    'user_id': sid,
                    'is_host': updated_room.users[sid].is_host,
                    'media': updated_room.media.to_dict(),
                    'users': {uid: user.to_dict() for uid, user in updated_room.users.items()},
                    'chat': [msg.to_dict() for msg in updated_room.chat]
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
                    logger.info(f"🔄 User {user_name} reconnected to room {room_code}, not sending join notification")
                
                # Update user list for everyone
                await self.sio.emit('users_updated', {
                    'users': {uid: user.to_dict() for uid, user in updated_room.users.items()},
                    'host': updated_room.host_id
                }, room=room_code)
                
                logger.info(f"✅ User {user_name} joined room {room_code} (total users: {len(updated_room.users)})")
            else:
                await self.sio.emit('error', {'message': 'Failed to join room'}, room=sid)
                
        except Exception as e:
            logger.error(f"❌ Error joining room: {e}")
            await self.sio.emit('error', {'message': 'Server error occurred'}, room=sid)
    
    async def handle_send_message(self, sid: str, data: Dict[str, Any]):
        """Handle chat messages."""
        message = data.get('message', '').strip()
        if not message:
            return
        
        try:
            # Debug session and room info
            session = self.room_manager.get_user_session(sid)
            logger.debug(f"💬 Send message attempt - SID: {sid}, Session: {session}, Message: {message}")
            
            result = self.room_manager.send_message(sid, message)
            if result:
                room_code, chat_message = result
                logger.debug(f"💬 Broadcasting to room {room_code}: {chat_message.to_dict()}")
                
                # Broadcast to room
                await self.sio.emit('new_message', chat_message.to_dict(), room=room_code)
                logger.debug(f"💬 Message sent in room {room_code}: {chat_message.user_name}: {message}")
            else:
                logger.warning(f"💬 User {sid} not in a room when trying to send message")
                await self.sio.emit('error', {'message': 'Not in a room'}, room=sid)
                
        except Exception as e:
            logger.error(f"❌ Error sending message: {e}")
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
            
            is_host = self.room_manager.is_user_host(sid)
            
            # Check permissions for certain actions
            # Temporarily allow everyone to change media for testing
            # if action in ['change_media'] and not is_host:
            #     logger.warning(f"🚫 Non-host user {session.get('user_name')} ({sid}) tried to change media in room {room_code}. Host: {room.host_id}")
            #     await self.sio.emit('error', {'message': 'Only host can change media'}, room=sid)
            #     return
            
            user_name = session.get('user_name', 'Unknown')
            
            if action == 'play':
                self.room_manager.update_media(sid, state='playing')
                logger.info(f"▶️ Broadcasting media_play to room {room_code} (users: {list(room.users.keys())})")
                await self.sio.emit('media_play', {
                    'timestamp': room.media.timestamp,
                    'user_name': user_name
                }, room=room_code)
                
            elif action == 'pause':
                timestamp = data.get('timestamp', room.media.timestamp)
                self.room_manager.update_media(sid, state='paused', timestamp=timestamp)
                logger.info(f"⏸️ Broadcasting media_pause to room {room_code} (users: {list(room.users.keys())})")
                await self.sio.emit('media_pause', {
                    'timestamp': timestamp,
                    'user_name': user_name
                }, room=room_code)
                
            elif action == 'seek':
                timestamp = data.get('timestamp', 0)
                self.room_manager.update_media(sid, timestamp=timestamp)
                await self.sio.emit('media_seek', {
                    'timestamp': timestamp,
                    'user_name': user_name
                }, room=room_code)
                
            elif action == 'change_media':
                media_url = data.get('url', '').strip()
                media_type = data.get('type', 'youtube')
                media_title = data.get('title', '')
                
                if media_url:
                    self.room_manager.update_media(
                        sid, 
                        url=media_url, 
                        media_type=media_type, 
                        state='paused', 
                        timestamp=0
                    )
                    
                    await self.sio.emit('media_changed', {
                        'url': media_url,
                        'type': media_type,
                        'title': media_title,
                        'user_name': user_name
                    }, room=room_code)
                    
            elif action == 'start_loading':
                media_type = data.get('type', 'torrent')
                media_title = data.get('title', 'Loading media...')
                
                logger.info(f"⏳ Broadcasting media_loading to room {room_code} - {media_title}")
                await self.sio.emit('media_loading', {
                    'type': media_type,
                    'title': media_title,
                    'user_name': user_name
                }, room=room_code)
            
            elif action == 'torrent_progress':
                torrent_status = data.get('torrent_status')
                
                if torrent_status:
                    logger.debug(f"📊 Broadcasting torrent_progress to room {room_code}: {torrent_status.get('progress', 0) * 100:.1f}%")
                    await self.sio.emit('torrent_progress', {
                        'torrent_status': torrent_status,
                        'user_name': user_name
                    }, room=room_code)
            
            logger.debug(f"🎮 Media control in room {room_code}: {action} by {user_name}")
            
        except Exception as e:
            logger.error(f"❌ Error handling media control: {e}")
            await self.sio.emit('error', {'message': 'Media control failed'}, room=sid) 