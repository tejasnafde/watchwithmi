# 🌉 WatchWithMi Torrent Bridge Setup

## Overview

The **Torrent Bridge** allows your WatchWithMi app to stream **any torrent** (including UDP tracker torrents) by downloading them server-side using **libtorrent** and streaming the video files to browsers via HTTP.

## 🏗️ Architecture

```
Browser → WatchWithMi → Torrent Bridge Server → Real Torrent Network
                                ↓
                        Downloads & Streams Video → Browser
```

**Benefits:**
- ✅ **Works with ALL torrents** (UDP, TCP, DHT)
- ✅ **Faster peer discovery** (real torrent client)
- ✅ **Better download speeds** (server-grade networking)
- ✅ **Progressive streaming** (start watching at 5% downloaded)
- ✅ **Automatic fallback** to WebTorrent if needed

## 📋 Installation

### 1. Install Dependencies

**For Ubuntu/Debian:**
```bash
# Install libtorrent system dependencies
sudo apt update
sudo apt install python3-libtorrent

# Or compile from source if needed
sudo apt install build-essential libssl-dev libboost-all-dev
```

**For macOS:**
```bash
# Install via Homebrew
brew install libtorrent-rasterbar

# Or via MacPorts
sudo port install libtorrent-rasterbar +python39
```

**For CentOS/RHEL:**
```bash
sudo yum install epel-release
sudo yum install python3-libtorrent
```

### 2. Install Python Dependencies

```bash
cd /path/to/watchwithmi
pip install libtorrent==2.0.9
```

### 3. Configure Firewall (Optional)

The bridge uses ports **6881-6891** for torrent connections:

```bash
# Ubuntu/Debian
sudo ufw allow 6881:6891/tcp
sudo ufw allow 6881:6891/udp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=6881-6891/tcp
sudo firewall-cmd --permanent --add-port=6881-6891/udp
sudo firewall-cmd --reload
```

## 🚀 Usage

### Automatic Detection

The app **automatically detects** when to use the bridge:

- **localhost/127.0.0.1**: Uses Torrent Bridge (server-side downloading)
- **Remote domains**: Falls back to WebTorrent (browser-only)

### Manual Testing

1. **Start the server:**
   ```bash
   python3 run.py
   ```

2. **Search for torrents** in the app
3. **Click "Stream"** on any torrent result
4. **Watch the enhanced UI:**
   - 🌉 "Server Bridge Loading" (instead of pirate flag)
   - Real-time download progress
   - Peer count and download speed
   - Starts streaming at 5% downloaded

### API Endpoints

The bridge exposes these REST endpoints:

- `POST /api/torrent/add` - Add torrent to server
- `GET /api/torrent/status/{id}` - Get download status  
- `GET /api/torrent/stream/{id}/{file_index}` - Stream video file
- `DELETE /api/torrent/remove/{id}` - Remove torrent
- `GET /api/torrent/list` - List active torrents

## 🔧 Configuration

### Environment Variables

```bash
# Optional: Custom temp directory
export WATCHWITHMI_TEMP_DIR="/path/to/torrents"

# Optional: Custom port range
export WATCHWITHMI_TORRENT_PORT_START=6881
export WATCHWITHMI_TORRENT_PORT_END=6891
```

### Advanced Settings

Edit `app/services/torrent_bridge.py`:

```python
# Increase concurrent downloads
settings['active_downloads'] = 10

# Increase memory cache
settings['cache_size'] = 512  # MB

# Faster peer discovery
settings['max_peerlist_size'] = 200
```

## 🛡️ Security Considerations

### Production Deployment

1. **Disable for public servers** (high bandwidth usage)
2. **Rate limit** the `/api/torrent/add` endpoint
3. **Monitor disk space** (auto-cleanup after 24 hours)
4. **Use authentication** for torrent endpoints

### Example Rate Limiting

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/add")
@limiter.limit("5/minute")  # Max 5 torrents per minute
async def add_torrent(request: Request, ...):
    # ... existing code
```

## 🚨 Troubleshooting

### Common Issues

**1. "ModuleNotFoundError: No module named 'libtorrent'"**
```bash
# Check Python version compatibility
python3 -c "import libtorrent; print(libtorrent.version)"

# Reinstall with specific version
pip install libtorrent-python==1.2.19  # For older systems
```

**2. "Permission denied" on ports 6881-6891**
```bash
# Run with higher ports if needed
export WATCHWITHMI_TORRENT_PORT_START=16881
export WATCHWITHMI_TORRENT_PORT_END=16891
```

**3. "No peers found" even with bridge**
- Check firewall settings
- Verify internet connectivity
- Try different torrent (some are actually dead)

**4. High memory usage**
```python
# Reduce cache size in torrent_bridge.py
settings['cache_size'] = 64  # Reduce from 512MB to 64MB
```

### Debug Mode

Enable detailed logging:

```python
# In app/services/torrent_bridge.py
logging.getLogger("watchwithmi.services.torrent_bridge").setLevel(logging.DEBUG)
```

## 📊 Performance

### Expected Performance

- **Metadata retrieval**: 5-15 seconds
- **Streaming start**: 30-60 seconds (at 5% download)
- **Peak speeds**: Limited by your server's bandwidth
- **Memory usage**: ~100MB per active torrent

### Optimization Tips

1. **SSD storage** for temp directory
2. **High bandwidth** server connection
3. **Open firewall** for torrent ports
4. **Regular cleanup** of old torrents

## 🎬 Feature Comparison

| Feature | WebTorrent (Browser) | Torrent Bridge (Server) |
|---------|---------------------|-------------------------|
| UDP Trackers | ❌ Not supported | ✅ Full support |
| DHT Discovery | ❌ Limited | ✅ Full support |
| Peer Count | 🔴 Low | 🟢 High |
| Download Speed | 🔴 Slow | 🟢 Fast |
| Setup Complexity | 🟢 None | 🟡 Moderate |
| Server Resources | 🟢 None | 🔴 High |

## 🎯 Next Steps

1. **Test with popular torrents** (high seeder count)
2. **Monitor server resources** during usage
3. **Set up automatic cleanup** for production
4. **Consider adding authentication** for public deployments
5. **Add bandwidth limiting** if needed

The torrent bridge transforms your WatchWithMi from a **WebTorrent-only** app to a **full-featured torrent streaming** platform! 🚀 