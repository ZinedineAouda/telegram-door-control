# ==============================================================================
# start_local_tunnel.ps1 — 1-Click Launch of Bot + Free Cloudflare HTTPS Tunnel
# ==============================================================================

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path $EnvFile)) {
    Write-Host "[!] .env file not found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item (Join-Path $Root ".env.example") $EnvFile
    Write-Host "[!] Please open $EnvFile and set your BOT_TOKEN and ALLOWED_TELEGRAM_USER_IDS" -ForegroundColor Cyan
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "    Starting Telegram Door Control Bot + HTTPS Tunnel     " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

# Ensure cloudflared is in PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Start bot in background job
Write-Host "[1/2] Starting Door Bot on port 8443..." -ForegroundColor Cyan
$BotProcess = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory (Join-Path $Root "bot") -PassThru -NoNewWindow

Start-Sleep -Seconds 2

# Start cloudflared tunnel
Write-Host "[2/2] Launching free Cloudflare HTTPS Tunnel..." -ForegroundColor Cyan
Write-Host "[*] Look for the https://*.trycloudflare.com link below:" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------" -ForegroundColor Gray

try {
    cloudflared tunnel --url http://localhost:8443
} finally {
    if ($BotProcess -and -not $BotProcess.HasExited) {
        Write-Host "Stopping bot process..." -ForegroundColor Yellow
        Stop-Process -Id $BotProcess.Id -Force
    }
}
