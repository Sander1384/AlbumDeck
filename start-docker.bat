@echo off
setlocal

cd /d "%~dp0"
echo.
echo Starting Navidrome CD Player with Docker...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Failed to start containers.
  pause
  exit /b 1
)

echo.
echo Done.
echo Open on this PC: http://localhost:8080
echo Open on tablet:  http://YOUR-PC-IP:8080
echo.
pause
