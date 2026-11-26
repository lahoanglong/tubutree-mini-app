#!/usr/bin/env bash
# Cổng kiểm trước khi gửi duyệt Zalo (tubu-w36-02): chạy đủ các bước dưới trên một commit, ghi log từng bước và một bảng tổng, thoát 0 chỉ khi mọi
# bước đã chạy đều ĐẠT và không bước nào bị bỏ. Không deploy, không `zmp deploy`, không gọi PROD: bản in go-live lấy từ VPS lúc dep1 rồi đưa vào bằng biến.
#
# Dùng (từ gốc repo, máy dev chạy qua cổng RAM):
#   /tmp/run-locked-gate.sh bash scripts/release/pre-submit-check.sh [--only b1,b2] [--skip b1,b2]
# Các bước (theo thứ tự): typecheck mini-build mini-bundle mini-entry mini-lazy zalo-check preflight go-live jest-api race vitest pw-mini pw-mini-www pw-web pw-web-db
# Biến:
#   PRE_SUBMIT_OUT                 thư mục log (mặc định /tmp/pre-submit-<sha 8 ký tự>)
#   MINI_ENV_PRODUCTION            tệp .env.production của Mini (như gói ZMP); bỏ trống thì dùng apps/miniapp/.env.production nếu có. Tệp chép vào chỉ để
#                                  build, xoá ngay sau đó.
#   EXPECTED_ZALO_CHECKS           số mục check-submission phải đạt (27 tại w35-02); TYPECHECK_TASKS số task turbo (8)
#   PRE_SUBMIT_GO_LIVE_REPORT      bản in `pnpm --filter @tubutree/api go-live:check -- --phase=pre-deploy` chạy trên VPS; trống thì bước go-live
#                                  CHƯA KIỂM và cổng không xanh
#   PRE_SUBMIT_BANK_ACCEPT_LAST4   chấp nhận cảnh báo db.bank_account cho đúng đuôi số này (PO chốt 24/11: PROD dùng tạm tài khoản đuôi 6774)
#   PRE_SUBMIT_BASE                ref gốc cho wave-preflight (mặc định merge-base với origin/main)
#   WEB_GATE                       script e2e web (mặc định apps/e2e/scripts/web-gate.sh)
#   PW_WORKERS                     số worker Playwright (mặc định 2); PW web các spec đọc cờ ở máy chủ chạy lại riêng với 1 worker (bước pw-web-db)
#   RACE_PG_PORT / RACE_REDIS_PORT cổng Postgres/Redis tạm của bước race (mặc định 5638/6438)
#   PRE_SUBMIT_MINI_PORT / PRE_SUBMIT_MINI_WWW_PORT cổng Vite dev / vite preview của hai bước Playwright Mini (mặc định 5613/5623). Không dùng cổng 3113
#                                  mặc định: playwright.config.ts dùng lại máy chủ đang nghe ở đó, có thể là Vite của worktree khác.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 9
# shellcheck source=./colima-forward.sh
source "$ROOT/scripts/release/colima-forward.sh"
SHA=$(git rev-parse --short=8 HEAD)
OUT="${PRE_SUBMIT_OUT:-/tmp/pre-submit-$SHA}"
mkdir -p "$OUT"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-2}"
EXPECTED_ZALO_CHECKS="${EXPECTED_ZALO_CHECKS:-27}"
TYPECHECK_TASKS="${TYPECHECK_TASKS:-8}"
PW_WORKERS="${PW_WORKERS:-2}"
WEB_GATE="${WEB_GATE:-apps/e2e/scripts/web-gate.sh}"
LIB=scripts/release/pre-submit-lib.mjs

ONLY=""; SKIP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY=",$2,"; shift 2 ;;
    --skip) SKIP=",$2,"; shift 2 ;;
    *) echo "đối số không biết: $1" >&2; exit 2 ;;
  esac
done
wanted() { { [ -z "$ONLY" ] || [[ "$ONLY" == *",$1,"* ]]; } && [[ "$SKIP" != *",$1,"* ]]; }

SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
FAILED=0; NOT_RUN=0
record() { printf '%-12s %-10s %s\n' "$1" "$2" "$3" | tee -a "$SUMMARY"; }
# step <tên> <lệnh...>: chạy lệnh, log ra $OUT/<tên>.txt, ghi ĐẠT/KHÔNG ĐẠT kèm vài dòng cuối có số.
step() {
  local name=$1; shift
  if ! wanted "$name"; then record "$name" "BỎ QUA" "(--only/--skip)"; NOT_RUN=$((NOT_RUN + 1)); return 0; fi
  local t0; t0=$(date +%s)
  ( "$@" ) > "$OUT/$name.txt" 2>&1
  local rc=$?
  local note; note=$(grep -E '^(ĐẠT|KHÔNG ĐẠT)  |^Tests:|^ *(Tests|Test Files) +[0-9]|^ +[0-9]+ (passed|failed|flaky|skipped|did not run)|Tasks:|^\s*Tổng:|còn [0-9]+ B tới trần|^lô [0-9]|xanh:|: xanh —' "$OUT/$name.txt" | tail -4 | tr -s ' ' | tr '\n' ' ' | cut -c1-300)
  if [ $rc -eq 0 ]; then record "$name" "ĐẠT" "$(( $(date +%s) - t0 ))s $note"; else record "$name" "KHÔNG ĐẠT" "rc=$rc $(( $(date +%s) - t0 ))s $note"; FAILED=$((FAILED + 1)); fi
}

echo "pre-submit-check HEAD $(git rev-parse HEAD) ($(git status --short | wc -l | tr -d ' ') tệp đổi chưa commit), log: $OUT" | tee -a "$SUMMARY"

# --- Kiểu dữ liệu -------------------------------------------------------------------------------------------------------------------------------
typecheck() {
  pnpm --filter @tubutree/shared-types build && (cd apps/api && npx prisma generate) || return 1
  pnpm typecheck > "$OUT/typecheck-turbo.txt" 2>&1
  local rc=$?; cat "$OUT/typecheck-turbo.txt"; [ $rc -eq 0 ] || return $rc
  (cd apps/e2e && npx tsc --noEmit -p tsconfig.json) && echo "tsc apps/e2e: 0 lỗi" && node "$LIB" typecheck "$OUT/typecheck-turbo.txt" "$TYPECHECK_TASKS"
}
step typecheck typecheck

# --- Mini App: bản build như gói ZMP ------------------------------------------------------------------------------------------------------------
# Chạy trong subshell của step(): trap EXIT chỉ dọn tệp bước này chép vào, kể cả khi bị Ctrl-C/kill giữa chừng. Tệp .env.production có sẵn (git bỏ qua,
# mất là không lấy lại được) không bao giờ bị ghi đè hay xoá.
mini_build() {
  local env_file="${MINI_ENV_PRODUCTION:-}" target="$ROOT/apps/miniapp/.env.production"
  if [ -n "$env_file" ]; then
    [ -f "$env_file" ] || { echo "không thấy MINI_ENV_PRODUCTION=$env_file"; return 1; }
    if [ -e "$target" ]; then
      cmp -s "$env_file" "$target" || { echo "apps/miniapp/.env.production đã có và khác MINI_ENV_PRODUCTION: không ghi đè; dời tệp đó đi hoặc bỏ MINI_ENV_PRODUCTION"; return 1; }
    else
      trap "rm -f '$target'" EXIT
      trap 'exit 130' INT
      trap 'exit 143' TERM
      cp "$env_file" "$target" || return 1
    fi
  fi
  [ -f "$target" ] || { echo "thiếu apps/miniapp/.env.production: đặt MINI_ENV_PRODUCTION (bản build không có nó khác gói ZMP)"; return 1; }
  pnpm --filter @tubutree/miniapp build
}
step mini-build mini_build
step mini-bundle env BUNDLE_BUDGET_STRICT=1 MINIAPP_TOTAL_WARN_KB=2210 MINIAPP_ENTRY_WARN_KB=312 node scripts/ci/bundle-budget.cjs apps/miniapp/www
step mini-entry node "$LIB" entry apps/miniapp/www scripts/release/mini-entry-baseline.json
step mini-lazy node scripts/ci/mini-lazy-chunks.cjs apps/miniapp/www
zalo_check() { node scripts/zalo-review/check-submission.mjs --json > "$OUT/zalo-check.json"; node scripts/zalo-review/check-submission.mjs; node "$LIB" zalo "$OUT/zalo-check.json" "$EXPECTED_ZALO_CHECKS"; }
step zalo-check zalo_check
preflight() { if [ -n "${PRE_SUBMIT_BASE:-}" ]; then node scripts/ci/wave-preflight/index.mjs --base "$PRE_SUBMIT_BASE"; else node scripts/ci/wave-preflight/index.mjs; fi; }
step preflight preflight

# --- go-live trên VPS (bản in đưa vào, không gọi PROD từ đây) -------------------------------------------------------------------------------------
if wanted go-live && [ -z "${PRE_SUBMIT_GO_LIVE_REPORT:-}" ]; then
  record go-live "CHƯA KIỂM" "đặt PRE_SUBMIT_GO_LIVE_REPORT = bản in go-live:check --phase=pre-deploy trên VPS"; NOT_RUN=$((NOT_RUN + 1))
else
  step go-live node "$LIB" go-live "${PRE_SUBMIT_GO_LIVE_REPORT:-}"
fi

# --- API ------------------------------------------------------------------------------------------------------------------------------------------
step jest-api bash -c "cd apps/api && npx jest --maxWorkers=2"

# Race toàn bộ trên Postgres 16 + Redis 7 tạm (container --rm, dữ liệu trên tmpfs, xoá khi xong), 3 lô --shard, mỗi lô DB và Redis sạch như race.yml:
# một tiến trình jest hết heap 4096 sau ~396 suite.
# Chạy trong subshell của step(): trap EXIT dọn container và đường hầm Colima (scripts/release/colima-forward.sh, chỉ kill PID ssh do chính
# helper mở) kể cả khi bị Ctrl-C/kill giữa chừng.
race() {
  local pgp=${RACE_PG_PORT:-5638} rdp=${RACE_REDIS_PORT:-6438} c="tubu-presubmit-pg-$$" r="tubu-presubmit-redis-$$" pw
  for p in $pgp $rdp; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "cổng $p đang bận"; return 8; }; done
  trap 'colima_forward_cleanup; docker rm -f -v '"$c $r"' >/dev/null 2>&1' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  pw=$(openssl rand -hex 12)
  docker run -d --rm --tmpfs /var/lib/postgresql/data --name $c -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=tubutree_it -p 127.0.0.1:$pgp:5432 postgres:16-alpine -c max_connections=200 >/dev/null || return 9
  docker run -d --rm --name $r -p 127.0.0.1:$rdp:6379 redis:7-alpine >/dev/null || return 9
  for _ in $(seq 1 40); do docker exec $c pg_isready -h 127.0.0.1 -U tubu -d tubutree_it >/dev/null 2>&1 && break; sleep 1; done
  # Colima có lúc không chuyển tiếp cổng container mới ra máy (từ 24/11): chờ hostagent, không có thì mở ssh -L riêng tới VM, tắt khi xong.
  colima_forward_ports "$pgp" "$rdp" || return 9
  local url="postgresql://tubu:$pw@127.0.0.1:$pgp/tubutree_it?schema=public&connection_limit=20&pool_timeout=30"
  (
    set -o pipefail
    cd apps/api || exit 9
    export DATABASE_URL="$url" TEST_REDIS_URL="redis://127.0.0.1:$rdp"
    npx prisma migrate deploy 2>&1 | tail -2 || { echo 'prisma migrate deploy lỗi'; exit 7; }
    npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code && echo 'drift: none' || exit 7
    src=0
    for s in 1 2 3; do
      docker exec $r redis-cli FLUSHALL >/dev/null || exit 7
      npx prisma migrate reset --force --skip-seed --skip-generate 2>&1 | tail -1 || { echo "prisma migrate reset lỗi trước lô $s"; exit 7; }
      npx jest -c test/integration-race/jest.config.js --runInBand --shard=$s/3 > "$OUT/race-shard$s.txt" 2>&1 || src=1
      echo "lô $s: $(grep -E '^Tests:' "$OUT/race-shard$s.txt")"
    done
    exit $src
  )
}
step race race

# --- Vitest (đường dẫn có `./` để cổng RAM không viết lại thành lệnh chạy rỗng) -----------------------------------------------------------------------
vitest_all() {
  (cd packages/app-core && npx vitest run --minWorkers=1 --maxWorkers=2 $(find ./src -name '*.spec.ts' | sort)) || return 1
  (cd apps/web && npx vitest run --minWorkers=1 --maxWorkers=2) || return 1
  (cd apps/miniapp && npx vitest run --minWorkers=1 --maxWorkers=2)
}
step vitest vitest_all

# --- Playwright ---------------------------------------------------------------------------------------------------------------------------------
# CI=1: Playwright tự mở máy chủ của commit này và báo lỗi khi cổng đã có ai nghe, không dùng lại máy chủ lạ (reuseExistingServer: !CI).
step pw-mini bash -c "cd apps/e2e && CI=1 E2E_SCOPE=miniapp E2E_MINIAPP_PORT=${PRE_SUBMIT_MINI_PORT:-5613} npx playwright test --project='Zalo Mini App' --workers=$PW_WORKERS --retries=0 --reporter=line --output='$OUT/pw-mini-results'"
step pw-mini-www bash -c "cd apps/e2e && CI=1 E2E_MINI_WWW_PORT=${PRE_SUBMIT_MINI_WWW_PORT:-5623} npx playwright test -c playwright.mini-www.config.ts --workers=$PW_WORKERS --retries=0 --output='$OUT/pw-mini-www-results'"
step pw-web bash "$WEB_GATE" --workers="$PW_WORKERS" --retries=0 --reporter=line --output="$OUT/pw-web-results"
# Trang /don đọc cờ khách vãng lai ở máy chủ: các spec bật cờ thật trong DB tạm chỉ chạy khi một worker (support/guest-checkout-flag.ts).
step pw-web-db bash "$WEB_GATE" tests/web-guest-checkout.web.spec.ts tests/pre-submit-order-code.web.spec.ts --project='Web Customer' --project='Web Customer Mobile' --workers=1 --retries=0 --reporter=line --output="$OUT/pw-web-db-results"

echo | tee -a "$SUMMARY"
if [ $FAILED -eq 0 ] && [ $NOT_RUN -eq 0 ]; then
  echo "CỔNG XANH: mọi bước đạt (log $OUT)" | tee -a "$SUMMARY"; exit 0
fi
echo "CỔNG CHƯA XANH: $FAILED bước không đạt, $NOT_RUN bước bỏ qua hoặc chưa kiểm (log $OUT)" | tee -a "$SUMMARY"
[ $FAILED -gt 0 ] && exit 1
exit 3
