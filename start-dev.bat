@echo off
setlocal

set "ROOT=%~dp0"

start "AlbumDeck Backend" cmd /k "cd /d "%ROOT%backend" && npm.cmd run dev"
start "AlbumDeck Frontend" cmd /k "cd /d "%ROOT%frontend" && npm.cmd run dev"

echo Backend en Frontend gestart.
echo Sluit deze launcher of laat hem open.
endlocal
