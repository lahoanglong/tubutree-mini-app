#!/usr/bin/env bash
# Kiểm phần backup của ops/check-edge.sh (hàm check_backup): tương thích ngược khi chưa bật offsite, bản mới nhất rỗng, tuổi dấu .last-offsite-ok.
# Nạp check-edge.sh bằng `source` (không gọi mạng; `$0` của bash -c phải KHÁC đường dẫn script, nếu không guard coi là chạy trực tiếp), chạy check_backup trên thư mục giả. Chạy được trên macOS (bash 3.2) và Linux.
#   bash ops/test-check-edge-backup.sh [đường-dẫn-check-edge.sh]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-edge.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1: thiếu '$3'"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then fail "$1: không được có '$3'"; else pass "$1"; fi; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: mong '$3', thực tế '$2'"; fi; }

# Dấu thời gian cho `touch -t` cách đây N giờ (GNU date rồi BSD date).
ago() { date -d "$1 hours ago" +%Y%m%d%H%M 2>/dev/null || date -v-"$1"H +%Y%m%d%H%M; }
# fresh_file <đường dẫn> [nội dung]: file có nội dung (mặc định "x"), mtime hiện tại.
fresh_file() { printf '%s' "${2:-x}" > "$1"; }
aged_file() { fresh_file "$1" "${3:-x}"; touch -t "$(ago "$2")" "$1"; }

# run_check [BIẾN=giá-trị ...]: chạy check_backup trên $D, đặt OUT.
run_check() {
  OUT="$(env BACKUP_DIR="$D" "$@" bash -c 'f="$1"; shift; source "$f"; check_backup' _ "$SCRIPT" 2>&1)"
}
setup() { D="$WORK/$1"; mkdir -p "$D"; }

echo "--- 1. không có thư mục backup: WARN như trước, không FAIL"
D="$WORK/không-có"
run_check
contains "WARN thiếu thư mục" "$OUT" "[WARN] backup: không thấy thư mục"
lacks "không FAIL" "$OUT" "[FAIL]"

echo "--- 2. thư mục rỗng: FAIL như trước"
setup t2
run_check
contains "FAIL chưa có file" "$OUT" "[FAIL] backup: $D chưa có file tubutree_*.sql.gz nào"

echo "--- 3. TƯƠNG THÍCH NGƯỢC: có backup mới, chưa bật offsite: OK, không WARN/FAIL nào, offsite chỉ là INFO"
setup t3
fresh_file "$D/tubutree_20261114_000000_cron.sql.gz"
run_check
contains "OK backup mới" "$OUT" "[ OK ] backup: bản mới nhất trong 8 giờ qua (tubutree_20261114_000000_cron.sql.gz)"
contains "INFO offsite chưa bật" "$OUT" "[INFO] backup offsite: chưa bật"
lacks "không WARN" "$OUT" "[WARN]"
lacks "không FAIL" "$OUT" "[FAIL]"

echo "--- 4. backup cũ quá BACKUP_MAX_AGE_HOURS: WARN như trước; đổi ngưỡng bằng biến"
setup t4
aged_file "$D/tubutree_20261110_000000_cron.sql.gz" 12
run_check
contains "WARN backup cũ" "$OUT" "[WARN] backup: bản mới nhất (tubutree_20261110_000000_cron.sql.gz) cũ hơn 8 giờ"
run_check BACKUP_MAX_AGE_HOURS=24
contains "ngưỡng 24 giờ: OK" "$OUT" "[ OK ] backup: bản mới nhất trong 24 giờ qua"

echo "--- 5. bản mới nhất rỗng (0 byte) nhưng có bản cũ hơn đầy đủ: WARN về file rỗng, vẫn đánh giá bản đầy đủ"
setup t5
aged_file "$D/tubutree_20261114_000000_cron.sql.gz" 3
: > "$D/tubutree_20261114_060000_cron.sql.gz"
run_check
contains "WARN file rỗng" "$OUT" "[WARN] backup: tubutree_20261114_060000_cron.sql.gz rỗng (0 byte)"
contains "OK bản đầy đủ còn mới" "$OUT" "[ OK ] backup: bản mới nhất trong 8 giờ qua (tubutree_20261114_000000_cron.sql.gz)"
lacks "không FAIL" "$OUT" "[FAIL]"

echo "--- 5b. MỌI file rỗng: FAIL"
setup t5b
: > "$D/tubutree_20261114_060000_cron.sql.gz"
run_check
contains "FAIL toàn file rỗng" "$OUT" "[FAIL] backup: mọi file tubutree_*.sql.gz"

echo "--- 5c. file rỗng cũ + bản đầy đủ cũ hơn BACKUP_MAX_AGE_HOURS: chỉ WARN backup cũ (không đếm file rỗng là bản mới)"
setup t5c
aged_file "$D/tubutree_20261110_000000_cron.sql.gz" 20
: > "$D/tubutree_20261114_060000_cron.sql.gz"
run_check
contains "WARN backup cũ tính theo bản đầy đủ" "$OUT" "[WARN] backup: bản mới nhất (tubutree_20261110_000000_cron.sql.gz) cũ hơn 8 giờ"
lacks "không có OK backup" "$OUT" "[ OK ] backup: bản mới nhất trong"

echo "--- 6. dấu .last-offsite-ok còn mới: OK"
setup t6
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"
fresh_file "$D/.last-offsite-ok" "2026-11-14T00:00:00Z tubutree_20261114_000000_offsite.sql.gz"
run_check
contains "OK offsite" "$OUT" "[ OK ] backup offsite: lần đẩy ra ngoài máy gần nhất trong 30 giờ qua"
lacks "không FAIL" "$OUT" "[FAIL]"
lacks "không WARN" "$OUT" "[WARN]"

echo "--- 7. dấu cũ hơn 30 giờ (nhưng chưa tới 90): WARN"
setup t7
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"
aged_file "$D/.last-offsite-ok" 40
run_check
contains "WARN offsite" "$OUT" "[WARN] backup offsite: lần đẩy ra ngoài máy gần nhất cũ hơn 30 giờ"
lacks "không FAIL" "$OUT" "[FAIL]"

echo "--- 8. dấu cũ hơn 90 giờ: FAIL"
setup t8
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"
aged_file "$D/.last-offsite-ok" 100
run_check
contains "FAIL offsite" "$OUT" "[FAIL] backup offsite: lần đẩy ra ngoài máy gần nhất cũ hơn 90 giờ"

echo "--- 9. OFFSITE_MAX_AGE_HOURS đổi được (dấu 40 giờ, ngưỡng 48: OK; ngưỡng 10: FAIL vì 40 > 30)"
setup t9
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"
aged_file "$D/.last-offsite-ok" 40
run_check OFFSITE_MAX_AGE_HOURS=48
contains "ngưỡng 48 giờ: OK" "$OUT" "[ OK ] backup offsite: lần đẩy ra ngoài máy gần nhất trong 48 giờ qua"
run_check OFFSITE_MAX_AGE_HOURS=10
contains "ngưỡng 10 giờ: FAIL" "$OUT" "[FAIL] backup offsite: lần đẩy ra ngoài máy gần nhất cũ hơn 30 giờ"

echo "--- 10. dấu offsite còn mới KHÔNG che backup local quá cũ"
setup t10
aged_file "$D/tubutree_20261110_000000_offsite.sql.gz" 50
fresh_file "$D/.last-offsite-ok" "x"
run_check
contains "vẫn WARN backup local cũ" "$OUT" "[WARN] backup: bản mới nhất"
contains "offsite OK" "$OUT" "[ OK ] backup offsite"

echo "--- 11. cờ dòng lệnh: --offsite-max-hours hợp lệ/không hợp lệ, --help nêu cờ, tham số lạ vẫn thoát 2"
OUT="$(bash "$SCRIPT" --offsite-max-hours abc 2>&1)"; check "--offsite-max-hours abc thoát 2" "$?" 2
OUT="$(bash "$SCRIPT" --offsite-max-hours 2>&1)"; check "--offsite-max-hours thiếu giá trị thoát 2" "$?" 2
OUT="$(bash "$SCRIPT" --help 2>&1)"; check "--help thoát 0" "$?" 0
contains "--help nêu cờ mới" "$OUT" "--offsite-max-hours"
OUT="$(bash "$SCRIPT" --bogus 2>&1)"; check "tham số lạ thoát 2" "$?" 2

echo "--- 12. nạp bằng source không chạy kiểm mạng"
OUT="$(env BACKUP_DIR="$WORK/không-có" bash -c 'f="$1"; shift; source "$f"; echo nạp-xong' _ "$SCRIPT" 2>&1)"
check "chỉ nạp, không in bảng kiểm" "$OUT" "nạp-xong"

echo "--- 13. cron offsite đã bật nhưng upload lỗi mỗi đêm (có bản nhãn offsite, chưa từng có dấu): WARN, không còn im lặng"
setup t13
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"
run_check
contains "WARN chưa từng đẩy thành công" "$OUT" "[WARN] backup offsite: có bản nhãn offsite nhưng chưa từng đẩy thành công"
lacks "không INFO chưa bật" "$OUT" "chưa bật"
setup t13b
fresh_file "$D/tubutree_20261114_000000_cron.sql.gz"
run_check
contains "chỉ có bản cron: vẫn INFO chưa bật (tương thích ngược)" "$OUT" "[INFO] backup offsite: chưa bật"
lacks "không WARN offsite" "$OUT" "chưa từng đẩy thành công"
setup t13c
fresh_file "$D/tubutree_20261114_000000_offsite.sql.gz"; fresh_file "$D/.last-offsite-ok" "x"
run_check
contains "có dấu mới: OK như cũ" "$OUT" "[ OK ] backup offsite: lần đẩy ra ngoài máy gần nhất trong 30 giờ qua"
lacks "có dấu: không WARN chưa từng" "$OUT" "chưa từng đẩy thành công"

echo "--- 14. chạy từ stdin (ssh vps 'bash -s' < check-edge.sh): guard không chết vì BASH_SOURCE[0] chưa đặt (set -u)"
OUT="$({ echo 'set -u; main() { echo MAIN_RAN; }'; grep '^if \[ "\${BASH_SOURCE' "$SCRIPT"; } | bash -s 2>&1)"
check "stdin: guard gọi main, không lỗi unbound" "$OUT" "MAIN_RAN"

exit "$FAILED"
