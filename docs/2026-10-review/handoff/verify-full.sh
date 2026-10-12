#!/usr/bin/env bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
R=/Users/longla/coding/tubutree-mini-app
OUT=${1:-/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/44cf5d39-31b2-4fe1-82c3-64f87652528b/scratchpad/verify2}
mkdir -p $OUT
step() { echo "=== $1 $(date +%T)"; }
cd $R
step shared-types; pnpm --filter @tubutree/shared-types build > $OUT/shared-types.log 2>&1; echo "exit $?"
step "tsc api";     (cd apps/api && npx tsc --noEmit) > $OUT/tsc-api.log 2>&1; echo "exit $?"
step "tsc miniapp"; (cd apps/miniapp && npx tsc --noEmit) > $OUT/tsc-miniapp.log 2>&1; echo "exit $?"
step "tsc web";     (cd apps/web && npx tsc --noEmit) > $OUT/tsc-web.log 2>&1; echo "exit $?"
step "tsc e2e";     (cd apps/e2e && npx tsc --noEmit -p tsconfig.json) > $OUT/tsc-e2e.log 2>&1; echo "exit $?"
step "eslint api";  (cd apps/api && npx eslint src --max-warnings=0) > $OUT/eslint-api.log 2>&1; echo "exit $?"
step "eslint miniapp"; (cd apps/miniapp && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0) > $OUT/eslint-miniapp.log 2>&1; echo "exit $?"
step "eslint web";  (cd apps/web && npx eslint src --max-warnings=0) > $OUT/eslint-web.log 2>&1; echo "exit $?"
step "lint:vars";   (cd $R && npm run -s lint:vars) > $OUT/lint-vars.log 2>&1; echo "exit $?"
step "prisma generate"; (cd apps/api && npx prisma generate) > $OUT/prisma-generate.log 2>&1; echo "exit $?"
step "recreate tubutree_it on 5550"
docker exec tubu_it_main psql -U tubu -d postgres -c "DROP DATABASE IF EXISTS tubutree_it WITH (FORCE)" -c "CREATE DATABASE tubutree_it" > $OUT/db.log 2>&1; echo "exit $?"
export DATABASE_URL="postgresql://tubu:tubu@localhost:5550/tubutree_it?schema=public"
cd $R/apps/api
step "migrate deploy (empty DB)"; npx prisma migrate deploy > $OUT/migrate.log 2>&1; echo "exit $?"; tail -3 $OUT/migrate.log
step "migrate status"; npx prisma migrate status > $OUT/migrate-status.log 2>&1; echo "exit $?"; tail -2 $OUT/migrate-status.log
step "drift"; npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code > $OUT/drift.log 2>&1; echo "exit $?"; tail -2 $OUT/drift.log
step "partial idx"; npx tsx prisma/check-partial-indexes.ts > $OUT/partial.log 2>&1; echo "exit $?"; tail -2 $OUT/partial.log
step "jest api"; npx jest > $OUT/jest-api.log 2>&1; echo "exit $?"; grep -E "^(Tests|Test Suites):" $OUT/jest-api.log
step "race suite"; npx jest -c test/integration-race/jest.config.js --runInBand > $OUT/race.log 2>&1; echo "exit $?"; grep -E "^(Tests|Test Suites):" $OUT/race.log
step "vitest miniapp"; (cd $R/apps/miniapp && npx vitest run) > $OUT/vitest-miniapp.log 2>&1; echo "exit $?"; grep -E "Test Files|Tests " $OUT/vitest-miniapp.log
step "vitest web"; (cd $R/apps/web && npx vitest run) > $OUT/vitest-web.log 2>&1; echo "exit $?"; grep -E "Test Files|Tests " $OUT/vitest-web.log
step "static-scan"; mkdir -p $R/scripts/uiux/results; (cd $R && node scripts/uiux/static-scan.mjs) > $OUT/static-scan.log 2>&1; echo "exit $?"; tail -12 $OUT/static-scan.log
step "build api";     (cd $R/apps/api && npx nest build) > $OUT/build-api.log 2>&1; echo "exit $?"
step "build web";     (cd $R/apps/web && npx next build) > $OUT/build-web.log 2>&1; echo "exit $?"; tail -5 $OUT/build-web.log
step "build miniapp"; (cd $R/apps/miniapp && npm run -s build) > $OUT/build-miniapp.log 2>&1; echo "exit $?"; tail -5 $OUT/build-miniapp.log
step DONE
