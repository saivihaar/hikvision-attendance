@echo off
title Hikvision Live Sync - keep this window open or minimized
echo Connecting to the device's live event stream...
echo New check-ins/check-outs push to the dashboard the instant they happen.
echo (On first run it may briefly drain a backlog of older events - that's normal.)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-terminal.ps1" -Action LiveStream
