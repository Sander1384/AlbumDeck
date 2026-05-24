@echo off
setlocal

set "ROOT=%~dp0"

start "AlbumDeck Backend" cmd /k "cd /d "%ROOT%backend" && npm.cmd run dev"
start "AlbumDeck Frontend" cmd /k "cd /d "%ROOT%frontend" && npm.cmd run dev"

echo Backend and frontend started.
echo You can close this launcher or leave it open.
endlocal
