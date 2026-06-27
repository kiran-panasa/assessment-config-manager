# Assessment Config Manager — Local Publish Server
# Run this script from the server/ directory: .\start.ps1

$envFile = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host ""
    Write-Host "  .env file not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Create server\.env with the following content:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    FIREBASE_SERVICE_ACCOUNT={...paste service account JSON here...}" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Get it from: Firebase Console -> Project Settings -> Service Accounts -> Generate new private key" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  Installing dependencies..." -ForegroundColor Gray
npm install --silent

Write-Host "  Starting local server on http://localhost:3001" -ForegroundColor Green
Write-Host ""
node src/index.js
