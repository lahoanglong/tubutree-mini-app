#!/usr/bin/env bash
# Chạy lại bộ kiểm tĩnh của một nhánh gói (không cần server): tsc, eslint file đổi,
# vitest, jest API, lint:parity, vite build + bundle-report. Playwright chạy riêng.
#
#   docs/2026-10-28-review/tools/gate.sh <worktree> [--base <rev>] [--no-jest] [--out <file>]
#
# In mỗi bước một dòng "PASS|FAIL <bước> <tóm tắt>"; log đầy đủ ở <out>.d/.
set -u
GATE_TOOLS=$(cd "$(dirname "$0")" && pwd)
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH

WT=$1; shift
BASE=1384ff3804ee1ce28cab06f0c2bb0230fb138f9b
JEST=1
OUT=""
while [ $# -gt 0 ]; do
  case $1 in
    --base) BASE=$2; shift 2 ;;
    --no-jest) JEST=0; shift ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "tham số lạ: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || OUT="$WT/../gate-$(basename "$WT").txt"
LOGD="$OUT.d"
mkdir -p "$LOGD"
: > "$OUT"

cd "$WT" || exit 2
CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE"..HEAD)

step() {
  local name=$1 summary_re=$2; shift 2
  local log="$LOGD/$name.log"
  if (cd "$WT" && "$@") > "$log" 2>&1; then st=PASS; else st=FAIL; fi
  local sum=""
  [ -n "$summary_re" ] && sum=$(grep -E "$summary_re" "$log" | tail -2 | tr -s ' ' | tr '\n' ' ')
  echo "$st $name $sum" | tee -a "$OUT"
}

lint_changed() {
  local app=$1 pat=$2
  local files
  files=$(echo "$CHANGED" | grep -E "^$app/src/.*$pat" | sed "s#^$app/##")
  [ -z "$files" ] && { echo "không có file đổi"; return 0; }
  (cd "$app" && echo "$files" | xargs npx eslint --max-warnings=0)
}

step shared-types "" pnpm --filter @tubutree/shared-types build
step tsc-api "" bash -c 'cd apps/api && npx tsc --noEmit -p tsconfig.json'
step tsc-web "" bash -c 'cd apps/web && npx next typegen >/dev/null && npx tsc --noEmit'
step tsc-miniapp "" bash -c 'cd apps/miniapp && npx tsc --noEmit'
step tsc-app-core "" bash -c 'cd packages/app-core && npx tsc --noEmit'
step tsc-e2e "" bash -c 'cd apps/e2e && npx tsc --noEmit -p tsconfig.json'
step eslint-api "problem" lint_changed apps/api '\.ts$'
step eslint-miniapp "problem" lint_changed apps/miniapp '\.tsx?$'
step eslint-web "problem|Error" bash -c 'cd apps/web && npx next lint --quiet'
step vitest-app-core "Test Files|Tests " bash -c 'cd packages/app-core && npx vitest run'
step vitest-miniapp "Test Files|Tests " bash -c 'cd apps/miniapp && npx vitest run'
step vitest-miniapp-utc "Test Files|Tests " bash -c 'cd apps/miniapp && TZ=UTC npx vitest run'
step vitest-web "Test Files|Tests " bash -c 'cd apps/web && npx vitest run'
[ $JEST = 1 ] && step jest-api "^Test Suites:|^Tests:" bash -c 'cd apps/api && npx jest --silent'
step lint-parity "" pnpm lint:parity
step vite-build "built in" bash -c 'cd apps/miniapp && npx vite build'
step bundle-mini "entry" bash -c "node '$GATE_TOOLS/perf/bundle-report.mjs' --only=miniapp | jq -r '.miniapp | \"entry \\(.entry.rawKB)/\\(.entry.gzKB) KB total \\(.groups.total.rawKB)/\\(.groups.total.gzKB) KB\"'"

echo "---" | tee -a "$OUT"
grep -c '^FAIL' "$OUT" | sed 's/^/FAIL count: /' | tee -a "$OUT"
