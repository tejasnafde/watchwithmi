# 🆓 Free Jackett Setup for WatchWithMi

## What is Jackett?
Jackett is a **completely free** self-hosted torrent indexer that acts as a proxy between your app and multiple torrent sites. It bypasses Cloudflare blocks and gives you access to dozens of torrent sources.

## Quick Setup (5 minutes)

### Option 1: Docker (Easiest)
```bash
# Run Jackett in Docker
docker run -d \
  --name=jackett \
  -e PUID=1000 \
  -e PGID=1000 \
  -p 9117:9117 \
  -v ./jackett-config:/config \
  linuxserver/jackett

# Jackett will be available at: http://localhost:9117
```

### Option 2: Direct Install
1. Download from: https://github.com/Jackett/Jackett/releases
2. Extract and run `./jackett` (Linux/Mac) or `Jackett.exe` (Windows)
3. Open http://localhost:9117

## Configuration

1. **Open Jackett**: Go to http://localhost:9117
2. **Add Indexers**: Click "Add indexer" and add:
   - 1337x
   - RARBG
   - The Pirate Bay
   - Nyaa
   - TorrentGalaxy
   - Any others you want
3. **Get API Key**: Copy the API key from the top of the dashboard
4. **Set Environment Variable**:
   ```bash
   export JACKETT_API_KEY="your_api_key_here"
   ```

## Integration with WatchWithMi

Once Jackett is running:

1. **Set the API key**:
   ```bash
   # In your terminal before running the app
   export JACKETT_API_KEY="abc123def456"
   python3 run.py
   ```

2. **Jackett will automatically be used** - you'll see logs like:
   ```
   📊 Jackett: 15 results
   📊 BitSearch: 3 results
   📊 1337x: 2 results
   ✅ Found 20 unique torrents (from 20 total)
   ```

## Benefits
- ✅ **Completely free**
- ✅ **Bypasses ISP/network blocks**
- ✅ **Access to 40+ torrent sites**
- ✅ **Self-hosted = your control**
- ✅ **Works with any app via API**

## Troubleshooting

**Jackett not found?**
- Make sure it's running on port 9117
- Check `docker ps` to see if container is running
- Try `curl http://localhost:9117` to test

**No results?**
- Make sure you added indexers in the Jackett web UI
- Check indexer status (some may need configuration)
- Verify API key is correct

**Still getting blocked?**
- Some indexers in Jackett may still be blocked by your ISP
- Add more indexers as backups
- Consider running Jackett through a VPN 