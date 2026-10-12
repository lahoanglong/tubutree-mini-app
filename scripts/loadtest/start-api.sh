#!/usr/bin/env bash
# Chạy 1 instance API RIÊNG (cổng 3301) trỏ DB tubutree_perf. Dùng dist đã build sẵn của apps/api (chỉ đọc).
# Chặn dịch vụ ngoài bằng cách đặt rỗng các token (process.env thắng .env). Redis dùng DB số 5.
# Dùng: bash start-api.sh [log-file]   (DEBUG_SQL=1 để bật log SQL Prisma;
#   API_DIR=<đường dẫn apps/api khác> để đo bản build của commit khác, PERF_DB=<tên DB> để đổi DB, mặc định tubutree_perf)
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${1:-$ROOT/scripts/loadtest/results/api-3301.log}"
PGUSER_PW="$(grep '^DATABASE_URL' "$ROOT/apps/api/.env" | sed -E 's#.*//([^@]+)@.*#\1#')"
cd "${API_DIR:-$ROOT/apps/api}"
export PORT=3301 NODE_ENV=development
export DATABASE_URL="postgresql://${PGUSER_PW}@localhost:5434/${PERF_DB:-tubutree_perf}?schema=public"
export REDIS_URL="redis://localhost:6381/5"
export ZALO_OA_ACCESS_TOKEN= ZALO_OA_REFRESH_TOKEN= ZALO_APP_SECRET= DEEPSEEK_API_KEY= GEMINI_API_KEY= \
       PANCAKE_API_KEY= GOMDON_PHONE= GOMDON_PASSWORD= ZALOPAY_KEY1= ZALOPAY_KEY2= ACCESSTRADE_TOKEN=
[ -n "$DEBUG_SQL" ] && export DEBUG="prisma:query"
exec node --max-old-space-size=768 dist/main.js >"$LOG" 2>&1
