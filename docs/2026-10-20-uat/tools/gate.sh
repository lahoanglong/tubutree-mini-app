#!/usr/bin/env bash
# Gate phiên UAT trên một worktree. Dùng: gate.sh <worktree> <outdir> [full]
# full: thêm eslint 3 app, build api/web/miniapp. Mỗi bước chạy nền + wait để trap TERM dừng cả cây con.
# Postgres chạy thẳng: cụm 25544 cho migrate/drift, 25541/25542 cho race 2 luồng.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
WT=$1; OUT=$2; FULL=${3:-}
T=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
kids() { for c in $(pgrep -P $1); do kids $c; echo $c; done; }
trap 'for p in $(kids $$); do kill $p 2>/dev/null; done; exit 143' TERM INT
step() { echo "=== $1 $(date +%T)"; }
run() { local name=$1; shift; ( "$@" ) > $OUT/$name.log 2>&1 & wait $!; local c=$?; echo "$name exit $c"; return $c; }

step "shared-types + prisma generate"
run shared-types bash -c "cd $WT && pnpm --filter @tubutree/shared-types build"
run prisma-generate bash -c "cd $WT/apps/api && npx prisma generate"
step tsc
run tsc-api bash -c "cd $WT/apps/api && npx tsc --noEmit"
run tsc-miniapp bash -c "cd $WT/apps/miniapp && npx tsc --noEmit"
run tsc-web bash -c "cd $WT/apps/web && npx tsc --noEmit"
run tsc-e2e bash -c "cd $WT/apps/e2e && npx tsc --noEmit -p tsconfig.json"
step lint
run lint-vars bash -c "cd $WT && npm run -s lint:vars"
run lint-parity bash -c "cd $WT && npm run -s lint:parity"
if [ -n "$FULL" ]; then
  run eslint-api bash -c "cd $WT/apps/api && npx eslint src --max-warnings=0"
  run eslint-miniapp bash -c "cd $WT/apps/miniapp && npx eslint 'src/**/*.{ts,tsx}' --max-warnings=0"
  run eslint-web bash -c "cd $WT/apps/web && npx eslint src"; grep -E "problems?|warning" $OUT/eslint-web.log | tail -1
fi
step "migrate trên DB mới (cụm 25544)"
bash $T/pg-native.sh start 25544 >/dev/null && bash $T/pg-native.sh createdb 25544 tubutree_gate >/dev/null 2>&1
MURL="postgresql://tubu@127.0.0.1:25544/tubutree_gate?schema=public"
run migrate bash -c "cd $WT/apps/api && DATABASE_URL='$MURL' npx prisma migrate deploy"; tail -2 $OUT/migrate.log
run migrate-status bash -c "cd $WT/apps/api && DATABASE_URL='$MURL' npx prisma migrate status"; tail -1 $OUT/migrate-status.log
run drift bash -c "cd $WT/apps/api && DATABASE_URL='$MURL' npx prisma migrate diff --from-url '$MURL' --to-schema-datamodel prisma/schema.prisma --exit-code"; tail -1 $OUT/drift.log
run partial-idx bash -c "cd $WT/apps/api && DATABASE_URL='$MURL' npx tsx prisma/check-partial-indexes.ts"; tail -1 $OUT/partial-idx.log
bash $T/pg-native.sh stop 25544 >/dev/null
step "jest api"
run jest-api bash -c "cd $WT/apps/api && npx jest --maxWorkers=4"; grep -E '^(Tests|Test Suites):' $OUT/jest-api.log
step "race 2 luồng"
bash $T/race-shard.sh $WT 1 2 25541 $OUT & p1=$!
bash $T/race-shard.sh $WT 2 2 25542 $OUT & p2=$!
wait $p1; wait $p2
grep -h '^Test Suites:\|^Tests:' $OUT/race-1.log $OUT/race-2.log
bash $T/pg-native.sh stop 25541 >/dev/null 2>&1; bash $T/pg-native.sh stop 25542 >/dev/null 2>&1
step vitest
run vitest-miniapp bash -c "cd $WT/apps/miniapp && npx vitest run"; grep -E 'Test Files|Tests ' $OUT/vitest-miniapp.log
run vitest-miniapp-utc bash -c "cd $WT/apps/miniapp && TZ=UTC npx vitest run"; grep -E 'Test Files|Tests ' $OUT/vitest-miniapp-utc.log
run vitest-web bash -c "cd $WT/apps/web && npx vitest run"; grep -E 'Test Files|Tests ' $OUT/vitest-web.log
run vitest-web-utc bash -c "cd $WT/apps/web && TZ=UTC npx vitest run"; grep -E 'Test Files|Tests ' $OUT/vitest-web-utc.log
run vitest-app-core bash -c "cd $WT/packages/app-core && npx vitest run"; grep -E 'Test Files|Tests ' $OUT/vitest-app-core.log
if [ -n "$FULL" ]; then
  step build
  run build-api bash -c "cd $WT/apps/api && npx nest build"
  run build-web bash -c "cd $WT/apps/web && npx next build"; tail -3 $OUT/build-web.log
  run build-miniapp bash -c "cd $WT/apps/miniapp && VITE_API_BASE_URL=https://api.tubutree.com/api npm run -s build"; tail -3 $OUT/build-miniapp.log
fi
step DONE
