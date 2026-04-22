# 🔥 Torrent-Api-py Integration Guide

## Quick Setup (Recommended)

### ✅ ALREADY DONE! 

The enhanced `start.sh` script now handles everything automatically:

```bash
# Start both WatchWithMi + Torrent-Api-py
./start.sh
```

This automatically:
- ✅ Starts Torrent-Api-py on `localhost:8009`  
- ✅ Starts WatchWithMi on `localhost:8000`
- ✅ Handles cleanup when you press Ctrl+C

### Manual Setup (if needed)

```bash
# Already cloned at /Users/tejas/Desktop/Torrent-Api-py
cd ../Torrent-Api-py
pip install -r requirements.txt
python main.py
```

### 2. Update Your WatchWithMi Code

Add this new method to `app/services/torrent_search.py`:

```python
async def _search_local_torrent_api_py(self, query: str) -> List[TorrentSearchResult]:
    """Search using local Torrent-Api-py instance."""
    results = []
    try:
        encoded_query = urllib.parse.quote_plus(query)
        # Use local instance instead of unreliable hosted one
        url = f"http://localhost:8009/api/v1/all/search?query={encoded_query}&limit=5"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                
                # Process results from all sites
                for site_name, site_results in data.items():
                    if isinstance(site_results, list):
                        for torrent in site_results[:3]:  # Limit per site
                            if isinstance(torrent, dict):
                                name = torrent.get('name', '')
                                magnet = torrent.get('magnet', '')
                                
                                if name and magnet:
                                    # Parse seeders/leechers
                                    seeders = int(str(torrent.get('seeders', 0)).replace(',', '') or 0)
                                    leechers = int(str(torrent.get('leechers', 0)).replace(',', '') or 0)
                                    
                                    results.append(TorrentSearchResult(
                                        title=f"[{site_name.upper()}] {name}",
                                        magnet=magnet,
                                        size=torrent.get('size', ''),
                                        seeders=seeders,
                                        leechers=leechers
                                    ))
                                    
    except Exception as e:
        logger.debug(f"Local Torrent-Api-py search failed: {e}")
        
    return results
```

### 3. Add to Search Tasks

```python
# In the search_torrents method, add:
self._search_local_torrent_api_py(clean_query),  # Local Torrent-Api-py
```

## 🎯 Benefits

✅ **16+ sites in one call** - massive results  
✅ **Reliable local hosting** - no timeouts  
✅ **Better metadata** - categories, file lists, posters  
✅ **Faster responses** - local network speed  

## 🐳 Docker Alternative

```bash
# Run Torrent-Api-py in Docker
docker run -p 8009:8009 ghcr.io/ryuk-me/torrent-api-py:latest
```

## 🔧 Production Deployment

For your Raspberry Pi setup:

```bash
# Install Torrent-Api-py as a service
sudo systemctl create torrent-api-py.service
# Configure to auto-start with your WatchWithMi app
```

This gives you access to **all major torrent sites** through a single, reliable API endpoint! 