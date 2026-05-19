#!/usr/bin/env bash
# Tubu Tree API — Railway one-shot setup
#
# Yêu cầu:
#   1. Đã cài Railway CLI: npm install -g @railway/cli
#   2. Đã đăng nhập Railway: railway login (browser flow, lần đầu)
#   3. Đã có Railway account (free tier $5 credit/tháng)
#
# Usage (từ trong thư mục mini_app/tubutree-api):
#   bash scripts/railway-setup.sh
#
# Script này sẽ:
#   - Tạo project "tubutree-api" (nếu chưa có)
#   - Add Postgres + Redis addons
#   - Set tất cả env vars
#   - Deploy code
#   - In domain public

set -e

PROJECT_NAME="tubutree-api"

cd "$(dirname "$0")/.."

# Check pre-requisites
if ! command -v railway >/dev/null 2>&1; then
  echo "❌ Railway CLI chưa cài. Chạy: npm install -g @railway/cli"
  exit 1
fi

if ! railway whoami >/dev/null 2>&1; then
  echo "❌ Chưa login Railway. Chạy: railway login"
  exit 1
fi

echo "✓ Railway CLI v$(railway --version | awk '{print $2}')"
echo "✓ Logged in as: $(railway whoami)"
echo ""

# Generate secrets
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n' | head -c 64)
WEBHOOK_SECRET=$(openssl rand -base64 32 | tr -d '\n' | head -c 43)

echo "Generated secrets:"
echo "  JWT_SECRET     = $JWT_SECRET"
echo "  WEBHOOK_SECRET = $WEBHOOK_SECRET"
echo ""
read -p "Tiếp tục tạo project? (y/N) " confirm
[ "$confirm" != "y" ] && exit 0

# Init project
echo "→ Tạo Railway project '$PROJECT_NAME'…"
railway init --name "$PROJECT_NAME" || true

# Add Postgres
echo "→ Thêm Postgres addon…"
railway add --database postgres || true

# Add Redis
echo "→ Thêm Redis addon…"
railway add --database redis || true

# Set env vars
echo "→ Set env variables…"
railway variables \
  --set "NODE_ENV=production" \
  --set "PORT=3001" \
  --set "JWT_SECRET=$JWT_SECRET" \
  --set "WEBHOOK_SECRET=$WEBHOOK_SECRET" \
  --set "ZALO_APP_ID=565779011239360460" \
  --set "ZALO_APP_SECRET=mQhjICzWAiFgEnQs6SuI" \
  --set "PANCAKE_SHOP_ID=20021276" \
  --set "PANCAKE_API_KEY=9ef74177bc164987a0e98932aeb71747" \
  --set "PANCAKE_WAREHOUSE_ID=83f98ee8-5e80-449b-be98-056f5777bc0c" \
  --set "VIETQR_BANK_ID=TCB" \
  --set "VIETQR_ACCOUNT_NO=9984606774" \
  --set "VIETQR_ACCOUNT_NAME=LA HOANG LONG" \
  --set "VIETQR_TEMPLATE=compact" \
  --set "UPLOAD_DIR=/app/uploads" \
  --set "MAX_UPLOAD_SIZE_MB=5" \
  --set "ADMIN_ZALO_UIDS="

# Deploy
echo "→ Deploy code…"
railway up --detach

# Generate domain
echo "→ Generate public domain…"
railway domain

echo ""
echo "=== ✅ Setup done ==="
echo "Bước cuối thủ công:"
echo "  1. Vào Railway dashboard, mount volume /app/uploads (1GB) vào service"
echo "  2. Sau khi user đầu tiên login, lấy zalo_uid → cập nhật ADMIN_ZALO_UIDS env"
echo "  3. Cấu hình Pancake webhook URL: https://<domain>/api/webhook/pancake"
echo "     Header: X-Webhook-Secret = $WEBHOOK_SECRET"
echo "  4. Update VITE_API_URL trong tubutree-app/.env trỏ về domain Railway"
