@echo off
setlocal EnableDelayedExpansion

echo ====================================================
echo WatchWithMi Windows Backend Diagnostic Tool
echo ====================================================
echo.

REM Set UTF-8 encoding
chcp 65001 >nul 2>&1

echo [1/10] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ CRITICAL: Python not found
    echo    Install Python 3.8+ from https://python.org/
    echo    Make sure to check "Add Python to PATH" during installation
    goto :end
) else (
    echo ✅ Python found: 
    python --version
)

echo.
echo [2/10] Checking current directory...
echo Current directory: %CD%
if not exist "app\main.py" (
    echo ❌ CRITICAL: Not in correct directory
    echo    You need to be in the WatchWithMi project root
    echo    The directory should contain: app\, frontend\, scripts\, requirements.txt
    goto :end
) else (
    echo ✅ Correct directory confirmed
)

echo.
echo [3/10] Checking virtual environment...
if not exist "watchwithmi-venv\Scripts\activate.bat" (
    echo ❌ CRITICAL: Virtual environment not found
    echo    Run: scripts\install-windows.bat to create it
    goto :end
) else (
    echo ✅ Virtual environment found
)

echo.
echo [4/10] Activating virtual environment...
call watchwithmi-venv\Scripts\activate.bat
if %errorlevel% neq 0 (
    echo ❌ CRITICAL: Failed to activate virtual environment
    echo    Try deleting watchwithmi-venv folder and running scripts\install-windows.bat
    goto :end
) else (
    echo ✅ Virtual environment activated
)

echo.
echo [5/10] Checking Python packages...
python -c "import fastapi; print('FastAPI version:', fastapi.__version__)" 2>nul
if %errorlevel% neq 0 (
    echo ❌ CRITICAL: FastAPI not installed
    echo    Run: pip install -r requirements.txt
    goto :end
) else (
    echo ✅ FastAPI installed
)

python -c "import uvicorn; print('Uvicorn available')" 2>nul
if %errorlevel% neq 0 (
    echo ❌ CRITICAL: Uvicorn not installed
    echo    Run: pip install -r requirements.txt
    goto :end
) else (
    echo ✅ Uvicorn available
)

echo.
echo [6/10] Checking libtorrent availability...
python -c "import libtorrent; print('Libtorrent version:', libtorrent.version)" 2>nul
if %errorlevel% neq 0 (
    echo ⚠️  WARNING: Libtorrent not available
    echo    This is OK - app will work without torrent features
    echo    To install: conda install -c conda-forge libtorrent
) else (
    echo ✅ Libtorrent available
)

echo.
echo [7/10] Checking port 8000 availability...
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  WARNING: Port 8000 is in use
    echo    Attempting to free port...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do (
        if not "%%a"=="" (
            echo    Killing process %%a
            taskkill /F /PID %%a >nul 2>&1
        )
    )
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr ":8000" >nul 2>&1
    if %errorlevel% equ 0 (
        echo ❌ CRITICAL: Port 8000 still in use after cleanup
        echo    Another application is using port 8000
        echo    Try restarting your computer or changing the port
        goto :end
    ) else (
        echo ✅ Port 8000 freed successfully
    )
) else (
    echo ✅ Port 8000 is available
)

echo.
echo [8/10] Testing app module import...
python -c "from app.main import app; print('App module imports successfully')" 2>nul
if %errorlevel% neq 0 (
    echo ❌ CRITICAL: App module import failed
    echo    Trying to diagnose the specific error...
    echo.
    echo Error details:
    python -c "from app.main import app"
    echo.
    echo    Check if all dependencies are installed: pip install -r requirements.txt
    goto :end
) else (
    echo ✅ App module imports successfully
)

echo.
echo [9/10] Testing minimal backend startup...
echo    Starting backend for 5 seconds to test...
set DEBUG=true
set WATCHFILES_LOG_LEVEL=WARNING
set UVICORN_LOG_LEVEL=INFO

timeout /t 1 /nobreak >nul
start /min "Test Backend" cmd /c "python -m app.main & timeout /t 5 /nobreak >nul & taskkill /F /IM python.exe /FI ""COMMANDLINE eq *main.py*"" >nul 2>&1"

echo    Waiting for startup test...
timeout /t 6 /nobreak >nul

echo    Checking if test was successful...
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend test successful - server responds to health check
) else (
    echo ⚠️  Backend test inconclusive - health check failed or server too slow
    echo    This might be normal if the server takes longer to start
)

echo.
echo [10/10] Firewall and network check...
echo    Testing if Windows Firewall might be blocking connections...
netsh advfirewall firewall show rule name="Python" >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  WARNING: No Python firewall rule found
    echo    Windows Firewall might block Python network access
    echo    When you start the backend, allow Python through the firewall if prompted
) else (
    echo ✅ Python firewall rule exists
)

echo.
echo ====================================================
echo DIAGNOSTIC COMPLETE
echo ====================================================
echo.

echo Summary:
echo --------
echo If all checks show ✅, the backend should start successfully.
echo If you see ❌ CRITICAL errors, fix those first.
echo If you see ⚠️  WARNING items, the app might still work but with limitations.
echo.
echo Next steps:
echo 1. Fix any CRITICAL errors shown above
echo 2. Run: scripts\start-fullstack.bat
echo 3. Check both terminal windows for errors
echo 4. Test: http://localhost:8000/health in your browser
echo.
echo Common fixes:
echo - Install Python 3.8+ with "Add to PATH" checked
echo - Run: scripts\install-windows.bat to set up environment
echo - Run: pip install -r requirements.txt to install dependencies
echo - Allow Python through Windows Firewall when prompted
echo.

:end
echo Press any key to close...
pause >nul 