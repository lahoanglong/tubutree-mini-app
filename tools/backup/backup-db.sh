#!/usr/bin/env bash
# Backup DB Postgres của Tubutree.
# WHY: chạy qua `docker compose exec` để khỏi cần cài pg_dump trên host —
# tận dụng đúng phiên bản postgres trong container (tránh lệch version client/server).
#
# Bản trên cùng đĩa với Postgres không cứu được khi đĩa/VPS hỏng: đặt RCLONE_REMOTE để đẩy ra
# ngoài máy (R2/S3/Google Drive... qua rclone). Đặt HEALTHCHECK_URL (kiểu healthchecks.io) để
# được báo khi backup lỗi HOẶC cron không chạy. Thiếu một trong hai thì vẫn lưu local và in WARN.
#
# Cron 6 giờ/lần và bản trước mỗi deploy dùng chung script này, phân biệt bằng BACKUP_LABEL
# (file tubutree_<giờ>_<nhãn>.sql.gz) và BACKUP_KEEP_COUNT (giữ N bản mới nhất của cùng nhãn).
# Mẫu: ops/crontab.backup.example, ops/backup-predeploy.sh.
set -euo pipefail

# ----- Config (override qua env) -----
POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
# Nhãn gắn vào tên file (chỉ chữ và số, ví dụ cron, predeploy). Rỗng = tên cũ tubutree_<giờ>.sql.gz.
BACKUP_LABEL="${BACKUP_LABEL:-}"
# Giữ N bản mới nhất CÙNG NHÃN, xoá bản cũ hơn. 0 = không xoá theo số bản (chỉ theo BACKUP_KEEP_DAYS).
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-0}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-90}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
# 1 = không cảnh báo khi thiếu HEALTHCHECK_URL (bản chạy tay trước deploy không cần dead-man switch).
HEALTHCHECK_OPTIONAL="${HEALTHCHECK_OPTIONAL:-0}"
# Dump chứa SĐT, địa chỉ, tài khoản ngân hàng hoàn tiền của khách: remote phải là rclone `crypt`. 1 = cho phép đẩy bản rõ.
BACKUP_ALLOW_PLAIN_REMOTE="${BACKUP_ALLOW_PLAIN_REMOTE:-0}"

case "$BACKUP_LABEL" in
  *[!A-Za-z0-9]*) echo "ERROR: BACKUP_LABEL chỉ gồm chữ và số (đang là '$BACKUP_LABEL')" >&2; exit 1 ;;
esac
case "$BACKUP_KEEP_COUNT" in
  '' | *[!0-9]*) echo "ERROR: BACKUP_KEEP_COUNT phải là số nguyên không âm (đang là '$BACKUP_KEEP_COUNT')" >&2; exit 1 ;;
esac

# WHY: compose file ở repo root, script này nằm trong tools/backup → cần đi lên 2 cấp.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.vietnix.yml}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/tubutree_${TIMESTAMP}${BACKUP_LABEL:+_${BACKUP_LABEL}}.sql.gz"

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

# Giữ BACKUP_KEEP_COUNT bản mới nhất của đúng nhãn này (sắp theo tên: giờ nằm trong tên, không phụ thuộc mtime).
# Nhãn khác và bản không nhãn không bị đụng.
prune_by_count() {
  [ "$BACKUP_KEEP_COUNT" -gt 0 ] || return 0
  local re kept=0 deleted=0 f
  if [ -n "$BACKUP_LABEL" ]; then re="^tubutree_[0-9]{8}_[0-9]{6}_${BACKUP_LABEL}\.sql\.gz$"
  else re='^tubutree_[0-9]{8}_[0-9]{6}\.sql\.gz$'; fi
  while IFS= read -r f; do
    [[ "$(basename "$f")" =~ $re ]] || continue
    kept=$((kept + 1))
    if [ "$kept" -gt "$BACKUP_KEEP_COUNT" ] && [ "$f" != "$BACKUP_FILE" ]; then
      rm -f -- "$f"
      deleted=$((deleted + 1))
    fi
  done < <(printf '%s\n' "$BACKUP_DIR"/tubutree_*.sql.gz | sort -r)
  log "Giữ ${BACKUP_KEEP_COUNT} bản mới nhất${BACKUP_LABEL:+ nhãn ${BACKUP_LABEL}}, đã xoá ${deleted} bản cũ hơn"
}

log "=== Bắt đầu backup DB tubutree ==="
COUNT_NOTE=""
if [ "$BACKUP_KEEP_COUNT" -gt 0 ]; then COUNT_NOTE=" KEEP_COUNT=${BACKUP_KEEP_COUNT}"; fi
log "DB=${POSTGRES_DB} USER=${POSTGRES_USER} DIR=${BACKUP_DIR} KEEP=${BACKUP_KEEP_DAYS}d COMPOSE=${COMPOSE_FILE}${BACKUP_LABEL:+ LABEL=${BACKUP_LABEL}}${COUNT_NOTE}"
[ -n "$RCLONE_REMOTE" ] || log "WARN: RCLONE_REMOTE chưa đặt — bản backup chỉ nằm trên cùng đĩa với Postgres, đĩa/VPS hỏng là mất cả hai."
if [ -z "$HEALTHCHECK_URL" ] && [ "$HEALTHCHECK_OPTIONAL" != 1 ]; then
  log "WARN: HEALTHCHECK_URL chưa đặt — backup lỗi hoặc cron ngừng chạy sẽ không ai được báo."
fi

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

# Loại của remote (drive, crypt, s3...) theo `listremotes --long`: không in cấu hình nên không lộ khoá. Không thấy thì rỗng.
# Tên remote bắt đầu bằng ":" (connection string) hay không có trong cấu hình cũng ra rỗng và bị từ chối.
remote_type() {
  rclone listremotes --long 2>/dev/null | awk -v n="$1:" '$1 == n { print $2; exit }'
}

# Bản ngoài máy. Lỗi upload là lỗi backup (exit 3 ở cuối, để cảnh báo bắn ra); bản local vẫn giữ và việc dọn bản cũ
# vẫn chạy bên dưới, nếu không remote hỏng nhiều ngày thì đĩa đầy dần.
UPLOAD_FAILED=0
if [ -n "$RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: RCLONE_REMOTE đã đặt nhưng máy chưa cài rclone"
    UPLOAD_FAILED=1
  elif [ "$BACKUP_ALLOW_PLAIN_REMOTE" != 1 ] && [ "$(remote_type "${RCLONE_REMOTE%%:*}")" != crypt ]; then
    log "ERROR: remote '${RCLONE_REMOTE%%:*}' không phải rclone crypt — KHÔNG đẩy bản backup chưa mã hoá ra ngoài máy (xem tools/backup/README.md mục 'Mã hoá bản ngoài máy'). Chỉ khi chủ chấp nhận rủi ro: BACKUP_ALLOW_PLAIN_REMOTE=1"
    UPLOAD_FAILED=1
  else
    log "Đang đẩy lên ${RCLONE_REMOTE} ..."
    if ! rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE"; then
      log "ERROR: đẩy bản backup ra ngoài máy thất bại — bản local vẫn giữ"
      UPLOAD_FAILED=1
    else
      log "OK: đã đẩy ra ngoài máy"
      rclone delete "$RCLONE_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --include 'tubutree_*.sql.gz' \
        || log "WARN: dọn bản cũ trên ${RCLONE_REMOTE} lỗi"
    fi
  fi
fi

# Cleanup local cũ
log "Dọn file backup local cũ hơn ${BACKUP_KEEP_DAYS} ngày ..."
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'tubutree_*.sql.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | wc -l)"
log "Đã xoá ${DELETED} file cũ"
prune_by_count

if [ "$UPLOAD_FAILED" -ne 0 ]; then
  log "=== Backup local xong nhưng KHÔNG có bản ngoài máy: ${BACKUP_FILE} ==="
  exit 3
fi
log "=== Backup hoàn tất: ${BACKUP_FILE} ==="
