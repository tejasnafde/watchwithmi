# 🎬 WatchWithMe

A real-time shared media viewing platform that allows users to watch videos together in perfect synchronization. Built with FastAPI and Socket.IO for a modern, scalable backend architecture.

## ✨ Features

- **🔐 Room-Based Access**: Join rooms with 6-character codes
- **🎥 Media Synchronization**: Real-time play/pause/seek synchronization across all users
- **👑 Role-Based Permissions**: Host controls media, viewers can participate in chat
- **💬 Live Chat**: Real-time messaging within rooms
- **📺 Multiple Media Types**: Support for YouTube videos and direct video links
- **📱 Responsive Design**: Works on desktop and mobile devices
- **⚡ Real-Time Updates**: Instant user join/leave notifications and activity feed

## 🏗️ Architecture

### Backend (Python + FastAPI)
- **FastAPI**: Modern async web framework
- **Socket.IO**: Real-time bidirectional communication
- **Jinja2**: Server-side templating
- **In-Memory Storage**: Room and user session management (Redis-ready for production)

### Frontend (Minimal JS + Tailwind)
- **Vanilla JavaScript**: No heavy frameworks, focused on functionality
- **Tailwind CSS**: Utility-first styling for modern UI
- **YouTube API**: Embedded player integration
- **Native HTML5 Video**: Support for direct video links

### Key Design Patterns
- **Event-Driven Architecture**: Socket.IO events for real-time features
- **Room Management**: Isolated user sessions with automatic cleanup
- **State Synchronization**: Media state broadcast to all room participants
- **Permission System**: Host-based access control for media operations

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Application**
   ```bash
   cd app
   python main.py
   ```

3. **Open in Browser**
   ```
   http://localhost:8000
   ```

## 📖 How to Use

### Creating a Room
1. Enter your name on the home page
2. Click "Create New Room"
3. Share the generated room code with friends

### Joining a Room
1. Enter your name and the 6-character room code
2. Click "Join Room"
3. Start watching together!

### Media Controls (Host Only)
- **Load Media**: Paste YouTube URLs or direct video links
- **Play/Pause**: Control playback for all users
- **Synchronization**: All users automatically sync to host actions

### For Everyone
- **Chat**: Send messages visible to all room participants
- **Activity Feed**: See real-time updates of user actions
- **User List**: View who's currently in the room

## 🔧 API Endpoints

### WebSocket Events

**Client → Server:**
- `create_room` - Create a new room
- `join_room` - Join existing room
- `send_message` - Send chat message
- `media_control` - Control media playback (host only)

**Server → Client:**
- `room_created` - Room creation confirmation
- `room_joined` - Successful room join
- `user_joined/left` - User presence updates
- `new_message` - Chat message broadcast
- `media_play/pause/seek` - Media synchronization events

### REST API
- `GET /` - Home page
- `GET /room/{code}` - Room page
- `GET /api/room/{code}` - Room information

## 🛠️ Technical Highlights

### Real-Time Synchronization
```python
@sio.event
async def media_control(sid, data):
    """Handle media control with role-based permissions"""
    action = data.get('action')
    is_host = room['users'][sid].get('is_host', False)
    
    # Permission check
    if action in ['change_media'] and not is_host:
        await sio.emit('error', {'message': 'Only host can change media'})
        return
    
    # Broadcast to all room participants
    await sio.emit('media_play', {
        'timestamp': room['media']['timestamp']
    }, room=room_code)
```

### Auto Host Assignment
```python
def leave_room(room_code: str, user_id: str):
    """Handle host transfer when current host leaves"""
    if was_host and room['users']:
        new_host_id = next(iter(room['users']))
        room['host'] = new_host_id
        room['users'][new_host_id]['is_host'] = True
        return new_host_id
```

### YouTube Integration
```javascript
function loadYouTubeVideo(url) {
    const videoId = extractYouTubeVideoId(url);
    ytPlayer = new YT.Player('player', {
        videoId: videoId,
        events: {
            'onStateChange': handleStateChange
        }
    });
}
```

## 🔒 Legal & Safety

- **No Content Hosting**: Platform doesn't host any media files
- **User-Provided Links**: Users paste their own legal content URLs
- **YouTube Integration**: Uses official YouTube Embed API
- **No Torrenting**: Explicitly avoids P2P file sharing

## 🚀 Deployment

### Development
```bash
uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload
```

### Production Options
- **Uvicorn + Gunicorn**: For high-performance ASGI serving
- **Docker**: Containerized deployment
- **Cloud Platforms**: Vercel, Render, Fly.io, AWS
- **Redis**: Replace in-memory storage for persistence


## 🛣️ Roadmap

### Phase 1 (Current)
- ✅ Room creation and joining
- ✅ Media synchronization
- ✅ Live chat
- ✅ Role-based permissions

### Phase 2 (Planned)
- 🔄 WebRTC video chat integration
- 🔄 Redis persistence
- 🔄 User authentication
- 🔄 Room history and analytics

### Phase 3 (Future)
- 📋 Media search (YouTube/TMDb APIs)
- 📊 Advanced room management
- 🎨 Custom themes and branding
- 📱 Mobile app

## 🤝 Contributing

This is a portfolio project, but feedback and suggestions are welcome! Please open issues for bugs or feature requests.

## 📄 License

MIT License - See LICENSE file for details.

---

**Built with ❤️ for real-time collaboration and modern web architecture.** 