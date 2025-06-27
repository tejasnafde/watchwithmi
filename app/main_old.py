from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import socketio
import asyncio
import random
import string
from typing import Dict, Set
from datetime import datetime
import json

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins="*",
    logger=True
)

# Create FastAPI app
app = FastAPI(title="WatchWithMi", description="Shared Media Viewing Platform")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Combine Socket.IO with FastAPI
socket_app = socketio.ASGIApp(sio, app)

# In-memory storage (replace with Redis in production)
rooms: Dict[str, Dict] = {}
user_sessions: Dict[str, Dict] = {}

def generate_room_code() -> str:
    """Generate a unique 6-character room code"""
    while True:
        code = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
        if code not in rooms:
            return code

class RoomManager:
    @staticmethod
    def create_room(host_name: str) -> str:
        """Create a new room and return the room code"""
        room_code = generate_room_code()
        rooms[room_code] = {
            'host': None,
            'users': {},
            'media': {
                'url': '',
                'type': 'youtube',  # youtube, video, audio
                'state': 'paused',
                'timestamp': 0,
                'last_update': datetime.now().isoformat()
            },
            'chat': [],
            'created_at': datetime.now().isoformat()
        }
        return room_code
    
    @staticmethod
    def join_room(room_code: str, user_id: str, user_name: str, is_host: bool = False) -> bool:
        """Add user to room"""
        if room_code not in rooms:
            return False
        
        room = rooms[room_code]
        room['users'][user_id] = {
            'name': user_name,
            'joined_at': datetime.now().isoformat(),
            'is_host': is_host
        }
        
        if is_host or room['host'] is None:
            room['host'] = user_id
            room['users'][user_id]['is_host'] = True
        
        return True
    
    @staticmethod
    def leave_room(room_code: str, user_id: str):
        """Remove user from room"""
        if room_code in rooms and user_id in rooms[room_code]['users']:
            room = rooms[room_code]
            was_host = room['users'][user_id].get('is_host', False)
            del room['users'][user_id]
            
            # If host left, assign new host
            if was_host and room['users']:
                new_host_id = next(iter(room['users']))
                room['host'] = new_host_id
                room['users'][new_host_id]['is_host'] = True
                return new_host_id
            elif not room['users']:
                # Delete empty room
                del rooms[room_code]
        return None
    
    @staticmethod
    def get_room(room_code: str) -> Dict:
        """Get room data"""
        return rooms.get(room_code)

# Socket.IO event handlers
@sio.event
async def connect(sid, environ):
    print(f"Client {sid} connected")
    user_sessions[sid] = {'room_code': None, 'user_name': None}

@sio.event
async def disconnect(sid):
    print(f"Client {sid} disconnected")
    if sid in user_sessions:
        session = user_sessions[sid]
        if session['room_code']:
            new_host = RoomManager.leave_room(session['room_code'], sid)
            # Notify room about user leaving
            await sio.emit('user_left', {
                'user_id': sid,
                'user_name': session['user_name'],
                'new_host': new_host
            }, room=session['room_code'])
            
            # Update user list for room
            room = RoomManager.get_room(session['room_code'])
            if room:
                await sio.emit('users_updated', {
                    'users': room['users'],
                    'host': room['host']
                }, room=session['room_code'])
        
        del user_sessions[sid]

@sio.event
async def join_room(sid, data):
    """Handle user joining a room"""
    room_code = data.get('room_code', '').strip().upper()
    user_name = data.get('user_name', '').strip()
    
    if not room_code or not user_name:
        await sio.emit('error', {'message': 'Room code and name are required'}, room=sid)
        return
    
    # Check if room exists
    room = RoomManager.get_room(room_code)
    if not room:
        await sio.emit('error', {'message': 'Room not found'}, room=sid)
        return
    
    # Join the room
    is_host = len(room['users']) == 0  # First user becomes host
    success = RoomManager.join_room(room_code, sid, user_name, is_host)
    
    if success:
        # Update session
        user_sessions[sid]['room_code'] = room_code
        user_sessions[sid]['user_name'] = user_name
        
        # Join Socket.IO room
        await sio.enter_room(sid, room_code)
        
        # Get updated room data
        updated_room = RoomManager.get_room(room_code)
        
        # Send success response to user
        await sio.emit('room_joined', {
            'room_code': room_code,
            'user_id': sid,
            'is_host': updated_room['users'][sid]['is_host'],
            'media': updated_room['media'],
            'users': updated_room['users'],
            'chat': updated_room['chat']
        }, room=sid)
        
        # Notify others in room
        await sio.emit('user_joined', {
            'user_id': sid,
            'user_name': user_name,
            'is_host': updated_room['users'][sid]['is_host']
        }, room=room_code, skip_sid=sid)
        
        # Update user list for everyone
        await sio.emit('users_updated', {
            'users': updated_room['users'],
            'host': updated_room['host']
        }, room=room_code)
    else:
        await sio.emit('error', {'message': 'Failed to join room'}, room=sid)

@sio.event
async def create_room(sid, data):
    """Handle room creation"""
    user_name = data.get('user_name', '').strip()
    
    if not user_name:
        await sio.emit('error', {'message': 'Name is required'}, room=sid)
        return
    
    # Create room
    room_code = RoomManager.create_room(user_name)
    
    # Join as host
    success = RoomManager.join_room(room_code, sid, user_name, True)
    
    if success:
        # Update session
        user_sessions[sid]['room_code'] = room_code
        user_sessions[sid]['user_name'] = user_name
        
        # Join Socket.IO room
        await sio.enter_room(sid, room_code)
        
        # Get room data
        room = RoomManager.get_room(room_code)
        
        # Send response
        await sio.emit('room_created', {
            'room_code': room_code,
            'user_id': sid,
            'is_host': True,
            'media': room['media'],
            'users': room['users'],
            'chat': room['chat']
        }, room=sid)
    else:
        await sio.emit('error', {'message': 'Failed to create room'}, room=sid)

@sio.event
async def send_message(sid, data):
    """Handle chat messages"""
    session = user_sessions.get(sid)
    if not session or not session['room_code']:
        await sio.emit('error', {'message': 'Not in a room'}, room=sid)
        return
    
    message = data.get('message', '').strip()
    if not message:
        return
    
    room_code = session['room_code']
    room = RoomManager.get_room(room_code)
    
    if room:
        chat_message = {
            'user_id': sid,
            'user_name': session['user_name'],
            'message': message,
            'timestamp': datetime.now().isoformat()
        }
        
        # Add to room chat history
        room['chat'].append(chat_message)
        
        # Broadcast to room
        await sio.emit('new_message', chat_message, room=room_code)

@sio.event
async def media_control(sid, data):
    """Handle media control events (play, pause, seek, change)"""
    session = user_sessions.get(sid)
    if not session or not session['room_code']:
        await sio.emit('error', {'message': 'Not in a room'}, room=sid)
        return
    
    room_code = session['room_code']
    room = RoomManager.get_room(room_code)
    
    if not room:
        await sio.emit('error', {'message': 'Room not found'}, room=sid)
        return
    
    action = data.get('action')
    is_host = room['users'][sid].get('is_host', False)
    
    # Check permissions for certain actions
    if action in ['change_media'] and not is_host:
        await sio.emit('error', {'message': 'Only host can change media'}, room=sid)
        return
    
    if action == 'play':
        room['media']['state'] = 'playing'
        room['media']['last_update'] = datetime.now().isoformat()
        await sio.emit('media_play', {
            'timestamp': room['media']['timestamp'],
            'user_name': session['user_name']
        }, room=room_code)
    
    elif action == 'pause':
        room['media']['state'] = 'paused'
        room['media']['timestamp'] = data.get('timestamp', room['media']['timestamp'])
        room['media']['last_update'] = datetime.now().isoformat()
        await sio.emit('media_pause', {
            'timestamp': room['media']['timestamp'],
            'user_name': session['user_name']
        }, room=room_code)
    
    elif action == 'seek':
        room['media']['timestamp'] = data.get('timestamp', 0)
        room['media']['last_update'] = datetime.now().isoformat()
        await sio.emit('media_seek', {
            'timestamp': room['media']['timestamp'],
            'user_name': session['user_name']
        }, room=room_code)
    
    elif action == 'change_media':
        media_url = data.get('url', '').strip()
        media_type = data.get('type', 'youtube')
        
        if media_url:
            room['media'].update({
                'url': media_url,
                'type': media_type,
                'state': 'paused',
                'timestamp': 0,
                'last_update': datetime.now().isoformat()
            })
            
            await sio.emit('media_changed', {
                'url': media_url,
                'type': media_type,
                'user_name': session['user_name']
            }, room=room_code)

# REST API endpoints
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main page"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/room/{room_code}", response_class=HTMLResponse)
async def room_page(request: Request, room_code: str):
    """Serve the room page"""
    room = RoomManager.get_room(room_code.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return templates.TemplateResponse("room.html", {
        "request": request,
        "room_code": room_code.upper()
    })

@app.get("/api/room/{room_code}")
async def get_room_info(room_code: str):
    """Get room information"""
    room = RoomManager.get_room(room_code.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return {
        "room_code": room_code.upper(),
        "user_count": len(room['users']),
        "has_media": bool(room['media']['url']),
        "created_at": room['created_at']
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True) 