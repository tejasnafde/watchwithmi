#!/usr/bin/env python3
"""
WatchWithMi Application Runner

Simple script to start the WatchWithMi server with proper configuration.
"""

import uvicorn
import sys
import os

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

if __name__ == "__main__":
    print("Starting WatchWithMi Server...")
    print("Server will be available at: http://localhost:8000")
    print("Press Ctrl+C to stop the server")
    print("-" * 50)
    
    try:
        uvicorn.run(
            "app.main:socket_app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info",
            access_log=True
        )
    except KeyboardInterrupt:
        print("\n👋 Server stopped. Thanks for using WatchWithMi!")
    except Exception as e:
        print(f" Error starting server: {e}")
        sys.exit(1) 