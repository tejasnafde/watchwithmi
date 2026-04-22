#!/usr/bin/env python3
"""
Test script to measure local Torrent-API-py response times
to determine optimal timeout values for reliable operation.
"""

import requests
import time
import statistics
from typing import List, Dict, Tuple

# Test queries of varying complexity
TEST_QUERIES = [
    # Simple/fast queries
    "test",
    "matrix",
    "batman",

    # Medium complexity
    "avengers endgame",
    "star wars",
    "john wick",

    # More complex queries
    "the lord of the rings fellowship",
    "mission impossible dead reckoning",
    "guardians of the galaxy vol 3",

    # Edge cases
    "xyz123nonexistent",
    "a",  # single character
    "very long movie title that probably doesnt exist in any database",
]

def test_service_availability() -> Tuple[bool, bool]:
    """Test if both services are available."""
    print("🔍 Testing service availability...\n")

    # Test WatchWithMi service (port 8000)
    watchwithmi_ok = False
    try:
        response = requests.get("http://localhost:8000", timeout=5)
        watchwithmi_ok = response.status_code in [200, 404]  # 404 is OK for root endpoint
        print(f" WatchWithMi (port 8000): {'Running' if watchwithmi_ok else 'Not responding'}")
    except Exception as e:
        print(f" WatchWithMi (port 8000): {e}")

    # Test Torrent-API-py service (port 8009)
    torrent_api_ok = False
    try:
        response = requests.get("http://localhost:8009/api/v1/all/search?query=test&limit=1", timeout=10)
        torrent_api_ok = response.status_code == 200
        print(f" Torrent-API-py (port 8009): {'Running' if torrent_api_ok else 'Not responding'}")
        if torrent_api_ok:
            data = response.json()
            print(f"   Sample response: {len(data.get('data', []))} results")
    except Exception as e:
        print(f" Torrent-API-py (port 8009): {e}")

    print()
    return watchwithmi_ok, torrent_api_ok

def time_local_api_request(query: str, limit: int = 5) -> Tuple[float, bool, int]:
    """
    Time a single request to the local Torrent-API-py.
    Returns: (response_time_seconds, success, result_count)
    """
    url = f"http://localhost:8009/api/v1/all/search?query={query}&limit={limit}"

    start_time = time.time()
    try:
        response = requests.get(url, timeout=30)  # High timeout for testing
        end_time = time.time()

        if response.status_code == 200:
            data = response.json()
            result_count = len(data.get('data', []))
            return (end_time - start_time, True, result_count)
        else:
            return (end_time - start_time, False, 0)
    except Exception as e:
        end_time = time.time()
        print(f"    Error: {e}")
        return (end_time - start_time, False, 0)

def run_timing_tests() -> Dict[str, List[float]]:
    """Run timing tests for all queries."""
    print("⏱  Running local API timing tests...\n")

    results = {}
    total_tests = len(TEST_QUERIES)

    for i, query in enumerate(TEST_QUERIES, 1):
        print(f"[{i:2d}/{total_tests}] Testing query: '{query}'")

        # Run 3 tests per query to get average
        times = []
        for attempt in range(3):
            response_time, success, result_count = time_local_api_request(query)
            times.append(response_time)

            status = "" if success else ""
            print(f"   Attempt {attempt + 1}: {response_time:.2f}s {status} ({result_count} results)")

            # Small delay between attempts
            time.sleep(0.5)

        results[query] = times
        avg_time = statistics.mean(times)
        print(f"    Average: {avg_time:.2f}s\n")

    return results

def analyze_results(results: Dict[str, List[float]]) -> None:
    """Analyze timing results and provide recommendations."""
    print(" TIMING ANALYSIS RESULTS\n")
    print("=" * 50)

    # Flatten all times
    all_times = []
    for times in results.values():
        all_times.extend(times)

    if not all_times:
        print(" No successful timing data collected!")
        return

    # Calculate statistics
    min_time = min(all_times)
    max_time = max(all_times)
    avg_time = statistics.mean(all_times)
    median_time = statistics.median(all_times)
    p95_time = sorted(all_times)[int(0.95 * len(all_times))]
    p99_time = sorted(all_times)[int(0.99 * len(all_times))]

    print("📈 Response Time Statistics:")
    print(f"   Minimum:    {min_time:.2f}s")
    print(f"   Maximum:    {max_time:.2f}s")
    print(f"   Average:    {avg_time:.2f}s")
    print(f"   Median:     {median_time:.2f}s")
    print(f"   95th %ile:  {p95_time:.2f}s")
    print(f"   99th %ile:  {p99_time:.2f}s")
    print()

    # Categorize queries by response time
    fast_queries = []
    medium_queries = []
    slow_queries = []

    for query, times in results.items():
        avg_query_time = statistics.mean(times)
        if avg_query_time < 3.0:
            fast_queries.append((query, avg_query_time))
        elif avg_query_time < 8.0:
            medium_queries.append((query, avg_query_time))
        else:
            slow_queries.append((query, avg_query_time))

    print("🏃 Fast Queries (< 3s):")
    for query, duration in sorted(fast_queries, key=lambda x: x[1]):
        print(f"   {duration:.2f}s - '{query}'")

    print("\n🚶 Medium Queries (3-8s):")
    for query, duration in sorted(medium_queries, key=lambda x: x[1]):
        print(f"   {duration:.2f}s - '{query}'")

    print("\n🐌 Slow Queries (> 8s):")
    for query, duration in sorted(slow_queries, key=lambda x: x[1]):
        print(f"   {duration:.2f}s - '{query}'")

    print("\n" + "=" * 50)
    print("🎯 TIMEOUT RECOMMENDATIONS:")
    print("=" * 50)

    # Provide timeout recommendations
    conservative_timeout = max(15.0, p95_time + 5.0)  # 95th percentile + buffer
    balanced_timeout = max(12.0, median_time + 7.0)   # Median + buffer
    aggressive_timeout = max(8.0, avg_time + 3.0)     # Average + small buffer

    print(f"🛡  Conservative (covers 95% of cases): {conservative_timeout:.0f}s")
    print(f"⚖  Balanced (covers ~75% of cases):     {balanced_timeout:.0f}s")
    print(f"⚡ Aggressive (covers ~60% of cases):   {aggressive_timeout:.0f}s")
    print()

    # Current timeout analysis
    current_timeout = 10.0
    success_rate = len([t for t in all_times if t <= current_timeout]) / len(all_times) * 100
    print(f" Current 10s timeout success rate: {success_rate:.1f}%")

    if success_rate < 80:
        print("  RECOMMENDATION: Increase timeout for better reliability")
        recommended = balanced_timeout
    elif success_rate > 95:
        print(" Current timeout is working well, could potentially reduce")
        recommended = aggressive_timeout
    else:
        print(" Current timeout is reasonable")
        recommended = current_timeout

    print(f"💡 Recommended timeout: {recommended:.0f}s")

def test_watchwithmi_integration():
    """Test the WatchWithMi search endpoint."""
    print("\n Testing WatchWithMi integration...\n")

    test_query = "matrix"
    url = "http://localhost:8000/api/search-torrents"
    payload = {"query": test_query}

    print(f"Testing search for '{test_query}' via WatchWithMi...")

    start_time = time.time()
    try:
        response = requests.post(url, json=payload, timeout=60)
        end_time = time.time()
        total_time = end_time - start_time

        if response.status_code == 200:
            data = response.json()
            result_count = len(data.get('results', []))
            print(" WatchWithMi search successful!")
            print(f"   Total time: {total_time:.2f}s")
            print(f"   Results: {result_count}")
            print(f"   Query: {data.get('query', 'N/A')}")

            if result_count > 0:
                sample = data['results'][0]
                print(f"   Sample result: {sample.get('title', 'N/A')[:50]}...")
        else:
            print(f" WatchWithMi search failed: HTTP {response.status_code}")
            print(f"   Response: {response.text[:200]}...")

    except Exception as e:
        end_time = time.time()
        total_time = end_time - start_time
        print(f" WatchWithMi search error: {e}")
        print(f"   Time before error: {total_time:.2f}s")

def main():
    """Main test function."""
    print("🧪 LOCAL API TIMING TEST SUITE")
    print("=" * 50)
    print()

    # Check service availability
    watchwithmi_ok, torrent_api_ok = test_service_availability()

    if not torrent_api_ok:
        print(" Torrent-API-py is not running. Please start it first.")
        return

    # Run timing tests
    results = run_timing_tests()

    # Analyze results
    analyze_results(results)

    # Test integration if WatchWithMi is available
    if watchwithmi_ok:
        test_watchwithmi_integration()
    else:
        print("\n  Skipping WatchWithMi integration test (service not available)")

    print("\n🏁 Testing complete!")

if __name__ == "__main__":
    main()
