#!/usr/bin/env bash
# Kiểm quyền file của backup-db.sh: dump 600, thư mục do script tạo 700, thư mục có sẵn không bị chmod mà có WARN.
# Không cần Docker: `docker` giả trên PATH in ra SQL giả thay cho pg_dump.
#   bash tools/backup/test-backup-perms.sh [đường-dẫn-backup-db.sh]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-db.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${FAKE_DOCKER_FAIL:-0}" = 1 ]; then exit 1; fi
echo "-- fake pg_dump"
STUB
chmod +x "$WORK/bin/docker"
: > "$WORK/compose.yml"

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
FAILED=0
check() {
  if [ "$2" = "$3" ]; then echo "ok   $1 ($2)"; else echo "FAIL $1: mong $3, thực tế $2"; FAILED=1; fi
}
run_backup() {
  # umask 000 cố ý: script phải tự siết, không dựa vào umask của người gọi.
  ( umask 000; PATH="$WORK/bin:$PATH" COMPOSE_FILE="$WORK/compose.yml" BACKUP_DIR="$1" \
    HEALTHCHECK_OPTIONAL=1 bash "$SCRIPT" ) 2>&1
}

echo "--- 1. thư mục chưa có: script tạo"
D1="$WORK/new/backups"
run_backup "$D1" > "$WORK/out1" || { echo "FAIL backup lỗi"; cat "$WORK/out1"; FAILED=1; }
check "thư mục mới" "$(mode_of "$D1")" 700
F1="$(ls "$D1"/tubutree_*.sql.gz 2>/dev/null | head -1)"
if [ -n "$F1" ]; then check "dump trong thư mục mới" "$(mode_of "$F1")" 600; else echo "FAIL không có file dump"; FAILED=1; fi

echo "--- 2. thư mục có sẵn mode 755: không chmod, có WARN, dump vẫn 600"
D2="$WORK/shared"; mkdir "$D2"; chmod 755 "$D2"
run_backup "$D2" > "$WORK/out2" || { echo "FAIL backup lỗi"; cat "$WORK/out2"; FAILED=1; }
check "thư mục có sẵn giữ nguyên" "$(mode_of "$D2")" 755
F2="$(ls "$D2"/tubutree_*.sql.gz 2>/dev/null | head -1)"
if [ -n "$F2" ]; then check "dump trong thư mục có sẵn" "$(mode_of "$F2")" 600; else echo "FAIL không có file dump"; FAILED=1; fi
if grep -q 'WARN: .*mode 755' "$WORK/out2"; then echo "ok   có cảnh báo thư mục mở"; else echo "FAIL thiếu cảnh báo thư mục mở"; FAILED=1; fi

echo "--- 3. thư mục có sẵn 700: không cảnh báo"
D3="$WORK/private"; mkdir "$D3"; chmod 700 "$D3"
run_backup "$D3" > "$WORK/out3" || { echo "FAIL backup lỗi"; FAILED=1; }
if grep -q 'WARN: .*mode' "$WORK/out3"; then echo "FAIL cảnh báo thừa"; FAILED=1; else echo "ok   không cảnh báo"; fi

echo "--- 3b. thư mục có sẵn chứa dump cũ mode 644: bị siết 600"
D3B="$WORK/legacy"; mkdir "$D3B"; chmod 700 "$D3B"
: > "$D3B/tubutree_20200101_000000.sql.gz"; chmod 644 "$D3B/tubutree_20200101_000000.sql.gz"
run_backup "$D3B" > "$WORK/out3b" || { echo "FAIL backup lỗi"; FAILED=1; }
check "dump cũ" "$(mode_of "$D3B/tubutree_20200101_000000.sql.gz")" 600

echo "--- 4. pg_dump lỗi: không để lại file dở dang"
D4="$WORK/fail"
FAKE_DOCKER_FAIL=1 run_backup "$D4" > "$WORK/out4"; RC=$?
check "exit code khi dump lỗi" "$RC" 2
check "số file còn lại" "$(ls "$D4" | wc -l | tr -d ' ')" 0

exit "$FAILED"
