@echo off
cd /d "%~dp0"
echo Starting THE CACHE on http://localhost:5173 ...
start "" "http://localhost:5173"
where py >nul 2>nul
if %errorlevel%==0 ( py server.py ) else ( python server.py )
echo.
echo THE CACHE has stopped. You can close this window.
pause
