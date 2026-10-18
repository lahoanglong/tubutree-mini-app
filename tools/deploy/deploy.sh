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
  if migration_applied "$POINTS_1D_MIGRATION"; then
    log "KHÔNG quay lại image $svc cũ: migration $POINTS_1D_MIGRATION đã nhân 1.000 mọi số điểm, code cũ đọc điểm theo 1 điểm = 1.000đ nên sẽ trừ/đổi sai tiền."
    log "Cách xử lý: sửa lỗi của bản mới rồi deploy lại, hoặc khôi phục backup chụp ngay trước deploy này (tools/backup/restore-db.sh, ops/backup-predeploy.sh) rồi mới chạy lại image cũ."
    return 0
  fi
  if [ -n "${id:-}" ] && [ -n "${name:-}" ]; then
    log "Quay lại image $svc trước đó (chỉ an toàn khi schema DB sau migrate vẫn tương thích với nó — xem runbook mục 7):"
    log "  docker tag $id $name && docker compose -f $COMPOSE_FILE up -d --no-build --no-deps $svc"
  else
    log "Không ghi nhận được image $svc trước đó — làm theo docs/launch/deploy-rollback-runbook.md mục 7 (không checkout commit cũ rồi chạy lại deploy.sh: script này không có ở commit cũ)."
  fi
}

# Migration đổi chỉ mục duy nhất của bảng reviews: API cũ vẫn ghi đánh giá theo khoá cũ, nên không được áp khi API cũ còn
# phục vụ (runbook mục 0.1). Bản không chứa migration này, hoặc DB đã áp xong nó, không bị chặn.
GUARDED_MIGRATION="20261015150000_r8_multi_reviews_unique_per_order"
# Migration đổi đơn vị Điểm Xanh (nhân 1.000 mọi số điểm): API cũ còn chạy thì cache cấu hình 60 giây của nó giữ tỉ giá cũ, khách
# đổi điểm được giảm gấp 1.000 lần số điểm bị trừ, đơn tạo trong lúc migrate lưu đơn vị cũ, và khoá bảng có thể deadlock (P3009).
POINTS_1D_MIGRATION="20261018210000_points_1d"

api_running() {
  local id
  id="$(dc ps -q api 2>/dev/null || true)"
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null || echo false)" = true ]
}

# Đọc DB bằng biến môi trường của chính container postgres, nên không cần đọc .env. Không đọc được thì coi như CHƯA áp.
migration_applied() {
  local applied
  applied="$(printf '%s\n' "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$1' AND finished_at IS NOT NULL AND rolled_back_at IS NULL" \
    | dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' 2>/dev/null || true)"
  [ "$(printf '%s' "$applied" | tr -d '[:space:]')" = 1 ]
}

migration_pending() {
  [ -d "apps/api/prisma/migrations/$1" ] || return 1
  ! migration_applied "$1"
}

guarded_migration_pending() { migration_pending "$GUARDED_MIGRATION"; }

log "=== Deploy $(git rev-parse --short HEAD 2>/dev/null || echo '?') với $COMPOSE_FILE ==="
PREV_API="$(running_image api)"
PREV_WEB="$(running_image web)"

if api_running && guarded_migration_pending; then
  log "ERROR: bản này có migration $GUARDED_MIGRATION (đổi chỉ mục duy nhất của bảng reviews) chưa áp, mà API cũ đang chạy và vẫn ghi đánh giá theo khoá cũ — DỪNG, chưa build hay migrate gì. Làm tay theo docs/launch/deploy-rollback-runbook.md: dừng API cũ, backup, migrate, bật web rồi API mới."
  exit 2
fi

if api_running && migration_pending "$POINTS_1D_MIGRATION"; then
  log "ERROR: bản này có migration $POINTS_1D_MIGRATION (đổi 1 Điểm Xanh = 1.000đ thành 1đ, nhân 1.000 mọi số điểm) chưa áp, mà API cũ đang chạy — DỪNG, chưa build hay migrate gì."
  log "Làm đúng thứ tự: 1) backup ngay trước (ops/backup-predeploy.sh), 2) dừng API: docker compose -f $COMPOSE_FILE stop api, 3) chạy lại deploy.sh này (build, migrate bằng image mới, bật API mới), 4) seed-reference nếu cần (nó từ chối chạy khi migration chưa xong). Không quay lại image cũ sau bước 3: hoàn tác = khôi phục backup. Chi tiết: docs/launch/deploy-rollback-runbook.md."
  exit 2
fi

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
