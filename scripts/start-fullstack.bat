@echo off
setlocal EnableDelayedExpansion

REM WatchWithMi Full-Stack Startup Script for Windows
echo Starting WatchWithMi Full-Stack Application...

REM Configure balanced logging for Windows - keep app logs visible but filter noise
set DEBUG=true
set WATCHFILES_LOG_LEVEL=WARNING
set UVICORN_LOG_LEVEL=INFO
chcp 65001 >nul 2>&1

echo Configured balanced logging for Windows (app logs visible, filtered noise)...

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

REM Check prerequisites before starting
echo Checking prerequisites...
if not exist "watchwithmi-venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found!
    echo Please run: scripts\install-windows.bat first
    echo.
    echo Press any key to close...
    pause > nul
    exit /b 1
)

echo Activating virtual environment...
call watchwithmi-venv\Scripts\activate.bat
if %errorlevel% neq 0 (
    echo ERROR: Failed to activate virtual environment
    echo Try deleting watchwithmi-venv and running scripts\install-windows.bat
    echo.
    echo Press any key to close...
    pause > nul
    exit /b 1
)

REM Quick dependency check
python -c "import fastapi" >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: FastAPI not found. Installing dependencies...
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        echo Please check your internet connection and Python installation
        echo.
        echo Press any key to close...
        pause > nul
        exit /b 1
    )
)

REM Start the FastAPI backend (cmd /k keeps window open on error)
echo Starting FastAPI backend on port 8000...
start "WatchWithMi Backend" cmd /k "python -m app.main || (echo. && echo ==================== BACKEND STARTUP FAILED ==================== && echo. && echo Common solutions: && echo    1. Run: scripts\diagnose-windows.bat (for detailed diagnosis) && echo    2. Check if Python is installed and in PATH && echo    3. Check if virtual environment exists: watchwithmi-venv\ && echo    4. Run: pip install -r requirements.txt && echo    5. Check if port 8000 is available && echo. && echo Libtorrent Issues: && echo    - Install Anaconda: https://www.anaconda.com/download && echo    - Run: conda install -c conda-forge libtorrent && echo    - Or download wheel: https://www.lfd.uci.edu/~gohlke/pythonlibs/ && echo    - App works without torrent features if libtorrent fails && echo. && echo For detailed troubleshooting: scripts\BACKEND_TROUBLESHOOTING.md && echo ================================================================= && echo. && echo Press any key to close... && pause > nul)"

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