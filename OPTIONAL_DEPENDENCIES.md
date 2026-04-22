# WatchWithMi - Optional Dependencies Guide

## Overview
The following warnings may appear during startup but are **optional** and don't affect core functionality:

```
Google API client not available - install with: pip install google-api-python-client
🚫 Libtorrent not available - media features disabled
Media bridge disabled - libtorrent not available
```

## 1. Google API Client (YouTube Search)

### What it does:
- Enables YouTube video search functionality
- Allows users to search for YouTube videos directly in the app

### How to install:
```bash
source watchwithmi-venv/bin/activate
pip install google-api-python-client
```

### Step-by-Step: Creating a YouTube API Key

#### 1. Go to Google Cloud Console
- Visit: https://console.cloud.google.com/
- Sign in with your Google account

#### 2. Create a New Project (or select existing)
- Click the project dropdown at the top
- Click "NEW PROJECT"
- Enter a project name (e.g., "WatchWithMi")
- Click "CREATE"

#### 3. Enable YouTube Data API v3
- In the left sidebar, go to **APIs & Services** → **Library**
- Search for "YouTube Data API v3"
- Click on it
- Click **ENABLE**

#### 4. Create API Credentials
- Go to **APIs & Services** → **Credentials**
- Click **+ CREATE CREDENTIALS** at the top
- Select **API key**
- Your API key will be created and displayed

#### 5. (Optional but Recommended) Restrict the API Key
- Click on the API key you just created
- Under "API restrictions":
  - Select "Restrict key"
  - Check "YouTube Data API v3"
- Under "Application restrictions" (optional):
  - You can restrict by IP address or HTTP referrer
- Click **SAVE**

#### 6. Add API Key to Your Application
Create a `.env` file in the project root:
```bash
# /Users/tejas/Desktop/projects/watchwithmi/.env
YOUTUBE_API_KEY=your_api_key_here
```

Or set it as an environment variable:
```bash
export YOUTUBE_API_KEY="your_api_key_here"
```

#### 7. Restart the Application
```bash
# Stop the current server (Ctrl+C)
./scripts/start-fullstack.sh
```

### API Quota Information:
- YouTube Data API v3 has a daily quota limit
- Default quota: 10,000 units per day
- Each search costs ~100 units
- This allows ~100 searches per day for free
- If you need more, you can request a quota increase

### Impact if not installed:
- YouTube search tab will be disabled
- Users can still load YouTube videos via direct URL
- P2P content search still works

---

## 2. Libtorrent (P2P Media Features)

### What it does:
- Enables advanced P2P media streaming via torrents
- Provides media bridge functionality for magnet links
- Allows streaming video files from torrent sources

### How to install:
```bash
source watchwithmi-venv/bin/activate
pip install libtorrent
```

**Note:** Libtorrent is already in your `requirements.txt`, so it should be installed. If you're seeing the warning, try:

```bash
source watchwithmi-venv/bin/activate
pip install --upgrade libtorrent
```

### Troubleshooting:
If `pip install libtorrent` fails, try platform-specific installation:

**macOS:**
```bash
brew install libtorrent-rasterbar
pip install libtorrent
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install python3-libtorrent
# or
pip install libtorrent
```

**Windows:**
```bash
conda install -c conda-forge libtorrent
# or download wheel from: https://www.lfd.uci.edu/~gohlke/pythonlibs/
```

### Impact if not installed:
- P2P content search still works (using web scraping)
- Direct media streaming from torrents will be disabled
- Users can still use YouTube and direct URL features

---

## Summary

**Core Features Working Without Optional Dependencies:**
✅ Room creation and joining
✅ Real-time chat
✅ Video synchronization
✅ WebRTC video chat
✅ P2P content search (web scraping)
✅ Direct URL loading (YouTube, media files)

**Features Requiring Optional Dependencies:**
⚠️ YouTube API search (requires google-api-python-client + API key)
⚠️ Torrent streaming (requires libtorrent)

**Recommendation:**
Start with the core features. Install optional dependencies as needed:
1. **For YouTube search**: Install google-api-python-client and set up API key
2. **For torrent streaming**: Ensure libtorrent is properly installed

Both features are optional and the app works great without them!
