#!/usr/bin/env bash
# Backup Postgres + bản sao ngoài máy (rclone) + dấu thời điểm offsite thành công cho `ops/check-edge.sh --local` theo dõi tuổi.
# File: $BACKUP_DIR/tubutree_<giờ>_offsite.sql.gz (vẫn khớp mẫu tubutree_*.sql.gz của runbook, restore-db.sh và check-edge).
#
# Làm gì, theo thứ tự: dump (docker compose exec ... pg_dump | gzip) -> file phải > 0 byte và `gzip -t` hợp lệ, không thì xoá file hỏng và thoát 2
# -> RCLONE_REMOTE đặt thì đẩy lên remote, kiểm file đã có ở remote, ghi $BACKUP_DIR/.last-offsite-ok -> dọn bản cũ của CHÍNH nhãn này.
# RCLONE_REMOTE chưa đặt: không làm gãy backup local, in `SKIP offsite (RCLONE_REMOTE unset)` và thoát 0 (dấu .last-offsite-ok giữ nguyên, nên
# check-edge sẽ cảnh báo khi nó cũ dần).
#
# KHÁC tools/backup/backup-db.sh (cron 6 giờ/lần, bản trước deploy): script đó dọn MỌI file tubutree_*.sql.gz theo BACKUP_KEEP_DAYS/REMOTE_KEEP_DAYS của nó
# (30 ngày local, 90 ngày remote). Script này chỉ đụng file nhãn `offsite` của chính nó (local lẫn remote), nên mức giữ 14/30 ngày dưới đây không bao giờ
# xoá bản cron hay bản predeploy. Hai bên dùng chung thư mục backup và remote được.
#
# Remote PHẢI là rclone `crypt` (dump có SĐT, địa chỉ, tài khoản ngân hàng hoàn tiền của khách; xem tools/backup/README.md, mục "Mã hoá bản ngoài máy").
# Remote loại khác bị từ chối (thoát 3, không upload) trừ khi BACKUP_ALLOW_PLAIN_REMOTE=1, giống backup-db.sh.
#
# Biến môi trường (mặc định trong ngoặc):
#   COMPOSE_FILE (<repo>/docker-compose.vietnix.yml)  POSTGRES_USER (tubu)  POSTGRES_DB (tubutree)  BACKUP_DIR (/var/backups/tubutree)
#   RCLONE_REMOTE (rỗng = bỏ qua offsite, ví dụ tubucrypt: hoặc tubucrypt:tubutree-backups)
#   BACKUP_LABEL (offsite, chỉ chữ và số)
#   RETENTION_DAYS (14)            số ngày giữ bản nhãn này ở máy; cũ hơn thì xoá
#   OFFSITE_RETENTION_DAYS (30)    số ngày giữ bản nhãn này ở remote; chỉ dọn sau khi lần đẩy này đã kiểm thành công
#   BACKUP_ALLOW_PLAIN_REMOTE (0)
# Mã thoát: 0 xong (kể cả bỏ qua offsite), 1 sai cấu hình, 2 dump hỏng (không còn file dở), 3 bản local xong nhưng KHÔNG có bản ngoài máy.
#
# Ví dụ cron 03:47 mỗi ngày (xem ops/crontab.backup.example):
#   47 3 * * * RCLONE_REMOTE=tubucrypt: /opt/tubutree/ops/backup-offsite.sh >> /var/log/tubutree-backup-offsite.log 2>&1
set -euo pipefail
# Dump chứa dữ liệu khách và VPS dùng chung với app khác: mọi file/thư mục script tạo ra (kể cả file dở dang) chỉ chủ sở hữu đọc được.
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

case "${1:-}" in
  -h | --help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
  '') ;;
  *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 1 ;;
esac

POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.vietnix.yml}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
BACKUP_LABEL="${BACKUP_LABEL:-offsite}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
OFFSITE_RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"
BACKUP_ALLOW_PLAIN_REMOTE="${BACKUP_ALLOW_PLAIN_REMOTE:-0}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die_config() { log "ERROR: $*" >&2; exit 1; }

case "$BACKUP_LABEL" in
  '' | *[!A-Za-z0-9]*) die_config "BACKUP_LABEL chỉ gồm chữ và số, không rỗng (đang là '$BACKUP_LABEL')" ;;
esac
for n in RETENTION_DAYS OFFSITE_RETENTION_DAYS; do
  v="$(eval "printf '%s' \"\$$n\"")"
  case "$v" in
    '' | *[!0-9]*) die_config "$n phải là số nguyên dương (đang là '$v')" ;;
  esac
  [ "$v" -ge 1 ] || die_config "$n phải >= 1 (đang là '$v')"
done
[ -f "$COMPOSE_FILE" ] || die_config "Không tìm thấy compose file: $COMPOSE_FILE"

MARKER="$BACKUP_DIR/.last-offsite-ok"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/tubutree_${TIMESTAMP}_${BACKUP_LABEL}.sql.gz"
BACKUP_NAME="$(basename "$BACKUP_FILE")"
NAME_GLOB="tubutree_*_${BACKUP_LABEL}.sql.gz"

# Thư mục do script tạo thì 700. Thư mục đã có là của người vận hành chọn: không chmod.
[ -d "$BACKUP_DIR" ] || mkdir -p -m 700 "$BACKUP_DIR"

log "=== Bắt đầu backup offsite DB ${POSTGRES_DB} ==="
log "DIR=${BACKUP_DIR} LABEL=${BACKUP_LABEL} LOCAL=${RETENTION_DAYS}d OFFSITE=${OFFSITE_RETENTION_DAYS}d COMPOSE=${COMPOSE_FILE}"

install -m 600 /dev/null "$BACKUP_FILE"
log "Đang dump DB sang ${BACKUP_FILE} ..."
# pipefail: pg_dump lỗi thì cả đường ống lỗi, không đẩy file thiếu ra ngoài máy. Rỗng hoặc gzip hỏng cũng bị chặn ở đây, TRƯỚC khi đẩy đi.
if docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > "$BACKUP_FILE" && [ -s "$BACKUP_FILE" ] && gzip -t "$BACKUP_FILE"; then
  log "OK: dump xong ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  log "ERROR: dump thất bại, file rỗng hoặc gzip không hợp lệ: xoá file hỏng" >&2
  rm -f "$BACKUP_FILE"
  exit 2
fi

# Loại của remote (drive, crypt, s3...) theo `listremotes --long`: không in cấu hình nên không lộ khoá. Không thấy thì rỗng.
remote_type() { rclone listremotes --long 2>/dev/null | awk -v n="$1:" '$1 == n { print $2; exit }'; }

UPLOAD_FAILED=0
UPLOADED=0
if [ -z "$RCLONE_REMOTE" ]; then
  log "SKIP offsite (RCLONE_REMOTE unset): bản backup chỉ nằm trên cùng đĩa với Postgres, đĩa/VPS hỏng là mất cả hai."
elif ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: RCLONE_REMOTE đã đặt nhưng máy chưa cài rclone" >&2
  UPLOAD_FAILED=1
elif [ "$BACKUP_ALLOW_PLAIN_REMOTE" != 1 ] && [ "$(remote_type "${RCLONE_REMOTE%%:*}")" != crypt ]; then
  log "ERROR: remote '${RCLONE_REMOTE%%:*}' không phải rclone crypt: KHÔNG đẩy bản backup chưa mã hoá ra ngoài máy (xem tools/backup/README.md). Chỉ khi chủ chấp nhận rủi ro: BACKUP_ALLOW_PLAIN_REMOTE=1" >&2
  UPLOAD_FAILED=1
else
  log "Đang đẩy lên ${RCLONE_REMOTE} ..."
  REMOTE_LISTING=""
  if rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE"; then
    # Gán vào biến rồi mới grep: `grep -q` thoát sớm cộng pipefail có thể báo sai "không thấy" vì SIGPIPE.
    REMOTE_LISTING="$(rclone lsf "$RCLONE_REMOTE" --files-only --include "$BACKUP_NAME" 2>/dev/null || true)"
  else
    log "ERROR: đẩy bản backup ra ngoài máy thất bại, bản local vẫn giữ" >&2
    UPLOAD_FAILED=1
  fi
  if [ "$UPLOAD_FAILED" = 0 ] && ! grep -qxF "$BACKUP_NAME" <<<"$REMOTE_LISTING"; then
    log "ERROR: rclone báo đẩy xong nhưng không thấy ${BACKUP_NAME} ở ${RCLONE_REMOTE}, bản local vẫn giữ" >&2
    UPLOAD_FAILED=1
  fi
  if [ "$UPLOAD_FAILED" = 0 ]; then
    UPLOADED=1
    log "OK: đã đẩy và kiểm thấy ${BACKUP_NAME} ở ngoài máy"
    # Dấu thời điểm ghi nguyên tử (tệp tạm rồi mv): check-edge không bao giờ đọc phải dấu dở dang.
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BACKUP_NAME" > "$MARKER.tmp" && mv -f "$MARKER.tmp" "$MARKER" ||
      log "WARN: không ghi được ${MARKER}, check-edge sẽ báo offsite quá cũ"
    # Chỉ dọn remote sau khi bản mới đã kiểm có mặt, và chỉ file nhãn này: remote lỗi nhiều ngày không được làm mất bản cũ.
    rclone delete "$RCLONE_REMOTE" --max-depth 1 --min-age "${OFFSITE_RETENTION_DAYS}d" --include "$NAME_GLOB" ||
      log "WARN: dọn bản cũ trên ${RCLONE_REMOTE} lỗi"
  fi
fi

# Dọn local: chỉ file nhãn này, cũ hơn RETENTION_DAYS, và không bao giờ là file vừa tạo. Bản cron (tubutree_*_cron), predeploy và bản không nhãn không bị đụng.
# Upload lỗi thì KHÔNG dọn: bản offsite local cũ có thể là bản duy nhất chưa từng lên remote (remote hỏng > RETENTION_DAYS ngày).
DELETED=0
if [ "$UPLOAD_FAILED" -ne 0 ]; then
  log "Bỏ qua dọn bản ${BACKUP_LABEL} local: upload lỗi, giữ mọi bản chưa chắc đã lên remote" >&2
else
  log "Dọn bản ${BACKUP_LABEL} local cũ hơn ${RETENTION_DAYS} ngày ..."
  while IFS= read -r -d '' old; do
    [ "$old" = "$BACKUP_FILE" ] && continue
    rm -f -- "$old"
    DELETED=$((DELETED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$NAME_GLOB" -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null || true)
  log "Đã xoá ${DELETED} bản cũ"
fi

if [ "$UPLOAD_FAILED" -ne 0 ]; then
  log "=== Backup local xong nhưng KHÔNG có bản ngoài máy: ${BACKUP_FILE} ===" >&2
  exit 3
fi
if [ "$UPLOADED" = 1 ]; then
  log "=== Backup offsite hoàn tất: ${BACKUP_FILE} ==="
else
  log "=== Backup local hoàn tất (không offsite): ${BACKUP_FILE} ==="
fi
