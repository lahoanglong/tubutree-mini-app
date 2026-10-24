#!/usr/bin/env bash
# Deploy bản mã đang có trong working tree: build -> kiểm .env -> migrate -> thay container API -> web -> zalo-bridge.
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
# Quyết định A8: DB mới phải có hạng thành viên, bậc đại lý, nhiệm vụ nên seed-reference chạy CÓ cờ. Đặt SEED_REFERENCE_ARGS=
# (rỗng) để bỏ cờ trên DB đã có sẵn các bảng đó; seed chỉ tạo dòng thiếu nên cả hai cách đều an toàn chạy lại.
SEED_REFERENCE_ARGS="${SEED_REFERENCE_ARGS---with-business-defaults}"

cd "$REPO_ROOT"
# Giá trị một khoá trong .env theo cách đọc của compose: bỏ \r, bỏ dấu nháy bao quanh, bỏ chú thích ` #...` cuối dòng không nháy.
# CHỈ truyền cho tiến trình backup, không export: compose đọc cùng các biến này để thay vào DATABASE_URL.
env_value() {
  local line v
  line="$(grep -E "^$1=" .env 2>/dev/null | tail -n1 || true)"
  v="${line#*=}"
  v="${v%$'\r'}"
  case "$v" in
    \"*) v="${v#\"}"; v="${v%%\"*}" ;;
    \'*) v="${v#\'}"; v="${v%%\'*}" ;;
    *) v="${v%%[[:space:]]#*}"; v="${v%"${v##*[![:space:]]}"}" ;;
  esac
  printf '%s' "$v"
}
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
  local state=1
  # Chỉ lần chạy này mới là lần áp points_1d (hoặc không biết lúc đầu) thì mới chặn quay image: deploy sau đó chồng lên bản đã
  # qua points_1d vẫn quay image được, còn khôi phục backup mới làm mất dữ liệu ghi từ lúc backup.
  if [ "${POINTS_1D_PENDING_AT_START:-0}" = 1 ]; then
    state=0
    migration_state "$POINTS_1D_MIGRATION" || state=$?
  fi
  if [ "$state" -eq 2 ]; then
    log "CẢNH BÁO: không đọc được DB để biết migration $POINTS_1D_MIGRATION (nhân 1.000 mọi số điểm) đã áp chưa — KHÔNG quay lại image $svc cũ khi chưa kiểm."
    log "Kiểm trước: SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '$POINTS_1D_MIGRATION'. Đã áp thì làm như đoạn khôi phục backup (runbook mục 7.3); chưa áp thì mới xem mục 7 để quay image."
    return 0
  fi
  if [ "$state" -eq 0 ]; then
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

# Đọc DB bằng biến môi trường của chính container postgres, nên không cần đọc .env.
# migration_state: 0 = đã áp, 1 = chưa áp, 2 = không đọc được DB (không chắc).
migration_state() {
  local applied rc=0
  applied="$(printf '%s\n' "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$1' AND finished_at IS NOT NULL AND rolled_back_at IS NULL" \
    | dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' 2>/dev/null)" || rc=$?
  [ "$rc" -eq 0 ] || return 2
  applied="$(printf '%s' "$applied" | tr -d '[:space:]')"
  case "$applied" in
    1) return 0 ;;
    0) return 1 ;;
    *) return 2 ;;
  esac
}

# Không đọc được thì coi như CHƯA áp (dùng cho việc chặn/đợi migration; nơi cần phân biệt "không chắc" gọi migration_state).
migration_applied() {
  local state=0
  migration_state "$1" || state=$?
  [ "$state" -eq 0 ]
}

migration_pending() {
  [ -d "apps/api/prisma/migrations/$1" ] || return 1
  ! migration_applied "$1"
}

guarded_migration_pending() { migration_pending "$GUARDED_MIGRATION"; }

log "=== Deploy $(git rev-parse --short HEAD 2>/dev/null || echo '?') với $COMPOSE_FILE ==="
PREV_API="$(running_image api)"
PREV_WEB="$(running_image web)"
# zalo-bridge không bắt buộc có trong compose (bản thử, compose cũ): thiếu thì bỏ qua, không làm deploy lỗi.
BRIDGE_SVC=""
if dc config --services 2>/dev/null | grep -qx zalo-bridge; then
  BRIDGE_SVC="zalo-bridge"
fi

if api_running && guarded_migration_pending; then
  log "ERROR: bản này có migration $GUARDED_MIGRATION (đổi chỉ mục duy nhất của bảng reviews) chưa áp, mà API cũ đang chạy và vẫn ghi đánh giá theo khoá cũ — DỪNG, chưa build hay migrate gì. Làm tay theo docs/launch/deploy-rollback-runbook.md: dừng API cũ, backup, migrate, bật web rồi API mới."
  exit 2
fi

# Tính một lần trước build: chưa áp (hoặc không đọc được DB, bảo thủ). Không phụ thuộc API đang chạy, để chạy lại sau khi
# migrate/seed lỗi (API đã dừng) vẫn đi đủ luồng points_1d, gồm seed-reference.
POINTS_1D_PENDING_AT_START=0
if migration_pending "$POINTS_1D_MIGRATION"; then
  POINTS_1D_PENDING_AT_START=1
fi
# seed-reference chạy khi points_1d còn chờ, hoặc API đang tắt (chạy lại sau lần seed lỗi, lúc migration đã áp): chỉ tạo dòng
# thiếu nên chạy lại an toàn, và nó tự từ chối nếu points_1d chưa xong. Tính trước khi script dừng API.
RUN_SEED_REFERENCE=0
if [ "$POINTS_1D_PENDING_AT_START" = 1 ] || ! api_running; then
  RUN_SEED_REFERENCE=1
fi
STOP_API_FOR_POINTS_1D=0
if [ "$POINTS_1D_PENDING_AT_START" = 1 ] && api_running; then
  STOP_API_FOR_POINTS_1D=1
  log "Bản này có migration $POINTS_1D_MIGRATION (đổi 1 Điểm Xanh = 1.000đ thành 1đ, nhân 1.000 mọi số điểm) chưa áp, API cũ đang chạy: sẽ build trước (API cũ vẫn phục vụ), rồi dừng API, backup, migrate, seed-reference, bật API mới."
fi

# Câu mô tả trạng thái API cho các thông báo lỗi, theo API đang chạy hay đã tắt lúc lỗi.
api_state_note() {
  if api_running; then
    echo "Container cũ vẫn phục vụ."
  else
    echo "API đang tắt và KHÔNG tự bật lại."
  fi
}

log "1/6 Build image api + web${BRIDGE_SVC:+ + $BRIDGE_SVC} (container cũ vẫn chạy)"
dc build api web $BRIDGE_SVC

log "2/6 Kiểm cấu hình môi trường (.env) bằng image MỚI"
if ! dc run --rm --no-deps api node dist/config/check-env.js; then
  log "ERROR: .env không qua kiểm tra của bản mới — DỪNG. $(api_state_note) Sửa .env (ops.yml set-env) rồi deploy lại."
  exit 2
fi

# Bất kỳ migration nào chờ cũng là thay đổi một chiều của DB: dùng image MỚI (có đủ thư mục migrations) hỏi prisma. Lệnh thoát
# khác 0 khi còn migration chờ, và cả khi không nối được DB: cả hai đều backup cho chắc (không đọc được thì bước backup/migrate
# phía sau cũng sẽ dừng deploy).
BACKUP_NEEDED="$POINTS_1D_PENDING_AT_START"
if [ "$BACKUP_NEEDED" != 1 ] && ! dc run --rm --no-deps api pnpm exec prisma migrate status >/dev/null 2>&1; then
  BACKUP_NEEDED=1
  log "prisma migrate status: còn migration chờ áp (hoặc không đọc được trạng thái) — sẽ backup DB ngay trước migrate."
fi

if [ "$STOP_API_FOR_POINTS_1D" = 1 ]; then
  log "Dừng API cũ trước khi migrate $POINTS_1D_MIGRATION (từ đây API ngừng phục vụ tới khi API mới healthy)"
  if ! dc stop api; then
    log "ERROR: không dừng được API cũ — DỪNG, chưa backup, chưa migrate. Kiểm tra: docker compose -f $COMPOSE_FILE ps api"
    exit 2
  fi
fi

# Migration một chiều: luôn backup NGAY trước khi áp, kể cả khi API đã tắt từ trước (chạy lại sau lần lỗi: bản backup lần trước
# có thể đã cũ vì API từng được bật phục vụ khách). Nhánh points_1d đã dừng API nên không còn ghi nào lọt giữa bản backup và
# migration; migration khác thì API cũ còn chạy, ghi sau backup sẽ mất nếu phải khôi phục.
if [ "$BACKUP_NEEDED" = 1 ]; then
  log "Backup DB ngay trước migrate (ops/backup-predeploy.sh)"
  backup_rc=0
  POSTGRES_USER="$(env_value POSTGRES_USER)" POSTGRES_DB="$(env_value POSTGRES_DB)" COMPOSE_FILE="$COMPOSE_FILE" \
    bash "$REPO_ROOT/ops/backup-predeploy.sh" || backup_rc=$?
  if [ "$backup_rc" -ne 0 ]; then
    if [ "$backup_rc" -eq 3 ]; then
      log "ERROR: bản backup local đã tạo nhưng đẩy ra ngoài máy (RCLONE_REMOTE) lỗi, hoặc RCLONE_REMOTE chưa phải remote rclone crypt (xem tools/backup/README.md, mục 'Mã hoá bản ngoài máy') — vẫn DỪNG cho chắc, chưa migrate gì. Sửa rclone rồi chạy lại, hoặc tự quyết dùng bản local."
    else
      log "ERROR: backup local lỗi (exit $backup_rc) — DỪNG, chưa migrate gì."
    fi
    if [ "$STOP_API_FOR_POINTS_1D" = 1 ]; then
      log "Bật lại API cũ (chính script này đã dừng nó)."
      dc start api || log "ERROR: không bật lại được API cũ — chạy tay: docker compose -f $COMPOSE_FILE start api"
    fi
    exit 2
  fi
fi

log "3/6 Áp migration bằng image MỚI"
if ! dc run --rm --no-deps api pnpm exec prisma migrate deploy; then
  if api_running; then
    log "ERROR: migration lỗi — DỪNG. $(api_state_note) Xử lý theo mục Rollback của runbook."
  else
    log "ERROR: migration lỗi — DỪNG. $(api_state_note) Migration có thể đã áp dở: xử lý theo mục Rollback của runbook (7.0 và 7.3) trước khi bật API; chạy lại deploy.sh sẽ đi lại đủ luồng points_1d."
  fi
  exit 2
fi

if [ "$RUN_SEED_REFERENCE" = 1 ]; then
  log "3b/6 Nạp dữ liệu tham chiếu (seed-reference, chỉ tạo dòng thiếu) khi API còn dừng"
  # shellcheck disable=SC2086 # tách từ có chủ ý: rỗng thì không truyền gì
  if ! dc run --rm --no-deps api pnpm run prisma:seed:reference $SEED_REFERENCE_ARGS; then
    log "ERROR: seed-reference lỗi — DỪNG. $(api_state_note) Migration đã áp nên KHÔNG quay lại image cũ. Đọc lỗi rồi chạy lại deploy.sh (đi lại đủ luồng, seed-reference an toàn chạy lại)."
    exit 2
  fi
fi

log "4/6 Thay container api"
dc up -d --no-build api
if ! wait_healthy api; then
  rollback_hint api "$PREV_API"
  exit 3
fi

log "5/6 Thay container web"
dc up -d --no-build web
if ! wait_healthy web; then
  rollback_hint web "$PREV_WEB"
  exit 3
fi

# Sau khi api healthy: bridge gửi sự kiện về api. Tạo lại bridge có thể làm một tin đang chuyển tiếp bị gửi hai lần (đã biết, chấp nhận).
if [ -n "$BRIDGE_SVC" ]; then
  log "6/6 Thay container $BRIDGE_SVC"
  dc up -d --no-build "$BRIDGE_SVC"
  if ! wait_healthy "$BRIDGE_SVC"; then
    log "api và web đã chạy bản mới; chỉ $BRIDGE_SVC lỗi (chat Zalo cá nhân tạm ngưng, đơn hàng không bị ảnh hưởng)."
    log "Xem log: docker compose -f $COMPOSE_FILE logs --tail 200 $BRIDGE_SVC. Chạy lại deploy.sh hoặc: docker compose -f $COMPOSE_FILE up -d --build $BRIDGE_SVC"
    exit 3
  fi
fi

log "=== Deploy xong. Chạy smoke test theo runbook (/api/health, /api/config/public, đăng nhập) ==="
