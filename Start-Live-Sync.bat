@echo off
title Hikvision Live Sync - keep this window open or minimized
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-already-running.ps1"
if %ERRORLEVEL% EQU 1 (
    echo Live Sync is already running in another window - not starting a second copy.
    echo ^(The device only allows a couple of connections at once, so running two
    echo copies would break both. Close the other window first if you need to restart it.^)
    echo.
    echo Press any key to close this window...
    pause >nul
    exit /b
)

echo Connecting to the device's live event stream...
echo New check-ins/check-outs push to the dashboard the instant they happen.
echo ^(On first run it may briefly drain a backlog of older events - that's normal.^)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-terminal.ps1" -Action LiveStream

echo.
echo ============================================================
echo Live Sync stopped unexpectedly (see any error above).
echo Check sync-agent.log in this folder for details.
echo ============================================================
echo Press any key to close this window...
pause >nul
