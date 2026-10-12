#!/usr/bin/env bash
# API riêng cổng 3302 trỏ tubutree_perf (đo C-012). Dùng: bash start-api-3302.sh <thư-mục-apps/api> [log-file]
# Thư mục apps/api cần có dist/ đã build (before = repo chính, after = worktree).
set -e
API_DIR="$1"; LOG="${2:-/tmp/api-3302.log}"
cd "$API_DIR"
PGUSER_PW="$(grep '^DATABASE_URL' .env | sed -E 's#.*//([^@]+)@.*#\1#')"
export PORT=3302 NODE_ENV=development
export DATABASE_URL="postgresql://${PGUSER_PW}@localhost:5434/tubutree_perf?schema=public"
export REDIS_URL="redis://localhost:6381/6"
export ZALO_OA_ACCESS_TOKEN= ZALO_OA_REFRESH_TOKEN= ZALO_APP_SECRET= DEEPSEEK_API_KEY= GEMINI_API_KEY= \
       PANCAKE_API_KEY= GOMDON_PHONE= GOMDON_PASSWORD= ZALOPAY_KEY1= ZALOPAY_KEY2= ACCESSTRADE_TOKEN=
exec node --max-old-space-size=768 dist/main.js >"$LOG" 2>&1
