#!/usr/bin/env bash
# Đếm test từng bộ trên một worktree. Dùng: baseline.sh <worktree> <outdir> [skip-race]
# Mỗi bước chạy nền + wait để trap TERM dừng được cả cây con.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
WT=$1; OUT=$2; SKIP_RACE=${3:-}
T=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
kids() { for c in $(pgrep -P $1); do kids $c; echo $c; done; }
trap 'for p in $(kids $$); do kill $p 2>/dev/null; done; exit 143' TERM INT
step() { echo "=== $1 $(date +%T)"; }
run() { local name=$1; shift; ( "$@" ) > $OUT/$name.log 2>&1 & wait $!; echo "$name exit $?"; }

step "jest api"; run jest-api bash -c "cd $WT/apps/api && npx jest --maxWorkers=4"
grep -E '^(Tests|Test Suites):' $OUT/jest-api.log
step "vitest miniapp VN"; run vitest-miniapp bash -c "cd $WT/apps/miniapp && npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-miniapp.log
step "vitest miniapp UTC"; run vitest-miniapp-utc bash -c "cd $WT/apps/miniapp && TZ=UTC npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-miniapp-utc.log
step "vitest web VN"; run vitest-web bash -c "cd $WT/apps/web && npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-web.log
step "vitest web UTC"; run vitest-web-utc bash -c "cd $WT/apps/web && TZ=UTC npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-web-utc.log
step "vitest app-core"; run vitest-app-core bash -c "cd $WT/packages/app-core && npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-app-core.log
step "vitest eslint-config"; run vitest-eslint-config bash -c "cd $WT/packages/eslint-config && npx vitest run"
grep -E 'Test Files|Tests ' $OUT/vitest-eslint-config.log
step "playwright list"
run pw-list-miniapp bash -c "cd $WT/apps/e2e && E2E_SCOPE=miniapp npx playwright test --list"
tail -1 $OUT/pw-list-miniapp.log
run pw-list-web bash -c "cd $WT/apps/e2e && E2E_SCOPE=web npx playwright test --list"
tail -1 $OUT/pw-list-web.log
if [ -z "$SKIP_RACE" ]; then
  step "race 2 luồng"
  bash $T/race-shard.sh $WT 1 2 25541 $OUT & p1=$!
  bash $T/race-shard.sh $WT 2 2 25542 $OUT & p2=$!
  wait $p1; wait $p2
fi
step DONE
