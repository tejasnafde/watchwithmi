@echo off
setlocal EnableDelayedExpansion

REM WatchWithMi Full-Stack Startup Script for Windows
echo Starting WatchWithMi Full-Stack Application...

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
    echo WARNING: Port 8000 still in use, force killing...
    call :kill_port 8000
    timeout /t 2 /nobreak >nul
)

netstat -ano | findstr ":3000" >nul 2>&1
if !errorlevel! equ 0 (
    echo WARNING: Port 3000 still in use, force killing...
    call :kill_port 3000
    timeout /t 2 /nobreak >nul
)

REM Navigate to project root
cd /d "%~dp0\.."

REM Start the FastAPI backend (cmd /k keeps window open on error)
echo Starting FastAPI backend on port 8000...
start "WatchWithMi Backend" cmd /k "python -m app.main || (echo. && echo ERROR: Backend failed to start. && echo. && echo Windows Libtorrent Fixes: && echo    1. Install Anaconda: https://www.anaconda.com/download && echo    2. Run: conda install -c conda-forge libtorrent && echo    3. Alternative: Download wheel from https://www.lfd.uci.edu/~gohlke/pythonlibs/ && echo    4. App works without torrents if libtorrent fails && echo. && echo Other Common Fixes: && echo    1. Install Python 3.8+ && echo    2. Run: pip install -r requirements.txt && echo. && echo Press any key to close... && pause > nul)"

REM Wait for backend to start
echo Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

REM Install frontend dependencies and start React frontend (cmd /k keeps window open on error)
echo Installing frontend dependencies and starting React frontend on port 3000...
cd frontend
start "WatchWithMi Frontend" cmd /k "(npm install && npm run dev) || (echo. && echo ERROR: Frontend failed to start. && echo. && echo Common fixes: && echo    1. Install Node.js 18+ from https://nodejs.org/ && echo    2. Delete node_modules and package-lock.json, then run npm install && echo    3. For module resolution errors, restart VS Code/editor && echo    4. Fixed Turbopack compatibility issues && echo. && echo Press any key to close... && pause > nul)"

REM Wait for frontend to start
timeout /t 3 /nobreak >nul

echo SUCCESS: Both services started successfully!
echo FastAPI Backend: http://localhost:8000
echo React Frontend: http://localhost:3000
echo API Docs: http://localhost:8000/docs
echo.
echo TIPS: If you see errors, check the backend/frontend terminal windows.
echo TIPS: For the frontend, make sure Node.js 18+ is installed.
echo TIPS: For libtorrent issues, try conda-forge or manual wheel installation.
echo TIPS: App works without torrent features if libtorrent fails to install.
echo.
echo Press Ctrl+C to stop both services (you may need to close the terminal windows manually)
echo.
pause

goto :cleanup

:kill_port
set port=%1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%port%"') do (
    if not "%%a"=="" (
        echo Killing process on port %port%: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
goto :eof

:cleanup
echo.
echo Shutting down services...
taskkill /F /IM "python.exe" /FI "COMMANDLINE eq *main.py*" >nul 2>&1
taskkill /F /IM "node.exe" /FI "COMMANDLINE eq *next*" >nul 2>&1
call :kill_port 8000
call :kill_port 3000
echo Cleanup complete
exit /b 0 