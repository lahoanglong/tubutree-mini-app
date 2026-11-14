#!/usr/bin/env bash
# Trả Apache aaPanel của VPS về ĐÚNG trạng thái trước khi chạy ops/cutover-apex-apply.sh --apply. Chạy TRÊN VPS, quyền root. Thường < 2 giây.
#
#   bash ops/cutover-apex-rollback.sh              # gỡ vhost apex (hoặc trả bản cũ nếu từng có), configtest, graceful
#   bash ops/cutover-apex-rollback.sh --force      # gỡ cả khi tệp vhost không giống bản trong repo (mặc định từ chối xoá tệp lạ)
#   bash ops/cutover-apex-rollback.sh --help
#
# Trạng thái trước khi cài do apply ghi ở $BACKUP_DIR/.cutover-state (PRE_EXISTED=0|1) và, nếu từng có vhost, bản sao nguyên byte ở
# $BACKUP_DIR/apache-vhosts/pre-apply-<tên tệp>. Ngày 14/11/2026 VPS CHƯA có vhost tubutree.com nên rollback = gỡ tubutree.com.conf.
# Script chỉ `apachectl -t` rồi `apachectl -k graceful`: không `restart`, không đụng DNS, không đụng WordPress ở ZenCloud, không xoá ảnh uploads.
#
# QUAN TRỌNG: gỡ vhost KHÔNG kéo khách về WordPress. Nếu đã đổi A của tubutree.com về VPS thì phải đổi A về 42.1.122.84 ở Cloudflare TRƯỚC
# (TTL 300 giây); Apache không còn vhost apex thì https://tubutree.com rơi vào vhost mặc định (cert sai tên). Mã thoát: 0 xong, 1 lỗi, 3 sai tham số.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APACHECTL="${APACHECTL:-/www/server/apache/bin/apachectl}"
VHOST_DIR="${VHOST_DIR:-/www/server/panel/vhost/apache}"
VHOST_NAME="${VHOST_NAME:-tubutree.com.conf}"
VHOST_SRC="${VHOST_SRC:-$SELF_DIR/vietnix-vhost-apex.conf.cutover}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/tubutree-wp-precutover-20261114}"

FORCE=0
FROM_APPLY=0
usage() { sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --from-apply) FROM_APPLY=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 3 ;;
  esac
done

now_ms() { date +%s%3N 2>/dev/null || echo 0; }
START="$(now_ms)"
TARGET="$VHOST_DIR/$VHOST_NAME"
STATE="$BACKUP_DIR/.cutover-state"
PRE_COPY="$BACKUP_DIR/apache-vhosts/pre-apply-$VHOST_NAME"
[ "$(id -u)" = 0 ] || { echo "[FAIL] cần root" >&2; exit 1; }

pre_existed=""
[ -f "$STATE" ] && pre_existed="$(sed -n 's/^PRE_EXISTED=//p' "$STATE" | head -1)"

if [ "$pre_existed" = 1 ]; then
  [ -f "$PRE_COPY" ] || { echo "[FAIL] state ghi từng có vhost nhưng thiếu bản sao $PRE_COPY: không tự đoán" >&2; exit 1; }
  cp -a "$PRE_COPY" "$TARGET.tmp" && mv -f "$TARGET.tmp" "$TARGET" || { echo "[FAIL] không trả được vhost cũ" >&2; exit 1; }
  echo "[OK] đã trả vhost cũ nguyên byte từ $PRE_COPY"
elif [ -e "$TARGET" ]; then
  if [ "$FROM_APPLY" = 1 ] || [ "$FORCE" = 1 ] || { [ -f "$VHOST_SRC" ] && cmp -s "$TARGET" "$VHOST_SRC"; }; then
    rm -f "$TARGET"
    echo "[OK] đã gỡ $TARGET (trước khi cài chưa có tệp này)"
  else
    echo "[FAIL] $TARGET khác bản trong repo và không có state của apply: không xoá tệp lạ. Xem lại rồi chạy với --force nếu chắc." >&2
    exit 1
  fi
else
  echo "[OK] $TARGET không tồn tại, không có gì để gỡ"
fi
rm -f "$TARGET.tmp"

if ct_out="$($APACHECTL -t 2>&1)" && printf '%s' "$ct_out" | grep -q 'Syntax OK'; then
  if $APACHECTL -k graceful >/dev/null 2>&1; then
    echo "[OK] configtest sạch, graceful xong"
  else
    echo "[FAIL] apachectl -k graceful lỗi" >&2
    exit 1
  fi
else
  echo "[FAIL] configtest hỏng SAU khi gỡ vhost (không graceful để khỏi nạp cấu hình hỏng): $(printf '%s' "$ct_out" | head -3 | tr '\n' ' ')" >&2
  echo "       So với bản gốc: diff -r $BACKUP_DIR/apache-vhosts $VHOST_DIR (chỉ để xem; các tệp trong apache-vhosts/ là bản sao nguyên byte lúc 14/11/2026)" >&2
  exit 1
fi

for host_path in "app.tubutree.com/" "api.tubutree.com/api/home"; do
  host="${host_path%%/*}"
  code="$(curl -sk --max-time 15 -o /dev/null -w '%{http_code}' --resolve "$host:443:127.0.0.1" "https://$host_path" 2>/dev/null || echo 000)"
  echo "       $host trả $code"
done
rm -f "$STATE"
END="$(now_ms)"
echo "Rollback Apache xong trong $((END - START)) ms."
echo "Nhắc: đã đổi A của tubutree.com về VPS thì đổi về 42.1.122.84 ở Cloudflare (Apache một mình không đưa khách về WordPress)."
exit 0
