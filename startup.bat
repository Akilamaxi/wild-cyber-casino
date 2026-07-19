@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Error: Docker is not installed or is not on PATH. 1>&2
  exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo Error: Docker Compose v2 is not available. 1>&2
  exit /b 1
)

set "GENERATE_ENV="
if not exist ".env" set "GENERATE_ENV=1"
if exist ".env" (
  findstr /c:"replace-with-" /c:"GENERATE_ON_FIRST_START" ".env" >nul 2>&1
  if not errorlevel 1 set "GENERATE_ENV=1"
  for %%K in (JWT_SECRET POSTGRES_PASSWORD REDIS_PASSWORD CORS_ORIGINS ADMIN_CORS_ORIGINS) do (
    findstr /b /r /c:"%%K=..*" ".env" >nul 2>&1
    if errorlevel 1 set "GENERATE_ENV=1"
  )
)

if defined GENERATE_ENV (
  echo Generating unique local secrets in .env...
  powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\generate-env.ps1"
  if errorlevel 1 (
    echo Error: Could not generate .env. 1>&2
    exit /b 1
  )
  echo Created .env with unique local credentials. Do not commit this file.
)

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-local-bootstrap.ps1"
if errorlevel 1 (
  echo Error: Could not configure local administrator bootstrap. 1>&2
  exit /b 1
)

echo Validating configuration...
docker compose --env-file .env config --quiet
if errorlevel 1 exit /b 1

echo Building and starting all services...
docker compose --env-file .env up --build --detach --wait --wait-timeout 180
if errorlevel 1 goto startup_failed

echo.
echo Cyber Casino is ready.
echo Player application: http://localhost:8080/
echo Admin portal:      http://localhost:8080/admin/
echo Local admin email: admin@casino.com
echo Local admin password: see BOOTSTRAP_ADMIN_PASSWORD in .env
echo.
echo Use "docker compose --env-file .env logs -f" to follow logs.
echo Use "docker compose --env-file .env down" to stop the stack.
exit /b 0

:startup_failed
echo. 1>&2
echo Startup failed. Current service status: 1>&2
docker compose --env-file .env ps 1>&2
echo. 1>&2
echo Recent logs: 1>&2
docker compose --env-file .env logs --tail 100 1>&2
exit /b 1
