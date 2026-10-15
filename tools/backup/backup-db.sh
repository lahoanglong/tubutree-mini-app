#!/usr/bin/env bash
# Backup DB Postgres của Tubutree.
# WHY: chạy qua `docker compose exec` để khỏi cần cài pg_dump trên host —
# tận dụng đúng phiên bản postgres trong container (tránh lệch version client/server).
#
# Bản trên cùng đĩa với Postgres không cứu được khi đĩa/VPS hỏng: đặt RCLONE_REMOTE để đẩy ra
# ngoài máy (R2/S3/Google Drive... qua rclone). Đặt HEALTHCHECK_URL (kiểu healthchecks.io) để
# được báo khi backup lỗi HOẶC cron không chạy.
set -euo pipefail

# ----- Config (override qua env) -----
POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-90}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

# WHY: compose file ở repo root, script này nằm trong tools/backup → cần đi lên 2 cấp.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.vietnix.yml}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/tubutree_${TIMESTAMP}.sql.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

ping_healthcheck() {
  [ -n "$HEALTHCHECK_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL%/}$1" || log "WARN: không gọi được HEALTHCHECK_URL"
}
on_exit() {
  local code=$?
  if [ "$code" -eq 0 ]; then ping_healthcheck ""; else
    log "ERROR: backup thất bại (exit $code)"
    ping_healthcheck "/fail"
  fi
}
trap on_exit EXIT

log "=== Bắt đầu backup DB tubutree ==="
log "DB=${POSTGRES_DB} USER=${POSTGRES_USER} DIR=${BACKUP_DIR} KEEP=${BACKUP_KEEP_DAYS}d COMPOSE=${COMPOSE_FILE}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: Không tìm thấy compose file: $COMPOSE_FILE"
  exit 1
fi

# WHY: -T để tắt TTY allocation (cron không có TTY), pipe gzip ngay để tiết kiệm I/O.
log "Đang dump DB sang ${BACKUP_FILE} ..."
if docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > "$BACKUP_FILE" && gunzip -t "$BACKUP_FILE"; then
  SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
  log "OK: dump xong (${SIZE})"
else
  log "ERROR: pg_dump thất bại — xoá file hỏng"
  rm -f "$BACKUP_FILE"
  exit 2
fi

# Bản ngoài máy. Lỗi upload là lỗi backup (exit khác 0) để cảnh báo bắn ra; bản local vẫn giữ.
if [ -n "$RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: RCLONE_REMOTE đã đặt nhưng máy chưa cài rclone"
    exit 3
  fi
  log "Đang đẩy lên ${RCLONE_REMOTE} ..."
  if ! rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE"; then
    log "ERROR: đẩy bản backup ra ngoài máy thất bại — bản local vẫn giữ"
    exit 3
  fi
  log "OK: đã đẩy ra ngoài máy"
  rclone delete "$RCLONE_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --include 'tubutree_*.sql.gz' \
    || log "WARN: dọn bản cũ trên ${RCLONE_REMOTE} lỗi"
fi

# Cleanup local cũ
log "Dọn file backup local cũ hơn ${BACKUP_KEEP_DAYS} ngày ..."
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'tubutree_*.sql.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | wc -l)"
log "Đã xoá ${DELETED} file cũ"

log "=== Backup hoàn tất: ${BACKUP_FILE} ==="
