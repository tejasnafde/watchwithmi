#!/usr/bin/env python3
"""
Quick test script to verify both WatchWithMi and Torrent-Api-py services are running.
"""

import asyncio
import httpx
import sys

async def test_services():
    """Test both services to ensure they're running properly."""
    
    print("🧪 Testing WatchWithMi + Torrent-Api-py Services")
    print("=" * 50)
    
    services = [
        {
            "name": "WatchWithMi",
            "url": "http://localhost:8000",
            "port": 8000
        },
        {
            "name": "Torrent-Api-py", 
            "url": "http://localhost:8009/api/v1/sites",
            "port": 8009
        }
    ]
    
    all_good = True
    
    async with httpx.AsyncClient(timeout=5.0) as client:
        for service in services:
            try:
                print(f"🔍 Testing {service['name']} on port {service['port']}...")
                response = await client.get(service['url'])
                
                if response.status_code == 200:
                    print(f" {service['name']} is running correctly!")
                    
                    # Extra check for Torrent-Api-py
                    if service['name'] == 'Torrent-Api-py':
                        data = response.json()
                        if 'supported_sites' in data:
                            sites = data['supported_sites']
                            print(f"    Supporting {len(sites)} torrent sites: {', '.join(sites[:5])}...")
                        
                else:
                    print(f" {service['name']} returned status {response.status_code}")
                    all_good = False
                    
            except httpx.ConnectError:
                print(f" {service['name']} is not running (connection refused)")
                all_good = False
            except httpx.TimeoutException:
                print(f"  {service['name']} is slow to respond (timeout)")
                all_good = False
            except Exception as e:
                print(f" {service['name']} error: {e}")
                all_good = False
    
    print("\n" + "=" * 50)
    if all_good:
        print(" All services are running perfectly!")
        print("🔥 Your enhanced torrent search setup is ready!")
        return 0
    else:
        print("  Some services have issues. Check the logs above.")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(test_services())
    sys.exit(exit_code) 