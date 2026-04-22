#!/usr/bin/env python3
"""
Test the actual torrent search service
"""

import asyncio
import sys
import os

# Add app directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

# Import without relative imports by setting up the path properly
import logging
logging.basicConfig(level=logging.INFO)

# Simple test to avoid import issues
async def test_basic_search():
    """Test the basic search functionality"""
    try:
        # Import here to avoid module issues
        from app.services.torrent_search import TorrentSearchService
        
        service = TorrentSearchService()
        
        # Test with a simple query
        query = "Matrix 1999"
        print(f"🔍 Testing search for: '{query}'")
        
        results = await service.search(query, max_results=5)
        
        print(f" Found {len(results)} results")
        
        for i, result in enumerate(results):
            print(f"\n{i+1}. {result.title}")
            print(f"   Seeds: {result.seeders}, Size: {result.size}")
            
            # Check if it's a placeholder
            if hasattr(result, 'is_placeholder') and result.is_placeholder:
                print("     This is a placeholder result")
            else:
                print(f"   Magnet: {result.magnet[:50]}...")
        
        return len(results)
        
    except ImportError as e:
        print(f" Import error: {e}")
        print("This might be due to relative import issues")
        return 0
    except Exception as e:
        print(f" Search failed: {e}")
        import traceback
        traceback.print_exc()
        return 0

if __name__ == "__main__":
    # Change the working directory to the app directory
    os.chdir('/Users/tejas/Desktop/watchwithmi')
    
    # Set PYTHONPATH 
    sys.path.insert(0, '/Users/tejas/Desktop/watchwithmi')
    
    result_count = asyncio.run(test_basic_search())
    print(f"\n Final result: {result_count} torrents found") 