@echo off
setlocal
set "APP=%~dp0index.html"
if not exist "%APP%" (
  echo ERROR: index.html not found next to start.cmd
  pause
  exit /b 1
)
start "" "%APP%"
exit /b 0
