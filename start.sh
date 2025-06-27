#!/bin/bash

echo "🎬 Starting WatchWithMi Server..."
echo "🔧 Setting up environment..."

# Function to kill processes on a specific port
kill_port() {
    local port=$1
    local service_name=$2
    echo "🔍 Checking for existing processes on port $port ($service_name)..."
    if lsof -i :$port >/dev/null 2>&1; then
        echo "⚠️  Found existing process on port $port. Terminating..."
        lsof -i :$port | grep LISTEN | awk '{print $2}' | xargs kill -9
    sleep 1  # Give the system a moment to release the port
        echo "✅ Port $port cleared"
fi
}

# Kill any existing processes
kill_port 8000 "WatchWithMi"
kill_port 8009 "Torrent-Api-py"

# Activate virtual environment
source watchwithmi-venv/bin/activate

# Remove any Python aliases that might interfere
unalias python 2>/dev/null || true

# Verify Python version and packages
echo "📍 Using Python: $(which python3)"
echo "📦 Python version: $(python3 --version)"

# Check if FastAPI is installed
if python3 -c "import fastapi" 2>/dev/null; then
    echo "✅ FastAPI is available"
else
    echo "❌ FastAPI not found - installing dependencies..."
    pip install -r requirements.txt
fi

# Start Torrent-Api-py service in the background
echo ""
echo "🔥 Starting Torrent-Api-py service..."
TORRENT_API_DIR="../Torrent-Api-py"

if [ -d "$TORRENT_API_DIR" ]; then
    echo "📍 Found Torrent-Api-py at: $TORRENT_API_DIR"
    
    # Start Torrent-Api-py in background
    cd "$TORRENT_API_DIR"
    echo "🚀 Starting Torrent-Api-py on http://localhost:8009"
    python3 main.py > torrent_api.log 2>&1 &
    TORRENT_API_PID=$!
    
    # Wait a moment for startup
    sleep 3
    
    # Check if it started successfully
    if ps -p $TORRENT_API_PID > /dev/null; then
        echo "✅ Torrent-Api-py started successfully (PID: $TORRENT_API_PID)"
    else
        echo "❌ Torrent-Api-py failed to start"
    fi
    
    # Return to WatchWithMi directory
    cd - > /dev/null
else
    echo "⚠️  Torrent-Api-py not found at $TORRENT_API_DIR"
    echo "   WatchWithMi will run without enhanced torrent search"
fi

echo ""
echo "🚀 Starting WatchWithMi server on http://localhost:8000"
echo "🔥 Torrent search powered by Local Torrent-Api-py + 13 other sources"
echo "🔄 Press Ctrl+C to stop both services"
echo "=================================================="

# Function to handle cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    
    # Kill Torrent-Api-py if it's running
    if [ ! -z "$TORRENT_API_PID" ] && ps -p $TORRENT_API_PID > /dev/null; then
        echo "🔥 Stopping Torrent-Api-py (PID: $TORRENT_API_PID)..."
        kill $TORRENT_API_PID
    fi
    
    # Kill any remaining processes on our ports
    kill_port 8009 "Torrent-Api-py"
    kill_port 8000 "WatchWithMi"
    
    echo "✅ Services stopped"
    exit 0
}

# Set up trap to handle Ctrl+C
trap cleanup SIGINT SIGTERM

# Start the WatchWithMi server
python3 run.py