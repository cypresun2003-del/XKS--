@echo off
setlocal
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:4317"

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%APP_URL%/api/health'; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Second Perspective is already running.
  echo Opening %APP_URL%
  start "" "%APP_URL%"
  goto end
)

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
echo Opening %APP_URL%
echo Second Perspective is running locally. Keep this window open. Press Ctrl+C to stop.
echo.
start "" "%APP_URL%"
call npm start
goto end

:failed
echo Startup failed. Please review the message above.
pause
:end
endlocal
