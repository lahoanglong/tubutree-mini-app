#!/usr/bin/env bash
# Kiểm các nhánh của ops/backup-offsite.sh bằng `docker`, `gzip` và `rclone` giả: bỏ qua offsite khi thiếu RCLONE_REMOTE, file rỗng/gzip hỏng,
# remote không phải crypt, upload lỗi hoặc không thấy file ở remote, dọn bản cũ chỉ đúng nhãn của script, quyền file, dấu .last-offsite-ok.
# Không cần Docker, rclone hay mạng. Chạy được trên macOS (bash 3.2) và Linux.
#   bash ops/test-backup-offsite.sh [đường-dẫn-backup-offsite.sh]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-offsite.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REAL_GZIP="$(command -v gzip)"
FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: mong '$3', thực tế '$2'"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1: thiếu '$3'"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then fail "$1: không được có '$3'"; else pass "$1"; fi; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

mkdir "$WORK/bin" "$WORK/bin-norclone"
# docker giả: in SQL giả thay pg_dump; FAKE_DOCKER_FAIL=1 thì lỗi.
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${FAKE_DOCKER_FAIL:-0}" = 1 ]; then exit 1; fi
echo "-- fake pg_dump"
echo "CREATE TABLE t (id int);"
STUB
# gzip giả: GZIP_MODE=empty (exit 0, không ghi gì), garbage (ghi rác, không phải gzip); còn lại và mọi lần `-t`/`-d` dùng gzip thật.
cat > "$WORK/bin/gzip" <<STUB
#!/usr/bin/env bash
case " \$* " in *" -t "* | *" -d "*) exec "$REAL_GZIP" "\$@" ;; esac
case "\${GZIP_MODE:-}" in
  empty) cat >/dev/null; exit 0 ;;
  garbage) cat >/dev/null; echo "not gzip data"; exit 0 ;;
esac
exec "$REAL_GZIP" "\$@"
STUB
# rclone giả: remote là thư mục \$REMOTE_DIR. RCLONE_TYPE = loại remote báo ở listremotes (mặc định crypt); RCLONE_FAIL_COPY=1 copy lỗi;
# RCLONE_LOSE=1 copy "thành công" nhưng không lưu file (để thử bước kiểm remote); RCLONE_FAIL_DELETE=1 delete lỗi.
cat > "$WORK/bin/rclone" <<'STUB'
#!/usr/bin/env bash
echo "rclone $*" >> "$RCLONE_LOG"
case "$1" in
  listremotes) printf '%s:  %s\n' "${RCLONE_NAME:-tubucrypt}" "${RCLONE_TYPE:-crypt}" ;;
  copy)
    [ "${RCLONE_FAIL_COPY:-0}" = 1 ] && exit 1
    [ "${RCLONE_LOSE:-0}" = 1 ] || cp "$2" "$REMOTE_DIR/"
    ;;
  lsf)
    inc=""
    while [ $# -gt 0 ]; do [ "$1" = --include ] && inc="$2"; shift; done
    ls "$REMOTE_DIR" | grep -Fx -- "$inc" || true
    ;;
  delete)
    [ "${RCLONE_FAIL_DELETE:-0}" = 1 ] && exit 1
    days=""; glob=""
    shift
    while [ $# -gt 0 ]; do
      case "$1" in --min-age) days="${2%d}" ;; --include) glob="$2" ;; esac
      shift
    done
    find "$REMOTE_DIR" -maxdepth 1 -type f -name "$glob" -mtime "+$days" -exec rm -f {} +
    ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/"*
# PATH không có rclone: chỉ các lệnh hệ thống cần thiết (docker/gzip giả vẫn có).
cp "$WORK/bin/docker" "$WORK/bin/gzip" "$WORK/bin-norclone/"

: > "$WORK/compose.yml"
OLD_STAMP=202001010000 # touch -t: 2020-01-01, cũ hơn mọi mức giữ

# setup <tên>: D = thư mục kịch bản (BACKUP_DIR mới, REMOTE_DIR rỗng).
setup() {
  D="$WORK/$1"
  mkdir -p "$D/remote"
  : > "$D/rclone.log"
}
# run_off [BIẾN=giá-trị ...]: chạy script với umask 000 (script phải tự siết). OUT, RC.
run_off() {
  OUT="$( ( umask 000; env PATH="${USE_PATH:-$WORK/bin}:$PATH" COMPOSE_FILE="$WORK/compose.yml" BACKUP_DIR="${BACKUP_DIR_OVERRIDE:-$D/backups}" \
    RCLONE_LOG="$D/rclone.log" REMOTE_DIR="$D/remote" "$@" bash "$SCRIPT" ) 2>&1 )"
  RC=$?
}
newest_local() { ls "${BACKUP_DIR_OVERRIDE:-$D/backups}"/tubutree_*_offsite.sql.gz 2>/dev/null | tail -1; }
count_local() { ls "${BACKUP_DIR_OVERRIDE:-$D/backups}"/tubutree_*_offsite.sql.gz 2>/dev/null | wc -l | tr -d ' '; }

echo "--- 1. RCLONE_REMOTE chưa đặt: không gãy backup local, in SKIP, không đụng dấu offsite"
setup t1
run_off
check "thoát 0" "$RC" 0
contains "in SKIP offsite" "$OUT" "SKIP offsite (RCLONE_REMOTE unset)"
check "có đúng 1 dump local" "$(count_local)" 1
F="$(newest_local)"
gzip -t "$F" 2>/dev/null && pass "dump gzip hợp lệ" || fail "dump gzip hỏng"
[ -s "$F" ] && pass "dump > 0 byte" || fail "dump rỗng"
check "dump mode 600" "$(mode_of "$F")" 600
check "thư mục mới mode 700" "$(mode_of "$D/backups")" 700
[ -e "$D/backups/.last-offsite-ok" ] && fail "không được tạo dấu offsite khi bỏ qua" || pass "không tạo dấu .last-offsite-ok"
check "không gọi rclone" "$(wc -l < "$D/rclone.log" | tr -d ' ')" 0

echo "--- 2. remote crypt: đẩy, kiểm có mặt, ghi dấu .last-offsite-ok (mode 600, có tên file)"
setup t2
run_off RCLONE_REMOTE=tubucrypt:
check "thoát 0" "$RC" 0
F="$(newest_local)"; NAME="$(basename "$F")"
[ -f "$D/remote/$NAME" ] && pass "remote có $NAME" || fail "remote thiếu $NAME"
M="$D/backups/.last-offsite-ok"
[ -s "$M" ] && pass "có dấu .last-offsite-ok" || fail "thiếu dấu .last-offsite-ok"
contains "dấu ghi tên file" "$(cat "$M" 2>/dev/null)" "$NAME"
check "dấu mode 600" "$(mode_of "$M")" 600
[ -e "$M.tmp" ] && fail "tệp tạm của dấu còn sót" || pass "không còn tệp tạm"
contains "log OK ngoài máy" "$OUT" "OK: đã đẩy và kiểm thấy $NAME"

echo "--- 3. dọn local: chỉ bản nhãn offsite cũ hơn RETENTION_DAYS; bản cron/predeploy/không nhãn cũ KHÔNG bị xoá"
setup t3
mkdir -p "$D/backups"; chmod 700 "$D/backups"
for n in tubutree_20200101_010101_offsite.sql.gz tubutree_20200101_020202_cron.sql.gz tubutree_20200101_030303_predeploy.sql.gz tubutree_20200101_040404.sql.gz; do
  echo x > "$D/backups/$n"; touch -t $OLD_STAMP "$D/backups/$n"
done
echo x > "$D/backups/tubutree_20261110_010101_offsite.sql.gz" # mới (mtime hiện tại): giữ
run_off
check "thoát 0" "$RC" 0
[ -e "$D/backups/tubutree_20200101_010101_offsite.sql.gz" ] && fail "bản offsite cũ chưa bị xoá" || pass "xoá bản offsite cũ"
for n in tubutree_20200101_020202_cron.sql.gz tubutree_20200101_030303_predeploy.sql.gz tubutree_20200101_040404.sql.gz tubutree_20261110_010101_offsite.sql.gz; do
  [ -e "$D/backups/$n" ] && pass "còn $n" || fail "xoá nhầm $n"
done
F="$(newest_local)"; [ -s "$F" ] && pass "dump mới vẫn còn" || fail "dump mới biến mất"
contains "log số bản đã xoá" "$OUT" "Đã xoá 1 bản cũ"

echo "--- 3b. RETENTION_DAYS đổi được; file vừa tạo không bao giờ bị dọn"
setup t3b
mkdir -p "$D/backups"; chmod 700 "$D/backups"
echo x > "$D/backups/tubutree_20261101_010101_offsite.sql.gz"; touch -t 202611010000 "$D/backups/tubutree_20261101_010101_offsite.sql.gz"
run_off RETENTION_DAYS=1
[ -e "$D/backups/tubutree_20261101_010101_offsite.sql.gz" ] && fail "RETENTION_DAYS=1 không xoá bản cũ" || pass "RETENTION_DAYS=1 xoá bản cũ"
check "dump mới còn" "$(count_local)" 1

echo "--- 4. dọn remote: chỉ nhãn offsite, cũ hơn OFFSITE_RETENTION_DAYS, và chỉ sau khi đẩy xong"
setup t4
for n in tubutree_20200101_010101_offsite.sql.gz tubutree_20200101_020202_cron.sql.gz; do echo x > "$D/remote/$n"; touch -t $OLD_STAMP "$D/remote/$n"; done
run_off RCLONE_REMOTE=tubucrypt:
check "thoát 0" "$RC" 0
[ -e "$D/remote/tubutree_20200101_010101_offsite.sql.gz" ] && fail "bản offsite cũ ở remote còn" || pass "xoá bản offsite cũ ở remote"
[ -e "$D/remote/tubutree_20200101_020202_cron.sql.gz" ] && pass "bản cron ở remote còn nguyên" || fail "xoá nhầm bản cron ở remote"
contains "delete dùng --min-age 30d" "$(cat "$D/rclone.log")" "--min-age 30d"
contains "delete giới hạn theo nhãn" "$(cat "$D/rclone.log")" "--include tubutree_*_offsite.sql.gz"
contains "delete không đệ quy vào thư mục con của remote" "$(cat "$D/rclone.log")" "--max-depth 1"
setup t4b
echo x > "$D/remote/tubutree_20200101_010101_offsite.sql.gz"; touch -t $OLD_STAMP "$D/remote/tubutree_20200101_010101_offsite.sql.gz"
run_off RCLONE_REMOTE=tubucrypt: OFFSITE_RETENTION_DAYS=3650
[ -e "$D/remote/tubutree_20200101_010101_offsite.sql.gz" ] && pass "OFFSITE_RETENTION_DAYS=3650 giữ bản 2020" || fail "OFFSITE_RETENTION_DAYS không có tác dụng"

echo "--- 5. remote KHÔNG phải crypt: từ chối, thoát 3, bản local giữ, không dấu; BACKUP_ALLOW_PLAIN_REMOTE=1 thì cho"
setup t5
run_off RCLONE_REMOTE=gdrive:tubutree-backups RCLONE_NAME=gdrive RCLONE_TYPE=drive
check "thoát 3" "$RC" 3
contains "báo không phải crypt" "$OUT" "không phải rclone crypt"
check "bản local giữ" "$(count_local)" 1
check "remote trống" "$(ls "$D/remote" | wc -l | tr -d ' ')" 0
[ -e "$D/backups/.last-offsite-ok" ] && fail "không được ghi dấu khi bị từ chối" || pass "không ghi dấu"
lacks "không gọi rclone copy" "$(cat "$D/rclone.log")" "rclone copy"
setup t5b
run_off RCLONE_REMOTE=gdrive:tubutree-backups RCLONE_NAME=gdrive RCLONE_TYPE=drive BACKUP_ALLOW_PLAIN_REMOTE=1
check "ALLOW_PLAIN thoát 0" "$RC" 0
check "ALLOW_PLAIN có file ở remote" "$(ls "$D/remote" | wc -l | tr -d ' ')" 1

echo "--- 5b. remote không có trong cấu hình rclone (listremotes rỗng): từ chối"
setup t5c
run_off RCLONE_REMOTE=nonexist: RCLONE_NAME=other RCLONE_TYPE=crypt
check "thoát 3" "$RC" 3

echo "--- 6. rclone copy lỗi: thoát 3, bản local giữ, dấu cũ KHÔNG bị làm mới, remote không bị dọn"
setup t6
mkdir -p "$D/backups"; chmod 700 "$D/backups"
echo "2020-01-01T00:00:00Z tubutree_old_offsite.sql.gz" > "$D/backups/.last-offsite-ok"; touch -t $OLD_STAMP "$D/backups/.last-offsite-ok"
echo x > "$D/remote/tubutree_20200101_010101_offsite.sql.gz"; touch -t $OLD_STAMP "$D/remote/tubutree_20200101_010101_offsite.sql.gz"
run_off RCLONE_REMOTE=tubucrypt: RCLONE_FAIL_COPY=1
check "thoát 3" "$RC" 3
check "bản local giữ" "$(count_local)" 1
check "dấu cũ nguyên văn" "$(cat "$D/backups/.last-offsite-ok")" "2020-01-01T00:00:00Z tubutree_old_offsite.sql.gz"
[ -n "$(find "$D/backups/.last-offsite-ok" -mtime +30 2>/dev/null)" ] && pass "mtime dấu vẫn cũ" || fail "dấu bị làm mới dù upload lỗi"
[ -e "$D/remote/tubutree_20200101_010101_offsite.sql.gz" ] && pass "remote không bị dọn khi upload lỗi" || fail "dọn remote dù upload lỗi"
lacks "không gọi rclone delete" "$(cat "$D/rclone.log")" "rclone delete"

echo "--- 6a. upload lỗi: KHÔNG dọn bản offsite local cũ (có thể là bản duy nhất chưa lên remote); upload thành công thì dọn như cũ"
setup t6a
mkdir -p "$D/backups"; chmod 700 "$D/backups"
echo x > "$D/backups/tubutree_20200101_010101_offsite.sql.gz"; touch -t $OLD_STAMP "$D/backups/tubutree_20200101_010101_offsite.sql.gz"
run_off RCLONE_REMOTE=tubucrypt: RCLONE_FAIL_COPY=1
check "thoát 3" "$RC" 3
[ -e "$D/backups/tubutree_20200101_010101_offsite.sql.gz" ] && pass "giữ bản offsite cũ khi upload lỗi" || fail "xoá bản offsite cũ dù upload lỗi"
contains "log nói bỏ qua dọn" "$OUT" "Bỏ qua dọn bản offsite local"
lacks "không in 'Đã xoá' khi bỏ qua" "$OUT" "Đã xoá"
setup t6a2
mkdir -p "$D/backups"; chmod 700 "$D/backups"
echo x > "$D/backups/tubutree_20200101_010101_offsite.sql.gz"; touch -t $OLD_STAMP "$D/backups/tubutree_20200101_010101_offsite.sql.gz"
run_off RCLONE_REMOTE=tubucrypt:
[ -e "$D/backups/tubutree_20200101_010101_offsite.sql.gz" ] && fail "upload thành công mà không dọn bản cũ" || pass "upload thành công: dọn bản cũ"
setup t6a3
mkdir -p "$D/backups"; chmod 700 "$D/backups"
echo x > "$D/backups/tubutree_20200101_010101_offsite.sql.gz"; touch -t $OLD_STAMP "$D/backups/tubutree_20200101_010101_offsite.sql.gz"
run_off RCLONE_REMOTE=gdrive:x RCLONE_NAME=gdrive RCLONE_TYPE=drive
check "remote không phải crypt: thoát 3" "$RC" 3
[ -e "$D/backups/tubutree_20200101_010101_offsite.sql.gz" ] && pass "giữ bản cũ khi remote bị từ chối" || fail "xoá bản cũ dù remote bị từ chối"

echo "--- 6b. rclone báo xong nhưng file không có ở remote: coi là lỗi, thoát 3, không dấu"
setup t6b
run_off RCLONE_REMOTE=tubucrypt: RCLONE_LOSE=1
check "thoát 3" "$RC" 3
contains "báo không thấy file" "$OUT" "không thấy"
[ -e "$D/backups/.last-offsite-ok" ] && fail "không được ghi dấu" || pass "không ghi dấu"

echo "--- 6c. dọn remote lỗi: chỉ WARN, backup vẫn thành công và có dấu"
setup t6c
run_off RCLONE_REMOTE=tubucrypt: RCLONE_FAIL_DELETE=1
check "thoát 0" "$RC" 0
contains "WARN dọn remote" "$OUT" "WARN: dọn bản cũ"
[ -s "$D/backups/.last-offsite-ok" ] && pass "vẫn có dấu" || fail "thiếu dấu"

echo "--- 7. RCLONE_REMOTE đặt nhưng máy không có rclone: thoát 3, bản local giữ"
setup t7
USE_PATH="$WORK/bin-norclone" run_off RCLONE_REMOTE=tubucrypt:
check "thoát 3" "$RC" 3
contains "báo thiếu rclone" "$OUT" "chưa cài rclone"
check "bản local giữ" "$(count_local)" 1

echo "--- 8. pg_dump lỗi: thoát 2, không để lại file dở, không gọi rclone, dấu giữ nguyên"
setup t8
mkdir -p "$D/backups"; chmod 700 "$D/backups"
run_off FAKE_DOCKER_FAIL=1 RCLONE_REMOTE=tubucrypt:
check "thoát 2" "$RC" 2
check "không còn file dump" "$(count_local)" 0
check "không còn file nào trong thư mục" "$(ls -A "$D/backups" | wc -l | tr -d ' ')" 0
check "không gọi rclone" "$(wc -l < "$D/rclone.log" | tr -d ' ')" 0

echo "--- 8b. gzip tạo file rỗng (0 byte): thoát 2, file bị xoá, KHÔNG đẩy đi"
setup t8b
run_off GZIP_MODE=empty RCLONE_REMOTE=tubucrypt:
check "thoát 2" "$RC" 2
check "không còn file dump" "$(count_local)" 0
check "không gọi rclone" "$(wc -l < "$D/rclone.log" | tr -d ' ')" 0
check "remote trống" "$(ls "$D/remote" | wc -l | tr -d ' ')" 0

echo "--- 8c. file không phải gzip hợp lệ: thoát 2, file bị xoá, KHÔNG đẩy đi"
setup t8c
run_off GZIP_MODE=garbage RCLONE_REMOTE=tubucrypt:
check "thoát 2" "$RC" 2
check "không còn file dump" "$(count_local)" 0
check "không gọi rclone" "$(wc -l < "$D/rclone.log" | tr -d ' ')" 0

echo "--- 9. cấu hình sai: thoát 1, chưa dump gì"
for kv in RETENTION_DAYS=0 RETENTION_DAYS=abc OFFSITE_RETENTION_DAYS=0 OFFSITE_RETENTION_DAYS=-5 'BACKUP_LABEL=a-b' 'BACKUP_LABEL=a b'; do
  setup t9
  run_off "$kv"
  check "$kv thoát 1" "$RC" 1
  [ -d "$D/backups" ] && fail "$kv: đã tạo thư mục backup trước khi kiểm cấu hình" || pass "$kv: chưa đụng đĩa"
done
setup t9b
OUT="$( ( env PATH="$WORK/bin:$PATH" COMPOSE_FILE="$WORK/không-có.yml" BACKUP_DIR="$D/backups" bash "$SCRIPT" ) 2>&1 )"; RC=$?
check "thiếu compose file thoát 1" "$RC" 1
OUT="$(bash "$SCRIPT" --bogus 2>&1)"; RC=$?
check "tham số lạ thoát 1" "$RC" 1
OUT="$(bash "$SCRIPT" --help 2>&1)"; RC=$?
check "--help thoát 0" "$RC" 0
contains "--help nêu RCLONE_REMOTE" "$OUT" "RCLONE_REMOTE"

echo "--- 10. thư mục backup có sẵn mode 755: không bị chmod; dump vẫn 600"
setup t10
mkdir -p "$D/shared"; chmod 755 "$D/shared"
BACKUP_DIR_OVERRIDE="$D/shared" run_off
check "thoát 0" "$RC" 0
check "thư mục giữ 755" "$(mode_of "$D/shared")" 755
check "dump 600" "$(mode_of "$(BACKUP_DIR_OVERRIDE="$D/shared" newest_local)")" 600

echo "--- 11. nhãn đổi được và tên file đúng mẫu tubutree_<ngày>_<giờ>_<nhãn>.sql.gz"
setup t11
run_off BACKUP_LABEL=weekly
F="$(ls "$D/backups"/tubutree_*_weekly.sql.gz 2>/dev/null | head -1)"
case "$(basename "${F:-x}")" in
  tubutree_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]_weekly.sql.gz) pass "tên file đúng mẫu" ;;
  *) fail "tên file sai mẫu: ${F:-<không có>}" ;;
esac

exit "$FAILED"
