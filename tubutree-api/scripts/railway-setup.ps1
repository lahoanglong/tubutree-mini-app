# Tubu Tree API — Railway one-shot setup (PowerShell version cho Windows)
#
# Yêu cầu:
#   1. Đã cài Railway CLI: npm install -g @railway/cli
#   2. Đã đăng nhập Railway: railway login
#   3. Đã có Railway account (free tier $5 credit/tháng)
#
# Usage (PowerShell):
#   cd d:\tubutree_mini_app\mini_app\tubutree-api
#   .\scripts\railway-setup.ps1
#
# Script này sẽ:
#   - Tạo project "tubutree-api"
#   - Add Postgres + Redis addons
#   - Set tất cả env vars
#   - Deploy code
#   - In domain public

$ErrorActionPreference = "Stop"
$PROJECT_NAME = "tubutree-api"

# Go to script's parent directory (tubutree-api)
Set-Location (Split-Path -Parent $PSScriptRoot)

# Check Railway CLI
if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "X Railway CLI chua cai. Chay: npm install -g @railway/cli" -ForegroundColor Red
    exit 1
}

# Check login (PS-native: kiểm tra exit code thực sự của native exe)
$whoami = & railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "X Chua login Railway. Chay: railway login" -ForegroundColor Red
    Write-Host "Output: $whoami"
    exit 1
}

Write-Host "OK Logged in as: $whoami" -ForegroundColor Green
Write-Host ""

# Generate secrets — dùng .NET RNG vì PS không có openssl mặc định
function New-RandomBase64([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
}

$JWT_SECRET = New-RandomBase64 48
$WEBHOOK_SECRET = New-RandomBase64 32

Write-Host "Generated secrets (LU'U lai!):" -ForegroundColor Yellow
Write-Host "  JWT_SECRET     = $JWT_SECRET"
Write-Host "  WEBHOOK_SECRET = $WEBHOOK_SECRET"
Write-Host ""

$confirm = Read-Host "Tiep tuc tao project '$PROJECT_NAME'? (y/N)"
if ($confirm -ne "y") { exit 0 }

# Init project (idempotent — nếu đã có sẽ link)
Write-Host "-> Tao Railway project '$PROJECT_NAME'..." -ForegroundColor Cyan
& railway init --name $PROJECT_NAME
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: railway init failed (project co the da ton tai). Tiep tuc..." -ForegroundColor Yellow
}

# Add Postgres
Write-Host "-> Them Postgres addon..." -ForegroundColor Cyan
& railway add --database postgres

# Add Redis
Write-Host "-> Them Redis addon..." -ForegroundColor Cyan
& railway add --database redis

# Pick service context — sau khi add Postgres/Redis, context có thể trỏ về DB
# thay vì service code. Yêu cầu user pick API service.
Write-Host "-> Chon service '$PROJECT_NAME' (KHONG phai Postgres/Redis)..." -ForegroundColor Cyan
& railway service
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: railway service link failed. Tiep tuc nhung domain co the sai service." -ForegroundColor Yellow
}

# Set env vars — KHONG include empty value (Railway reject)
# ADMIN_ZALO_UIDS để placeholder, cập nhật qua dashboard sau khi user đầu login
Write-Host "-> Set env variables..." -ForegroundColor Cyan
& railway variables `
  --set "NODE_ENV=production" `
  --set "PORT=3001" `
  --set "JWT_SECRET=$JWT_SECRET" `
  --set "WEBHOOK_SECRET=$WEBHOOK_SECRET" `
  --set "ZALO_APP_ID=565779011239360460" `
  --set "ZALO_APP_SECRET=mQhjICzWAiFgEnQs6SuI" `
  --set "PANCAKE_SHOP_ID=20021276" `
  --set "PANCAKE_API_KEY=9ef74177bc164987a0e98932aeb71747" `
  --set "PANCAKE_WAREHOUSE_ID=83f98ee8-5e80-449b-be98-056f5777bc0c" `
  --set "VIETQR_BANK_ID=TCB" `
  --set "VIETQR_ACCOUNT_NO=9984606774" `
  --set "VIETQR_ACCOUNT_NAME=LA HOANG LONG" `
  --set "VIETQR_TEMPLATE=compact" `
  --set "UPLOAD_DIR=/app/uploads" `
  --set "MAX_UPLOAD_SIZE_MB=5" `
  --set "ADMIN_ZALO_UIDS=placeholder_update_after_first_login"

# Generate domain cho API service (current context)
Write-Host "-> Generate public domain..." -ForegroundColor Cyan
& railway domain

# Deploy code (sau khi env đã set + domain ready)
Write-Host "-> Deploy code..." -ForegroundColor Cyan
& railway up --detach

Write-Host ""
Write-Host "=== Setup done ===" -ForegroundColor Green
Write-Host "Buoc cuoi thu cong:"
Write-Host "  1. Vao Railway dashboard, mount volume /app/uploads (1GB) vao service"
Write-Host "  2. Sau khi user dau tien login, lay zalo_uid -> cap nhat ADMIN_ZALO_UIDS env"
Write-Host "  3. Cau hinh Pancake webhook URL: https://<domain>/api/webhook/pancake"
Write-Host "     Header: X-Webhook-Secret = $WEBHOOK_SECRET"
Write-Host "  4. Update VITE_API_URL trong tubutree-app/.env tro ve domain Railway"
