@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or later.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:4317 in your browser.
echo Second Perspective is running locally. Keep this window open. Press Ctrl+C to stop.
echo.
call npm start
goto end
:failed
echo Startup failed. Please review the message above.
pause
:end
endlocal
