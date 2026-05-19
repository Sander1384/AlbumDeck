@echo off
setlocal

set "ROOT=%~dp0"

start "SNDRCD Backend" cmd /k "cd /d "%ROOT%backend" && npm.cmd run dev"
start "SNDRCD Frontend" cmd /k "cd /d "%ROOT%frontend" && npm.cmd run dev"

echo Backend en Frontend gestart.
echo Sluit deze launcher of laat hem open.
endlocal
