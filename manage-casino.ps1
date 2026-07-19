# Argument parameters
param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "test", "stop")]
    [string]$Action
)

function Start-Casino {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "STARTING CYBER CASINO MONOREPO SERVICES" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    # 1. Start Docker Containers (Database + Cache)
    Write-Host "[1/5] Checking Docker and starting postgres/redis infrastructure..." -ForegroundColor Yellow
    docker-compose up -d redis postgres
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker Compose failed to start dependencies. Please check if Docker Desktop is running."
        exit 1
    }
    Write-Host "Database and Redis containers running." -ForegroundColor Green

    # 2. Bootstrapping monorepo workspaces
    Write-Host "[2/5] Installing package dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install failed."
        exit 1
    }
    Write-Host "Monorepo dependencies installed." -ForegroundColor Green

    # 3. Compile Shared Library package
    Write-Host "[3/5] Compiling Shared Library Module..." -ForegroundColor Yellow
    npm run build --workspace=@cyber-casino/shared
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Shared package compilation failed."
        exit 1
    }
    Write-Host "Shared package successfully compiled." -ForegroundColor Green

    # 4. Compile NestJS Microservices
    Write-Host "[4/5] Compiling NestJS Microservices..." -ForegroundColor Yellow
    npx nest build lottery-engine --config apps/lottery-engine/nest-cli.json --path apps/lottery-engine/tsconfig.json
    npx nest build loyalty-engine --config apps/loyalty-engine/nest-cli.json --path apps/loyalty-engine/tsconfig.json
    npx nest build payout-worker --config apps/payout-worker/nest-cli.json --path apps/payout-worker/tsconfig.json
    npx nest build backoffice-api --config apps/backoffice-api/nest-cli.json --path apps/backoffice-api/tsconfig.json
    if ($LASTEXITCODE -ne 0) {
        Write-Error "NestJS build pipeline failed."
        exit 1
    }
    Write-Host "Microservices compiled." -ForegroundColor Green

    # 5. Starting Backend Engines and Frontends concurrently
    Write-Host "[5/5] Launching all services in background..." -ForegroundColor Yellow
    
    # Start Lottery Engine, Nest API Gateway, Loyalty and Workers in a shared concurrent process
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run start:engine" -WindowStyle Normal
    
    # Start Client App
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run start:frontend" -WindowStyle Normal

    # Start Admin Panel
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run start:admin" -WindowStyle Normal

    Write-Host "All systems launched! Check the spawned powershell windows for logs." -ForegroundColor Green
    Write-Host "Player Front: http://localhost:5173" -ForegroundColor Green
    Write-Host "Admin Front: http://localhost:5174" -ForegroundColor Green
}

function Test-Casino {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "RUNNING HEALTH AND CONNECTIVITY TEST SUITE" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    # Test Local Docker ports
    $ports = @(5432, 6379, 5001, 5002, 8080)
    foreach ($port in $ports) {
        $connection = Test-NetConnection -ComputerName "127.0.0.1" -Port $port -WarningAction SilentlyContinue
        if ($connection.TcpTestSucceeded) {
            Write-Host "Port $port is ACTIVE and listening." -ForegroundColor Green
        } else {
            Write-Host "Port $port is DOWN or blocked." -ForegroundColor Red
        }
    }

    # Test REST API checks
    try {
        Write-Host "Checking Loyalty microservice REST response..." -ForegroundColor Yellow
        $loyaltyResponse = Invoke-RestMethod -Uri "http://127.0.0.1:5002/api/loyalty/status?email=demo@casino.com" -Method Get -TimeoutSec 5
        if ($loyaltyResponse.success) {
            Write-Host "Loyalty Engine microservice healthy." -ForegroundColor Green
        } else {
            Write-Host "Loyalty Engine returned failure status." -ForegroundColor Red
        }
    } catch {
        Write-Host "Loyalty microservice is unreachable: $_" -ForegroundColor Red
    }
}

function Stop-Casino {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "TEARING DOWN SERVICES" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    Write-Host "Stopping Docker containers..." -ForegroundColor Yellow
    docker-compose down
    
    Write-Host "Terminating background Node and Vite engine processes..." -ForegroundColor Yellow
    Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue

    Write-Host "Clean-up complete. All processes halted." -ForegroundColor Green
}

# Execution Entry point
switch ($Action) {
    "start" { Start-Casino }
    "test"  { Test-Casino }
    "stop"  { Stop-Casino }
}
