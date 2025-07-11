@echo off
REM Windows Log Configuration for WatchWithMi
REM This script sets environment variables to reduce log noise

echo Configuring WatchWithMi for minimal logging on Windows...

REM Set Python logging to only show warnings and errors for noisy modules
set PYTHONPATH=%CD%
set WATCHFILES_LOG_LEVEL=WARNING
set UVICORN_LOG_LEVEL=WARNING

REM Disable debug mode to reduce overall log verbosity
set DEBUG=false

REM Set console encoding to UTF-8 for Windows
chcp 65001 >nul 2>&1

echo.
echo Configuration applied:
echo - DEBUG=false (reduced log verbosity)
echo - WATCHFILES_LOG_LEVEL=WARNING (no file change spam)
echo - UVICORN_LOG_LEVEL=WARNING (no HTTP request spam)
echo - Console encoding set to UTF-8
echo.
echo Now run: scripts\start-fullstack.bat
echo.
pause 