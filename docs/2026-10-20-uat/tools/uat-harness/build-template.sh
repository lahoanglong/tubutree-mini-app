#!/usr/bin/env bash
# Dựng DB mẫu tubutree_uat_tpl MỘT lần (lane copy bằng CREATE DATABASE ... TEMPLATE):
#   createdb → prisma migrate deploy → seed.ts → seed-reference.ts --with-business-defaults
#   → bật lane 9 (API 3291 + giả Pancake 3298, Redis db 15) → seed-roles.mjs 9 (người dùng theo vai trò, qua API thật) → tắt lane 9.
# Mẫu không được còn kết nối mở khi lane copy: script kiểm ở cuối.
# Dùng: build-template.sh            (xoá và dựng lại mẫu; DB lane đã copy trước đó KHÔNG bị đụng)
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
H=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$H/../../../.." && pwd)
TOOLS=$(cd "$H/.." && pwd)
API_DIR=$WT/apps/api
DB=tubutree_uat_tpl
URL="postgresql://tubu@127.0.0.1:25432/$DB?schema=public"
LOG=$H/state/lane-9/logs; mkdir -p "$LOG"
step() { echo "== $(date +%H:%M:%S) $*"; }
fail() { echo "LỖI: $*" >&2; "$H/lane-down.sh" 9 >/dev/null 2>&1; exit 1; }

"$H/lane-down.sh" 9 >/dev/null 2>&1
step "createdb $DB"
"$TOOLS/pg-native.sh" createdb 25432 $DB > "$LOG/createdb.log" 2>&1 || fail "createdb (xem $LOG/createdb.log)"
cd "$API_DIR" || exit 1
step "prisma migrate deploy"
DATABASE_URL="$URL" npx prisma migrate deploy > "$LOG/migrate.log" 2>&1 || fail "migrate (xem $LOG/migrate.log)"
tail -1 "$LOG/migrate.log"
step "seed.ts"
DATABASE_URL="$URL" npx tsx prisma/seed.ts > "$LOG/seed.log" 2>&1 || fail "seed.ts (xem $LOG/seed.log)"
tail -1 "$LOG/seed.log"
step "seed-reference.ts --with-business-defaults"
DATABASE_URL="$URL" npx tsx prisma/seed-reference.ts --with-business-defaults > "$LOG/seed-ref.log" 2>&1 || fail "seed-reference (xem $LOG/seed-ref.log)"
tail -1 "$LOG/seed-ref.log"
cd "$H" || exit 1
node "$H/lane-db.mjs" flush-redis 9 >/dev/null
rm -rf "$H/state/lane-9/pancake"
step "bật lane 9 (API 3291, giả Pancake 3298)"
"$H/lane-up.sh" 9 --no-mini || fail "lane-up 9"
step "seed-roles.mjs 9"
node "$H/seed-roles.mjs" 9 2>&1 | tee "$LOG/seed-roles.log"
[ "${PIPESTATUS[0]}" = 0 ] || fail "seed-roles (xem $LOG/seed-roles.log)"
step "tắt lane 9"
"$H/lane-down.sh" 9
node "$H/lane-db.mjs" flush-redis 9 >/dev/null
conns=$(node "$H/lane-db.mjs" tpl-connections)
[ "$conns" = "[]" ] || fail "mẫu còn kết nối: $conns"
step "xong: $DB sẵn sàng làm TEMPLATE (không còn kết nối)"
