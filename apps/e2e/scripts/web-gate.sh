#!/usr/bin/env bash
# Chạy e2e web (E2E_SCOPE=web) trên Postgres + Redis tạm, không đụng DB/Redis dùng chung và vô hiệu apps/api/.env: Nest nạp .env cho khoá chưa có trong môi trường, nên mọi khoá tích hợp được export rỗng ở dưới.
# Dùng: apps/e2e/scripts/web-gate.sh [đối số playwright, vd: tests/web-checkout.web.spec.ts]
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$E2E_DIR/../.." && pwd)"
# shellcheck source=../../../scripts/release/colima-forward.sh
source "$ROOT/scripts/release/colima-forward.sh"
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

API_PID=""
cleanup() {
  if [[ -n "$API_PID" ]]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
  colima_forward_cleanup
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

# Hỏi qua TCP: lúc initdb, entrypoint chạy một máy chủ tạm chỉ nghe socket unix rồi tắt đi để khởi động lại; hỏi qua socket thì
# vòng chờ thoát sớm và lần kiểm dưới rơi đúng khe máy chủ đang khởi động lại.
for _ in $(seq 1 60); do
  docker exec "$PG_NAME" pg_isready -h 127.0.0.1 -U tubu -d tubutree >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG_NAME" pg_isready -h 127.0.0.1 -U tubu -d tubutree >/dev/null || { echo "Postgres tạm không sẵn sàng" >&2; exit 1; }
for _ in $(seq 1 30); do
  [[ "$(docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] && break
  sleep 1
done
[[ "$(docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] || { echo "Redis tạm không sẵn sàng" >&2; exit 1; }
# Container sẵn sàng bên trong VM chưa chắc tới được từ máy (Colima mất chuyển tiếp cổng): chờ hostagent, không có thì mở đường hầm ssh.
colima_forward_ports "$PG_PORT" "$REDIS_PORT" || exit 1

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
export AUTH_COOKIE_DOMAIN= AUTH_COOKIE_SAMESITE=lax ZALO_APP_ID= ZALO_OA_ID=
# Token bypass (API đòi ≥ 32 ký tự) cho fetch của máy chủ web: `next build`, SSR và lượt làm mới ISR đều đi từ một IP, không được chạm trần
# 300 request/phút/route của khách (429 lúc build là trang ISR rỗng tới hết revalidate). Trình duyệt của test không gửi header này.
export THROTTLE_BYPASS_TOKEN="gate-ssr-$(openssl rand -hex 24)"
export CORS_ORIGINS="http://localhost:$E2E_WEB_PORT"
export NODE_ENV=test
export PORT="$E2E_API_PORT"
export CI=1
# Bản build cho máy chủ web (next dev chết giữa chừng khi nhiều worker song song) và log máy chủ để còn dấu vết khi chết.
export E2E_WEB_PROD=1
export E2E_LOG_DIR="${E2E_LOG_DIR:-$E2E_DIR/server-logs}"

(
  cd "$ROOT/apps/api"
  npx prisma generate >/dev/null
  npx prisma migrate deploy
  npx tsx prisma/check-partial-indexes.ts
  npx tsx prisma/seed.ts
  npx tsx -e "const w = require('../e2e/tests/support/waste-db'); w.seedWasteRulesText(w.WASTE_RULES_TEXT)"
  npx tsx -e "const w = require('../e2e/tests/support/waste-db'); w.seedSeasonalThemeNone()"
)

# API lên và trả dữ liệu TRƯỚC khi Playwright chạy `next build`: trang ISR lấy dữ liệu lúc build (/doi-rac đọc /config/public, /waste/warehouses,
# /waste/catalogue), gặp lỗi mạng hay 429/5xx thì dựng bản rỗng và giữ tới hết revalidate 5 phút, test chạy trong khoảng đó thấy FAQ rỗng.
# Chạy bản dist một tiến trình (không watch nên không tự khởi động lại giữa lượt); Playwright dùng lại API này (E2E_API_PREBOOTED=1).
mkdir -p "$E2E_LOG_DIR"
(
  cd "$ROOT/apps/api"
  npx nest build
) > "$E2E_LOG_DIR/api-build.log" 2>&1 || { echo "Dựng API lỗi, xem $E2E_LOG_DIR/api-build.log" >&2; tail -20 "$E2E_LOG_DIR/api-build.log" >&2; exit 1; }
(cd "$ROOT/apps/api" && exec node dist/main.js) > "$E2E_LOG_DIR/webserver-api.log" 2>&1 &
API_PID=$!
API_BASE="http://127.0.0.1:$E2E_API_PORT/api"
# --max-time: API mở cổng mà một handler treo (chờ DB/Redis lúc khởi động) thì curl không được chờ mãi, hạn chót 180 giây phải còn tác dụng.
api_ready() {
  local p
  for p in health config/public waste/warehouses waste/catalogue; do
    curl -fsS --max-time 5 -o /dev/null "$API_BASE/$p" || return 1
  done
}
deadline=$((SECONDS + 180))
until api_ready 2>/dev/null; do
  kill -0 "$API_PID" 2>/dev/null || { echo "API thoát trước khi sẵn sàng, xem $E2E_LOG_DIR/webserver-api.log" >&2; tail -30 "$E2E_LOG_DIR/webserver-api.log" >&2; exit 1; }
  ((SECONDS < deadline)) || { echo "API không trả đủ /health, /config/public, /waste/* sau 180 giây" >&2; exit 1; }
  sleep 1
done
export E2E_API_PREBOOTED=1

# Cache fetch của next build còn dữ liệu của DB tạm lượt trước: bản hết hạn vẫn được dùng để dựng trang ISR (Next chỉ làm mới ngầm sau đó),
# nên trang dựng sẵn có thể không khớp DB lượt này.
rm -rf "$ROOT/apps/web/.next/cache/fetch-cache"

cd "$E2E_DIR"
E2E_SCOPE=web npx playwright test "$@"
