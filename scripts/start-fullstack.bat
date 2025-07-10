@echo off
setlocal EnableDelayedExpansion

REM WatchWithMi Full-Stack Startup Script for Windows
echo 🎬 Starting WatchWithMi Full-Stack Application...

REM Function to kill processes on specific ports
call :kill_port 8000
call :kill_port 3000

REM Also kill by process pattern (backup method)
taskkill /F /IM "python.exe" /FI "COMMANDLINE eq *main.py*" >nul 2>&1
taskkill /F /IM "node.exe" /FI "COMMANDLINE eq *next*" >nul 2>&1

REM Wait a moment for processes to clean up
timeout /t 3 /nobreak >nul

REM Verify ports are free
netstat -ano | findstr ":8000" >nul 2>&1
if !errorlevel! equ 0 (
    echo ⚠️  Port 8000 still in use, force killing...
    call :kill_port 8000
    timeout /t 2 /nobreak >nul
)

netstat -ano | findstr ":3000" >nul 2>&1
if !errorlevel! equ 0 (
    echo ⚠️  Port 3000 still in use, force killing...
    call :kill_port 3000
    timeout /t 2 /nobreak >nul
)

REM Navigate to project root
cd /d "%~dp0\.."

REM Start the FastAPI backend
echo 🚀 Starting FastAPI backend on port 8000...
start "WatchWithMi Backend" cmd /c "python -m app.main"

REM Wait for backend to start
echo ⏳ Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

REM Start the React frontend
echo 🎨 Starting React frontend on port 3000...
cd frontend
start "WatchWithMi Frontend" cmd /c "npm run dev"

REM Wait for frontend to start
timeout /t 3 /nobreak >nul

echo ✅ Both services started successfully!
echo 📍 FastAPI Backend: http://localhost:8000
echo 📍 React Frontend: http://localhost:3000
echo 📍 API Docs: http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop both services (you may need to close the terminal windows manually)
echo.
pause

goto :cleanup

:kill_port
set port=%1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%port%"') do (
    if not "%%a"=="" (
        echo 🔪 Killing process on port %port%: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
goto :eof

:cleanup
echo.
echo 🛑 Shutting down services...
taskkill /F /IM "python.exe" /FI "COMMANDLINE eq *main.py*" >nul 2>&1
taskkill /F /IM "node.exe" /FI "COMMANDLINE eq *next*" >nul 2>&1
call :kill_port 8000
call :kill_port 3000
echo ✅ Cleanup complete
exit /b 0 