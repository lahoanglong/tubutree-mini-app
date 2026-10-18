#!/usr/bin/env bash
# Chạy e2e web (E2E_SCOPE=web) trên Postgres + Redis tạm, không đụng DB/Redis dùng chung và vô hiệu apps/api/.env: Nest nạp .env cho khoá chưa có trong môi trường, nên mọi khoá tích hợp được export rỗng ở dưới.
# Dùng: apps/e2e/scripts/web-gate.sh [đối số playwright, vd: tests/web-checkout.web.spec.ts]
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$E2E_DIR/../.." && pwd)"
NAME_SUFFIX="$$-$(date +%s)"
PG_NAME="tubu-gate-pg-$NAME_SUFFIX"
REDIS_NAME="tubu-gate-redis-$NAME_SUFFIX"

port_busy() { lsof -ti "tcp:$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Cổng trống đầu tiên từ $1 trở đi, bỏ qua các cổng đã chọn ($2...).
free_port() {
  local p=$1; shift
  while port_busy "$p" || [[ " $* " == *" $p "* ]]; do p=$((p + 1)); done
  echo "$p"
}

require_free() {
  if port_busy "$2"; then
    echo "Cổng $2 ($1) đang có tiến trình nghe; đổi biến $1 hoặc dừng tiến trình đó." >&2
    exit 1
  fi
}

cleanup() {
  docker rm -f -v "$PG_NAME" "$REDIS_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

PG_PORT="${GATE_PG_PORT:-$(free_port 15432)}"
REDIS_PORT="${GATE_REDIS_PORT:-$(free_port 16379 "$PG_PORT")}"
export E2E_API_PORT="${E2E_API_PORT:-3121}"
export E2E_WEB_PORT="${E2E_WEB_PORT:-3122}"
export E2E_MINIAPP_PORT="${E2E_MINIAPP_PORT:-3123}"
require_free GATE_PG_PORT "$PG_PORT"
require_free GATE_REDIS_PORT "$REDIS_PORT"
require_free E2E_API_PORT "$E2E_API_PORT"
require_free E2E_WEB_PORT "$E2E_WEB_PORT"

docker run -d --rm --tmpfs /var/lib/postgresql/data --name "$PG_NAME" \
  -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree \
  -p "127.0.0.1:$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --rm --tmpfs /data --name "$REDIS_NAME" \
  -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "$PG_NAME" pg_isready -U tubu -d tubutree >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG_NAME" pg_isready -U tubu -d tubutree >/dev/null || { echo "Postgres tạm không sẵn sàng" >&2; exit 1; }
for _ in $(seq 1 30); do
  [[ "$(docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] && break
  sleep 1
done
[[ "$(docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] || { echo "Redis tạm không sẵn sàng" >&2; exit 1; }

export DATABASE_URL="postgresql://tubu:tubu@127.0.0.1:$PG_PORT/tubutree"
export REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
export JWT_ACCESS_SECRET="gate-access-secret-$(openssl rand -hex 16)"
export JWT_REFRESH_SECRET="gate-refresh-secret-$(openssl rand -hex 16)"
# Biến đã export (kể cả rỗng) không bị .env ghi đè: không để đơn e2e chạm Pancake/Gomdon/Zalo thật, CORS chỉ cho web e2e.
export PANCAKE_API_KEY= PANCAKE_SHOP_ID= PANCAKE_WEBHOOK_SECRET= GOMDON_PHONE= GOMDON_PASSWORD= GOMDON_WEBHOOK_SECRET=
export ZALO_OA_ACCESS_TOKEN= ZALO_OA_REFRESH_TOKEN= ZALO_OA_WEBHOOK_SECRET= ZALO_APP_SECRET=
export ZALOPAY_APP_ID= ZALOPAY_KEY1= ZALOPAY_KEY2= ACCESSTRADE_TOKEN= ACCESSTRADE_PUBLISHER_ID= ACCESSTRADE_WEBHOOK_SECRET=
export OPS_ALERT_WEBHOOK_URL= OPS_ALERT_EMAIL_TO= SMTP_HOST= SMTP_USER= SMTP_PASS=
export DEEPSEEK_API_KEY= GEMINI_API_KEY= ANTIGRAVITY_GATEWAY_URL= ANTIGRAVITY_GATEWAY_KEY=
export AUTH_COOKIE_DOMAIN= AUTH_COOKIE_SAMESITE=lax ZALO_APP_ID= ZALO_OA_ID= THROTTLE_BYPASS_TOKEN=
export CORS_ORIGINS="http://localhost:$E2E_WEB_PORT"
export NODE_ENV=test
export PORT="$E2E_API_PORT"
export CI=1

(
  cd "$ROOT/apps/api"
  npx prisma generate >/dev/null
  npx prisma migrate deploy
  npx tsx prisma/check-partial-indexes.ts
  npx tsx prisma/seed.ts
)

cd "$E2E_DIR"
E2E_SCOPE=web npx playwright test "$@"
