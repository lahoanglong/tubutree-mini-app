#!/usr/bin/env bash
# Deploy bản mã đang có trong working tree: build -> kiểm .env -> migrate -> thay container API -> web.
#
# Thứ tự này là bắt buộc. `docker compose run` KHÔNG build lại image, nên chạy migrate trước khi
# build sẽ dùng thư mục migrations của image CŨ, báo "No pending migrations" và migration mới chỉ
# chạy trong CMD của container mới, sau khi container cũ đã bị thay (P3009 crash-loop, API sập).
# Build trước rồi migrate bằng image mới: migration lỗi thì dừng ở đây, container cũ vẫn phục vụ. Cấu hình .env
# cũng được kiểm bằng image mới trước đó (khoá vừa thành bắt buộc, URL gõ sai) vì cùng lý do.
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

# Image đang chạy (id + tên) của một service — để in lệnh quay lại khi bản mới không lên được.
running_image() {
  local id
  id="$(dc ps -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] || return 0
  echo "$(docker inspect -f '{{.Image}}' "$id" 2>/dev/null || true) $(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || true)"
}

rollback_hint() {
  local svc="$1" prev="$2" id name
  read -r id name <<<"$prev"
  if [ -n "${id:-}" ] && [ -n "${name:-}" ]; then
    log "Quay lại image $svc trước đó (migration mới phải tương thích ngược — xem runbook):"
    log "  docker tag $id $name && docker compose -f $COMPOSE_FILE up -d --no-build $svc"
  else
    log "Không ghi nhận được image $svc trước đó — checkout commit cũ rồi chạy lại deploy.sh."
  fi
}

log "=== Deploy $(git rev-parse --short HEAD 2>/dev/null || echo '?') với $COMPOSE_FILE ==="
PREV_API="$(running_image api)"
PREV_WEB="$(running_image web)"

log "1/5 Build image api + web (container cũ vẫn chạy)"
dc build api web

log "2/5 Kiểm cấu hình môi trường (.env) bằng image MỚI"
if ! dc run --rm --no-deps api node dist/config/check-env.js; then
  log "ERROR: .env không qua kiểm tra của bản mới — DỪNG. Container cũ vẫn phục vụ. Sửa .env (ops.yml set-env) rồi deploy lại."
  exit 2
fi

log "3/5 Áp migration bằng image MỚI"
if ! dc run --rm --no-deps api pnpm exec prisma migrate deploy; then
  log "ERROR: migration lỗi — DỪNG. Container cũ vẫn phục vụ. Xử lý theo mục Rollback của runbook."
  exit 2
fi

log "4/5 Thay container api"
dc up -d --no-build api
if ! wait_healthy api; then
  rollback_hint api "$PREV_API"
  exit 3
fi

log "5/5 Thay container web"
dc up -d --no-build web
if ! wait_healthy web; then
  rollback_hint web "$PREV_WEB"
  exit 3
fi

log "=== Deploy xong. Chạy smoke test theo runbook (/api/health, /api/config/public, đăng nhập) ==="
