#!/usr/bin/env bash
# Restore DB Postgres từ file backup .sql.gz (tạo bởi backup-db.sh).
# WHY: tách script riêng để có confirm prompt — backup-db.sh chạy tự động qua cron,
# còn restore là thao tác phá huỷ nên phải có người gõ YES.
#
# Cách làm: nạp dump vào một DB TẠM trong một transaction. Chỉ khi nạp xong mới dừng api, đổi tên
# DB hiện tại thành <db>_before_restore_<ts> và DB tạm thành <db>, rồi bật lại api. Dump không có
# --clean nên nạp thẳng vào DB đang có dữ liệu sẽ lỗi ngay ở object đầu tiên ("already exists");
# cách đổi tên còn giữ nguyên DB cũ để quay lại nếu bản backup có vấn đề.
# Cần chỗ trống trên đĩa cỡ một DB nữa trong lúc restore.
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.vietnix.yml}"

TS="$(date +%Y%m%d_%H%M%S)"
RESTORE_DB="${POSTGRES_DB}_restore_${TS}"
OLD_DB="${POSTGRES_DB}_before_restore_${TS}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_admin() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"; }

if [ $# -ne 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  log "ERROR: Không tìm thấy file backup: $BACKUP_FILE"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: Không tìm thấy compose file: $COMPOSE_FILE"
  exit 1
fi

if ! gunzip -t "$BACKUP_FILE"; then
  log "ERROR: File backup hỏng (gunzip -t lỗi) — không làm gì."
  exit 1
fi

echo "================================================================"
echo "  CẢNH BÁO: Restore sẽ THAY database '${POSTGRES_DB}' bằng nội dung backup"
echo "  File:     ${BACKUP_FILE}"
echo "  Compose:  ${COMPOSE_FILE}"
echo "  API sẽ dừng vài giây lúc đổi DB. DB hiện tại được giữ lại tên ${OLD_DB}."
echo "================================================================"
read -r -p "Restore sẽ THAY DB. Type YES: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  log "Đã huỷ — không có thay đổi gì."
  exit 0
fi

log "1/3 Nạp backup vào DB tạm ${RESTORE_DB} (DB thật chưa bị đụng) ..."
psql_admin -c "CREATE DATABASE \"${RESTORE_DB}\""
# WHY: ON_ERROR_STOP + --single-transaction: lỗi ở đâu cũng rollback sạch, không có DB nửa vời.
if ! gunzip -c "$BACKUP_FILE" \
  | dc exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$RESTORE_DB" > /dev/null; then
  log "ERROR: Nạp backup thất bại — DB '${POSTGRES_DB}' KHÔNG bị thay đổi. Dọn DB tạm."
  psql_admin -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\"" || true
  exit 2
fi

log "2/3 Dừng api và đổi DB ..."
dc stop api
restart_api() { dc start api || log "WARN: không bật lại được api — chạy tay: docker compose -f $COMPOSE_FILE up -d api"; }
trap restart_api EXIT
if ! psql_admin \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid()" \
  -c "ALTER DATABASE \"${POSTGRES_DB}\" RENAME TO \"${OLD_DB}\"" \
  -c "ALTER DATABASE \"${RESTORE_DB}\" RENAME TO \"${POSTGRES_DB}\""; then
  log "ERROR: Đổi tên DB lỗi. Đưa DB cũ về tên '${POSTGRES_DB}' nếu nó đã bị đổi; bản restore nằm ở '${RESTORE_DB}'."
  if ! psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
    psql_admin -c "ALTER DATABASE \"${OLD_DB}\" RENAME TO \"${POSTGRES_DB}\"" || true
  fi
  exit 3
fi

log "3/3 Bật lại api (CMD chạy prisma migrate deploy nếu backup cũ hơn schema hiện tại) ..."
trap - EXIT
dc start api

log "OK: Restore xong. DB trước restore giữ ở '${OLD_DB}'."
log "Kiểm tra app ổn rồi mới xoá: docker compose -f $COMPOSE_FILE exec -T postgres psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE \"${OLD_DB}\"'"
