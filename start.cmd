@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install it from https://www.python.org/downloads/ or the Microsoft Store, then run this again.
  pause
  exit /b 1
)
echo Starting the Clippy control server... keep this window open while streaming.
python server.py %*
pause
