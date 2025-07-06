#!/bin/bash

# WatchWithMi Full-Stack Startup Script
echo "🎬 Starting WatchWithMi Full-Stack Application..."

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
        echo "🔪 Killing processes on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Kill any existing processes on the ports
echo "🧹 Cleaning up existing processes..."
kill_port 8000  # FastAPI backend
kill_port 3000  # Next.js frontend

# Also kill by process pattern (backup method)
pkill -f "uvicorn.*main" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "python.*main.py" 2>/dev/null || true

# Wait a moment for processes to clean up
sleep 3

# Verify ports are free
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "⚠️  Port 8000 still in use, force killing..."
    kill_port 8000
    sleep 2
fi

if lsof -ti:3000 >/dev/null 2>&1; then
    echo "⚠️  Port 3000 still in use, force killing..."
    kill_port 3000
    sleep 2
fi

# Start the FastAPI backend
echo "🚀 Starting FastAPI backend on port 8000..."
cd "$(dirname "$0")/.."
python3 -m app.main &
BACKEND_PID=$!

# Wait for backend to start and verify it's running
echo "⏳ Waiting for backend to initialize..."
sleep 3

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend failed to start"
    exit 1
fi

# Wait a bit more for the server to be ready
sleep 2

# Start the React frontend
echo "🎨 Starting React frontend on port 3000..."
cd frontend
npm run dev &
FRONTEND_PID=$!

# Check if frontend started successfully
sleep 3
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Frontend failed to start"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo "✅ Both services started successfully!"
echo "📍 FastAPI Backend: http://localhost:8000"
echo "📍 React Frontend: http://localhost:3000"
echo "📍 API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both services"

# Function to cleanup both processes
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    kill_port 8000
    kill_port 3000
    pkill -f "uvicorn.*main" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "python.*main.py" 2>/dev/null || true
    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Wait for either process to exit
wait $BACKEND_PID $FRONTEND_PID