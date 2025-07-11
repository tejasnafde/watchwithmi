@echo off
setlocal EnableDelayedExpansion

echo WatchWithMi Windows Installation Helper
echo ==========================================
echo.

REM Check Python version
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Please install Python 3.8+ from https://python.org/
    pause
    exit /b 1
)

echo SUCCESS: Python found
python --version

echo.
echo Installing dependencies...
echo.

REM Check if conda is available
conda --version >nul 2>&1
if %errorlevel% equ 0 (
    echo SUCCESS: Conda found - using conda-forge for libtorrent
    echo Installing libtorrent via conda...
    conda install -c conda-forge libtorrent -y
    if %errorlevel% equ 0 (
        echo SUCCESS: Libtorrent installed successfully via conda
    ) else (
        echo WARNING: Conda installation failed, falling back to pip
        goto :pip_install
    )
) else (
    echo WARNING: Conda not found - trying pip installation
    goto :pip_install
)

goto :install_other_deps

:pip_install
echo Attempting pip install...
pip install libtorrent==2.0.11
if %errorlevel% neq 0 (
    echo ERROR: Pip installation failed
    echo.
    echo MANUAL INSTALLATION OPTIONS:
    echo    1. Install Anaconda/Miniconda from https://www.anaconda.com/download
    echo    2. Then run: conda install -c conda-forge libtorrent
    echo    3. Or download wheel from: https://www.lfd.uci.edu/~gohlke/pythonlibs/
    echo.
    echo WARNING: App will work without torrent features if libtorrent fails
    echo.
)

:install_other_deps
echo.
echo Installing other Python dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install some dependencies
    echo Please check the error messages above
    pause
    exit /b 1
)

echo.
echo SUCCESS: Installation complete!
echo.
echo What's installed:
pip list | findstr -i "fastapi uvicorn libtorrent"
echo.
echo Next steps:
echo    1. Run scripts/start-fullstack.bat to start the application
echo    2. Open http://localhost:3000 in your browser
echo    3. If you see libtorrent errors, torrent features will be disabled
echo.
pause 