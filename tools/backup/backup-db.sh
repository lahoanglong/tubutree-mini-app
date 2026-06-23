#!/usr/bin/env bash
# Backup DB Postgres của Tubutree.
# WHY: chạy qua `docker compose exec` để khỏi cần cài pg_dump trên host —
# tận dụng đúng phiên bản postgres trong container (tránh lệch version client/server).
set -euo pipefail

# ----- Config (override qua env) -----
POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
GCS_BUCKET="${GCS_BUCKET:-}"

# WHY: compose file ở repo root, script này nằm trong tools/backup → cần đi lên 2 cấp.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.prod.yml}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/tubutree_${TIMESTAMP}.sql.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=== Bắt đầu backup DB tubutree ==="
log "DB=${POSTGRES_DB} USER=${POSTGRES_USER} DIR=${BACKUP_DIR} KEEP=${BACKUP_KEEP_DAYS}d"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: Không tìm thấy compose file: $COMPOSE_FILE"
  exit 1
fi

# WHY: -T để tắt TTY allocation (cron không có TTY), pipe gzip ngay để tiết kiệm I/O.
log "Đang dump DB sang ${BACKUP_FILE} ..."
if docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > "$BACKUP_FILE"; then
  SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
  log "OK: dump xong (${SIZE})"
else
  log "ERROR: pg_dump thất bại — xoá file rỗng"
  rm -f "$BACKUP_FILE"
  exit 2
fi

# Upload GCS (optional)
if [ -n "$GCS_BUCKET" ]; then
  if command -v gsutil >/dev/null 2>&1; then
    log "Đang upload lên ${GCS_BUCKET} ..."
    if gsutil cp "$BACKUP_FILE" "${GCS_BUCKET%/}/"; then
      log "OK: upload GCS thành công"
    else
      log "WARN: upload GCS thất bại — vẫn giữ bản local"
    fi
  else
    log "WARN: GCS_BUCKET set nhưng không có gsutil — bỏ qua upload"
  fi
fi

# Cleanup local cũ
log "Dọn file backup local cũ hơn ${BACKUP_KEEP_DAYS} ngày ..."
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'tubutree_*.sql.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | wc -l)"
log "Đã xoá ${DELETED} file cũ"

log "=== Backup hoàn tất: ${BACKUP_FILE} ==="
