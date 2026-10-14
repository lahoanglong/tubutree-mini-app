#!/usr/bin/env bash
# Deploy bản mã đang có trong working tree: build -> migrate -> thay container API -> web.
#
# Thứ tự này là bắt buộc. `docker compose run` KHÔNG build lại image, nên chạy migrate trước khi
# build sẽ dùng thư mục migrations của image CŨ, báo "No pending migrations" và migration mới chỉ
# chạy trong CMD của container mới, sau khi container cũ đã bị thay (P3009 crash-loop, API sập).
# Build trước rồi migrate bằng image mới: migration lỗi thì dừng ở đây, container cũ vẫn phục vụ.
#
#   bash tools/deploy/deploy.sh                       # VPS Vietnix (mặc định)
#   COMPOSE_FILE=docker-compose.prod.yml bash tools/deploy/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vietnix.yml}"
DEPLOY_HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-180}"

cd "$REPO_ROOT"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

wait_healthy() {
  local svc="$1" waited=0 id status
  while [ "$waited" -lt "$DEPLOY_HEALTH_TIMEOUT" ]; do
    id="$(dc ps -q "$svc")"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo unknown)"
    if [ "$status" = healthy ]; then
      log "$svc healthy"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  log "ERROR: $svc chưa healthy sau ${DEPLOY_HEALTH_TIMEOUT}s — xem: docker compose -f $COMPOSE_FILE logs --tail 200 $svc"
  return 1
}

log "=== Deploy $(git rev-parse --short HEAD 2>/dev/null || echo '?') với $COMPOSE_FILE ==="

log "1/4 Build image api + web (container cũ vẫn chạy)"
dc build api web

log "2/4 Áp migration bằng image MỚI"
if ! dc run --rm --no-deps api pnpm exec prisma migrate deploy; then
  log "ERROR: migration lỗi — DỪNG. Container cũ vẫn phục vụ. Xử lý theo mục Rollback của runbook."
  exit 2
fi

log "3/4 Thay container api"
dc up -d --no-build api
wait_healthy api

log "4/4 Thay container web"
dc up -d --no-build web
wait_healthy web

log "=== Deploy xong. Chạy smoke test theo runbook (/api/health, /api/config/public, đăng nhập) ==="
