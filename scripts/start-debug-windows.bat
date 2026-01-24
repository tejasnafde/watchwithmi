@echo off
setlocal EnableDelayedExpansion

REM WatchWithMi Debug Mode Startup Script for Windows
echo Starting WatchWithMi in DEBUG MODE for troubleshooting...
echo.

REM Enable full debug logging (maximum visibility)
set DEBUG=true
set WATCHFILES_LOG_LEVEL=INFO
set UVICORN_LOG_LEVEL=INFO
chcp 65001 >nul 2>&1

echo ===============================================
echo DEBUG MODE ENABLED - Full Logging Visibility
echo ===============================================
echo - DEBUG=true (detailed app logs)
echo - WATCHFILES_LOG_LEVEL=INFO (file change logs visible)
echo - UVICORN_LOG_LEVEL=INFO (HTTP request logs visible)
echo - Console encoding: UTF-8
echo.
echo This will show ALL logs including file changes and HTTP requests.
echo Use this mode only for debugging - logs will be verbose!
echo.
echo Press any key to continue or Ctrl+C to cancel...
pause >nul

REM Function to kill processes on specific ports
call :kill_port 8000
call :kill_port 3000

REM Also kill by process pattern (backup method)
taskkill /F /IM "python.exe" /FI "COMMANDLINE eq *main.py*" >nul 2>&1
taskkill /F /IM "node.exe" /FI "COMMANDLINE eq *next*" >nul 2>&1

REM Wait a moment for processes to clean up
timeout /t 3 /nobreak >nul

echo.
echo Starting backend in DEBUG mode...
cd /d "%~dp0.."

REM Check if virtual environment exists
if not exist "watchwithmi-venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found at watchwithmi-venv/
    echo Please run scripts\install-windows.bat first
    pause
    exit /b 1
)

REM Activate virtual environment and start backend
call watchwithmi-venv\Scripts\activate.bat
python -m app.main &

REM Wait for backend to start
echo Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

REM Start frontend
echo.
echo Starting frontend in DEBUG mode...
cd frontend
start "Frontend Debug" cmd /k "npm run dev"

echo.
echo ===============================================
echo Services started in DEBUG MODE:
echo - Backend: http://localhost:8000 (with full logs)
echo - Frontend: http://localhost:3000 (separate window)
echo - Logs: logs\watchwithmi.log (verbose)
echo ===============================================
echo.
echo Press Ctrl+C to stop the backend when done debugging
echo Frontend runs in separate window - close it manually
echo.

REM Keep this window open to show backend logs
echo Backend logs will appear below:
echo.
wait

goto :eof

:kill_port
set port=%1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%port% "') do (
    taskkill /F /PID %%a >nul 2>&1
)
goto :eof 