#!/usr/bin/env python3
"""
Comprehensive test suite for WatchWithMi
Tests torrent search APIs, room functionality, and other components
"""

import asyncio
import logging
import sys
import os
import time
import json
from typing import List, Dict, Any

# Add app directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from services.torrent_search import TorrentSearchService, TorrentSearchResult
from services.room_manager import RoomManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('test_logs.txt')
    ]
)

logger = logging.getLogger("watchwithmi.tests")

class TorrentAPITester:
    """Test individual torrent API endpoints"""
    
    def __init__(self):
        self.service = TorrentSearchService()
        self.test_queries = [
            "Oppenheimer 2023",
            "The Matrix",
            "Avatar",
            "Inception",
            "Interstellar"
        ]
    
    async def test_all_apis(self, query: str = "Oppenheimer 2023"):
        """Test all individual API methods"""
        logger.info(f"🧪 Testing all APIs with query: '{query}'")
        
        # List of all API methods to test
        api_methods = [
            ("BTDig API", self.service._search_btdig_api),
            ("TorrentProject API", self.service._search_torrentproject_api),
            ("SolidTorrents API", self.service._search_solidtorrents_api),
            ("Torrentz2 API", self.service._search_torrentz2_api),
            ("YTS API", self.service._search_yts_api),
            ("TorrentAPI (RARBG)", self.service._search_torrentapi),
            ("Nyaa API", self.service._search_nyaa_api),
            ("1337x", self.service._search_1337x),
            ("TorrentGalaxy", self.service._search_torrentgalaxy),
            ("LimeTorrents", self.service._search_limetorrents),
            ("BitSearch", self.service._search_bitsearch),
            ("KickAss Torrents", self.service._search_kickass_torrents),
            ("Zooqle", self.service._search_zooqle),
            ("Local Torrent-API-py", self.service._search_local_torrent_api_py),
            ("Nyaa CloudScraper", self.service._search_nyaa_cloudscraper),
            ("Jackett", self.service._search_jackett),
        ]
        
        results = {}
        
        for api_name, api_method in api_methods:
            logger.info(f"\n{'='*50}")
            logger.info(f"🔍 Testing {api_name}")
            logger.info(f"{'='*50}")
            
            start_time = time.time()
            try:
                api_results = await api_method(query)
                end_time = time.time()
                
                if isinstance(api_results, list):
                    logger.info(f" {api_name}: {len(api_results)} results in {end_time-start_time:.2f}s")
                    
                    if api_results:
                        # Show first few results
                        for i, result in enumerate(api_results[:3]):
                            logger.info(f"   {i+1}. {result.title[:80]}...")
                            logger.info(f"      Seeds: {result.seeders}, Size: {result.size}")
                    else:
                        logger.warning(f"  {api_name}: Empty results list")
                    
                    results[api_name] = {
                        'status': 'success',
                        'count': len(api_results),
                        'time': end_time - start_time,
                        'results': [r.to_dict() for r in api_results[:2]]  # Store first 2 results
                    }
                else:
                    logger.error(f" {api_name}: Invalid response type: {type(api_results)}")
                    results[api_name] = {
                        'status': 'error',
                        'error': f"Invalid response type: {type(api_results)}",
                        'time': end_time - start_time
                    }
                    
            except Exception as e:
                end_time = time.time()
                logger.error(f" {api_name}: {type(e).__name__}: {e}")
                results[api_name] = {
                    'status': 'error',
                    'error': f"{type(e).__name__}: {str(e)}",
                    'time': end_time - start_time
                }
            
            # Small delay between tests
            await asyncio.sleep(0.5)
        
        # Summary
        logger.info(f"\n{'='*50}")
        logger.info(" TEST SUMMARY")
        logger.info(f"{'='*50}")
        
        total_results = 0
        working_apis = 0
        
        for api_name, result in results.items():
            if result['status'] == 'success':
                count = result['count']
                total_results += count
                if count > 0:
                    working_apis += 1
                    logger.info(f" {api_name}: {count} results ({result['time']:.2f}s)")
                else:
                    logger.info(f"  {api_name}: 0 results ({result['time']:.2f}s)")
            else:
                logger.error(f" {api_name}: {result['error']} ({result['time']:.2f}s)")
        
        logger.info(f"\n📈 STATS:")
        logger.info(f"   Working APIs: {working_apis}/{len(api_methods)}")
        logger.info(f"   Total results: {total_results}")
        
        return results
    
    async def test_network_connectivity(self):
        """Test basic network connectivity to torrent sites"""
        logger.info(" Testing network connectivity...")
        
        test_urls = [
            "https://btdig.com",
            "https://torrentproject.se",
            "https://solidtorrents.to",
            "https://torrentz2.nz",
            "https://yts.mx",
            "https://nyaa.si",
            "https://1337x.to",
            "https://torrentgalaxy.to",
            "https://www.limetorrents.lol",
            "https://bitsearch.to",
            "https://zooqle.com"
        ]
        
        import httpx
        
        results = {}
        
        async with httpx.AsyncClient(timeout=5.0, verify=False) as client:
            for url in test_urls:
                try:
                    start_time = time.time()
                    response = await client.get(url)
                    end_time = time.time()
                    
                    status = "" if response.status_code == 200 else f" ({response.status_code})"
                    logger.info(f"{status} {url}: {response.status_code} in {end_time-start_time:.2f}s")
                    
                    results[url] = {
                        'status_code': response.status_code,
                        'time': end_time - start_time,
                        'accessible': response.status_code == 200
                    }
                    
                except Exception as e:
                    logger.error(f" {url}: {type(e).__name__}: {e}")
                    results[url] = {
                        'error': f"{type(e).__name__}: {str(e)}",
                        'accessible': False
                    }
        
        accessible_count = sum(1 for r in results.values() if r.get('accessible', False))
        logger.info(f"\n Connectivity: {accessible_count}/{len(test_urls)} sites accessible")
        
        return results
    
    async def test_search_integration(self):
        """Test the full search integration"""
        logger.info("🔍 Testing full search integration...")
        
        for query in self.test_queries:
            logger.info(f"\n--- Testing: '{query}' ---")
            
            start_time = time.time()
            results = await self.service.search(query, max_results=5)
            end_time = time.time()
            
            logger.info(f" Found {len(results)} results in {end_time-start_time:.2f}s")
            
            for i, result in enumerate(results):
                logger.info(f"  {i+1}. {result.title[:60]}...")
                logger.info(f"     Seeds: {result.seeders}, Size: {result.size}")
                
                # Check if it's a placeholder
                if hasattr(result, 'is_placeholder') and result.is_placeholder:
                    logger.warning("       This is a placeholder result")
            
            await asyncio.sleep(1)  # Delay between queries

class RoomManagerTester:
    """Test room management functionality"""
    
    def __init__(self):
        self.room_manager = RoomManager()
    
    async def test_room_operations(self):
        """Test basic room operations"""
        logger.info(" Testing room operations...")
        
        # Create a room
        room_id = "test_room_123"
        user_id = "test_user_456"
        username = "TestUser"
        
        # Join room
        room = await self.room_manager.join_room(room_id, user_id, username)
        logger.info(f" Created/joined room: {room_id}")
        logger.info(f"   Users in room: {len(room.users)}")
        
        # Test room state
        state = room.get_state()
        logger.info(f"   Room state: {json.dumps(state, indent=2)}")
        
        # Leave room
        await self.room_manager.leave_room(room_id, user_id)
        logger.info(f" Left room: {room_id}")
        
        return True

class PerformanceTester:
    """Test performance characteristics"""
    
    def __init__(self):
        self.service = TorrentSearchService()
    
    async def test_search_performance(self):
        """Test search performance under various conditions"""
        logger.info("🚀 Testing search performance...")
        
        queries = ["Matrix", "Avatar", "Inception"]
        times = []
        
        for query in queries:
            start_time = time.time()
            results = await self.service.search(query, max_results=3)
            end_time = time.time()
            
            search_time = end_time - start_time
            times.append(search_time)
            
            logger.info(f"⏱  '{query}': {len(results)} results in {search_time:.2f}s")
        
        avg_time = sum(times) / len(times)
        logger.info(f" Average search time: {avg_time:.2f}s")
        
        return times

# Test runner functions
async def run_torrent_api_tests():
    """Run comprehensive torrent API tests"""
    tester = TorrentAPITester()
    
    logger.info("🧪 Starting Torrent API Tests")
    logger.info("="*60)
    
    # Test network connectivity first
    await tester.test_network_connectivity()
    
    # Test individual APIs
    await tester.test_all_apis()
    
    # Test search integration
    await tester.test_search_integration()

async def run_room_tests():
    """Run room management tests"""
    tester = RoomManagerTester()
    
    logger.info(" Starting Room Management Tests")
    logger.info("="*60)
    
    await tester.test_room_operations()

async def run_performance_tests():
    """Run performance tests"""
    tester = PerformanceTester()
    
    logger.info("🚀 Starting Performance Tests")
    logger.info("="*60)
    
    await tester.test_search_performance()

async def run_single_api_test(api_name: str, query: str = "Oppenheimer 2023"):
    """Test a single API for debugging"""
    logger.info(f"🔬 Testing single API: {api_name}")
    
    service = TorrentSearchService()
    
    # Map API names to methods
    api_map = {
        'btdig': service._search_btdig_api,
        'torrentproject': service._search_torrentproject_api,
        'solidtorrents': service._search_solidtorrents_api,
        'torrentz2': service._search_torrentz2_api,
        'yts': service._search_yts_api,
        'rarbg': service._search_torrentapi,
        'nyaa': service._search_nyaa_api,
        '1337x': service._search_1337x,
        'torrentgalaxy': service._search_torrentgalaxy,
        'limetorrents': service._search_limetorrents,
        'bitsearch': service._search_bitsearch,
        'kickass': service._search_kickass_torrents,
        'zooqle': service._search_zooqle,
        'local': service._search_local_torrent_api_py,
        'nyaa_scraper': service._search_nyaa_cloudscraper,
        'jackett': service._search_jackett,
    }
    
    if api_name.lower() not in api_map:
        logger.error(f" Unknown API: {api_name}")
        logger.info(f"Available APIs: {', '.join(api_map.keys())}")
        return
    
    api_method = api_map[api_name.lower()]
    
    try:
        logger.info(f"🔍 Searching '{query}' using {api_name}...")
        start_time = time.time()
        results = await api_method(query)
        end_time = time.time()
        
        logger.info(f" {api_name}: {len(results)} results in {end_time-start_time:.2f}s")
        
        for i, result in enumerate(results):
            logger.info(f"  {i+1}. {result.title}")
            logger.info(f"     Seeds: {result.seeders}, Size: {result.size}")
            logger.info(f"     Magnet: {result.magnet[:50]}...")
            
    except Exception as e:
        logger.error(f" {api_name} failed: {type(e).__name__}: {e}")
        import traceback
        logger.error(traceback.format_exc())

# Main test runner
if __name__ == "__main__":
    # Change this to run different tests
    test_mode = "single_api"  # Options: "torrent_api", "room", "performance", "single_api", "connectivity"
    
    if test_mode == "torrent_api":
        asyncio.run(run_torrent_api_tests())
    elif test_mode == "room":
        asyncio.run(run_room_tests())
    elif test_mode == "performance":
        asyncio.run(run_performance_tests())
    elif test_mode == "single_api":
        # Test specific API - change these values
        api_name = "bitsearch"  # Change to test different APIs (bitsearch is working!)
        query = "Matrix 1999"
        asyncio.run(run_single_api_test(api_name, query))
    elif test_mode == "connectivity":
        tester = TorrentAPITester()
        asyncio.run(tester.test_network_connectivity())
    else:
        print(" Unknown test mode. Available modes:")
        print("   - torrent_api: Test all torrent APIs")
        print("   - room: Test room management")
        print("   - performance: Test search performance")
        print("   - single_api: Test a specific API")
        print("   - connectivity: Test network connectivity") 