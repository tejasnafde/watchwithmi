# 🚀 Enhanced WatchWithMi Startup

Your `start.sh` script now launches **both services** automatically:

## 🎯 What It Does

1. **🔥 Starts Torrent-Api-py** (Port 8009) - Aggregates 16+ torrent sites
2. **🎬 Starts WatchWithMi** (Port 8000) - Your video streaming app  
3. **🔄 Handles cleanup** - Stops both services with Ctrl+C

## 🚀 Quick Start

```bash
# Start both services at once
./start.sh
```

## 📊 Service Status

```bash
# Test both services are running
python3 test_services.py
```

## 🔧 Manual Control

### Start Individual Services
```bash
# Torrent-Api-py only
cd ../Torrent-Api-py && python3 main.py

# WatchWithMi only  
python3 run.py
```

### Check Ports
```bash
# See what's running on each port
lsof -i :8000  # WatchWithMi
lsof -i :8009  # Torrent-Api-py
```

### Kill Services
```bash
# Kill specific ports
lsof -i :8000 | grep LISTEN | awk '{print $2}' | xargs kill
lsof -i :8009 | grep LISTEN | awk '{print $2}' | xargs kill
```

## 🎯 Benefits

✅ **One command startup** - `./start.sh` launches everything  
✅ **Enhanced torrent search** - 16+ sites via Torrent-Api-py + 13 direct sources  
✅ **Automatic cleanup** - Ctrl+C stops both services cleanly  
✅ **Error handling** - Graceful fallback if Torrent-Api-py unavailable  
✅ **Port management** - Automatically kills conflicting processes  

## 🔥 Torrent Search Sources

When running with both services:

### Via Torrent-Api-py (16 sites):
- 1337x, PirateBay, Nyaa.si, Torlock, Torrent Galaxy
- Zooqle, KickAss, Bitsearch, MagnetDL, Libgen
- YTS, LimeTorrent, TorrentFunk, Glodls, TorrentProject, YourBittorrent

### Direct Sources (13 sources):
- Jackett, BitSearch, Nyaa-CloudScraper, 1337x, TorrentGalaxy
- LimeTorrents, KickAss, Zooqle, BTDig, TorrentProject
- SolidTorrents, Torrentz2, YTS, TorrentAPI, Nyaa

## 🌐 URLs

- **WatchWithMi**: http://localhost:8000
- **Torrent-Api-py**: http://localhost:8009
- **Torrent-Api-py Docs**: http://localhost:8009/docs

## 🛠️ Troubleshooting

### Torrent-Api-py Not Starting
```bash
# Check if directory exists
ls -la ../Torrent-Api-py/

# Check logs
tail -f ../Torrent-Api-py/torrent_api.log
```

### Port Conflicts
```bash
# Find what's using the ports
lsof -i :8000
lsof -i :8009

# Kill and restart
./start.sh
```

### ISP Blocking Issues
- Torrent searches may timeout if ISP blocks torrent sites
- WatchWithMi will still work with available sources
- Consider VPN for full functionality

## 🎉 Ready for Production

This setup is perfect for your future Raspberry Pi deployment:
- All services start together
- Automatic error handling  
- Clean shutdown process
- Production-ready configuration 