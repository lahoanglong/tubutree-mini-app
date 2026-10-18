#!/usr/bin/env bash
# Gate của một lane web-parity: chạy trong worktree truyền vào, ghi log từng bước vào thư mục ra.
# Dùng: bash lane-gate.sh <worktree> <outdir>
# Không sửa file này khi đang có gate chạy (bash đọc script từng đoạn).
set -u
WT="$1"
OUT="$2"
mkdir -p "$OUT"
export PATH="$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH"
cd "$WT" || exit 2
SUMMARY="$OUT/summary.txt"
: >"$SUMMARY"

step() {
  local name="$1"
  shift
  local log="$OUT/$name.log"
  "$@" >"$log" 2>&1
  local rc=$?
  local tail
  tail=$(grep -E "Tests +[0-9]|Test Files|error TS|✖|problems|ERR_|Failed|failed|Compiled|lint:parity|OK —|Lỗi|warning" "$log" | tail -3 | tr '\n' ' ')
  echo "$name rc=$rc $tail" >>"$SUMMARY"
  return $rc
}

step install pnpm install --prefer-offline
step shared-types pnpm --filter @tubutree/shared-types build
step app-core-typecheck pnpm --filter @tubutree/app-core typecheck
step app-core-test pnpm --filter @tubutree/app-core test
step web-typecheck pnpm --filter @tubutree/web typecheck
step web-lint pnpm --filter @tubutree/web lint
step web-test pnpm --filter @tubutree/web test
step web-test-utc env TZ=UTC pnpm --filter @tubutree/web test
step miniapp-typecheck pnpm --filter @tubutree/miniapp typecheck
step miniapp-lint pnpm --filter @tubutree/miniapp lint
step miniapp-test pnpm --filter @tubutree/miniapp test
step lint-vars pnpm lint:vars
if grep -q '"lint:parity"' package.json; then step lint-parity pnpm lint:parity; else echo "lint-parity skip (chưa có)" >>"$SUMMARY"; fi
step web-build pnpm --filter @tubutree/web build
step miniapp-build pnpm --filter @tubutree/miniapp build
echo "DONE" >>"$SUMMARY"
