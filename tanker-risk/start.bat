@echo off
REM One-command launcher for Windows: installs deps on first run,
REM starts backend + frontend in separate windows, opens the dashboard.
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "LOG_DIR=%ROOT%\.logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_URL=http://127.0.0.1:%FRONTEND_PORT%"

REM ----- locate Python -----
set "PY_CMD="
where py  >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD (
  echo [ERROR] Python 3 not found. Install from https://www.python.org/downloads/ and retry.
  pause
  exit /b 1
)

REM ----- locate Bun -----
where bun >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Bun not found. Install from https://bun.sh/ and retry.
  pause
  exit /b 1
)

REM ----- backend setup -----
echo.
echo === Backend ===
if not exist "%BACKEND%\.venv" (
  echo  - creating Python venv
  %PY_CMD% -m venv "%BACKEND%\.venv"
  if errorlevel 1 goto :fail
)

set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "VENV_PIP=%BACKEND%\.venv\Scripts\pip.exe"

if not exist "%BACKEND%\.venv\.deps_ok" (
  echo  - installing backend dependencies ^(first run^)
  "%VENV_PY%" -m pip install --quiet --upgrade pip
  if errorlevel 1 goto :fail
  "%VENV_PIP%" install --quiet fastapi "uvicorn[standard]" pandas numpy scipy statsmodels openpyxl python-multipart pyarrow pytest httpx
  if errorlevel 1 goto :fail
  type nul > "%BACKEND%\.venv\.deps_ok"
)

REM ----- seed SQLite on first run -----
if not exist "%BACKEND%\data\vlcc.db" (
  echo  - seeding SQLite ^(ingest + calibrate VLCC/Suezmax^)
  pushd "%BACKEND%"
  set "PYTHONPATH=."
  "%VENV_PY%" scripts\seed_from_source.py
  set "SEED_RC=!ERRORLEVEL!"
  popd
  if not "!SEED_RC!"=="0" goto :fail
)

REM ----- frontend setup -----
echo.
echo === Frontend ===
if not exist "%FRONTEND%\node_modules" (
  echo  - installing frontend dependencies ^(first run, may take a minute^)
  pushd "%FRONTEND%"
  call bun install --silent
  set "BUN_RC=!ERRORLEVEL!"
  popd
  if not "!BUN_RC!"=="0" goto :fail
)

REM ----- start servers in new windows -----
echo.
echo === Starting servers ===
start "tanker-backend" cmd /k "cd /d "%BACKEND%" && "%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port %BACKEND_PORT% --log-level warning --reload --reload-dir app"
echo  - backend  -^> %BACKEND_URL%

start "tanker-frontend" cmd /k "cd /d "%FRONTEND%" && bun x vite --host 127.0.0.1 --port %FRONTEND_PORT%"
echo  - frontend -^> %FRONTEND_URL%

REM ----- wait for servers to come up (~15s max) -----
echo.
echo  - waiting for servers...
set "READY=0"
for /L %%i in (1,1,30) do (
  if "!READY!"=="0" (
    powershell -NoProfile -Command "try { $b=(Invoke-WebRequest -UseBasicParsing -Uri '%BACKEND_URL%/health' -TimeoutSec 1).StatusCode; $f=(Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%/' -TimeoutSec 1).StatusCode; if ($b -eq 200 -and $f -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 set "READY=1"
    if "!READY!"=="0" ping -n 2 127.0.0.1 >nul
  )
)

REM ----- open browser -----
start "" "%FRONTEND_URL%"

echo.
echo === Running ===
echo   Dashboard: %FRONTEND_URL%
echo   API:       %BACKEND_URL%/docs
echo   Logs:      %LOG_DIR%
echo.
echo Close the "tanker-backend" and "tanker-frontend" windows to stop the servers.
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Setup failed. See messages above.
pause
exit /b 1
