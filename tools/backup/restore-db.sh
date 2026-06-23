#!/usr/bin/env bash
# Restore DB Postgres từ file backup .sql.gz.
# WHY: tách script riêng để có confirm prompt — backup-db.sh chạy tự động qua cron,
# còn restore là thao tác phá huỷ nên phải có người gõ YES.
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.prod.yml}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

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

echo "================================================================"
echo "  CẢNH BÁO: Restore sẽ GHI ĐÈ database '${POSTGRES_DB}' hiện tại"
echo "  File:  ${BACKUP_FILE}"
echo "  User:  ${POSTGRES_USER}"
echo "================================================================"
read -p "Restore sẽ GHI ĐÈ DB. Type YES: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  log "Đã huỷ — không có thay đổi gì."
  exit 0
fi

log "Bắt đầu restore từ ${BACKUP_FILE} ..."
# WHY: ON_ERROR_STOP=1 để psql exit ngay khi gặp lỗi SQL đầu tiên (tránh state nửa vời).
if gunzip -c "$BACKUP_FILE" \
  | docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; then
  log "OK: Restore thành công"
else
  log "ERROR: Restore thất bại — DB có thể ở trạng thái không nhất quán"
  exit 2
fi
