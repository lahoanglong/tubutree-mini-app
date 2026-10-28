#!/usr/bin/env bash
# Playwright toàn bộ cho một worktree: Mini App (E2E_SCOPE=miniapp) rồi web gate cả bộ (apps/e2e/scripts/web-gate.sh).
#
#   docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc> [--only mini|web] [--out <file>]
#
# Cổng gốc B (vd 3790): e2e API B+1, web B+2, Mini App B+3, Postgres gate B+4, Redis gate B+5.
# In "PASS|FAIL <bước> <dòng tổng của Playwright>"; log đầy đủ ở <out>.d/.
set -u
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH

WT=$1; B=$2; shift 2
ONLY=""; OUT=""
while [ $# -gt 0 ]; do
  case $1 in
    --only) ONLY=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "tham số lạ: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || OUT="$WT/../pw-$(basename "$WT").txt"
LOGD="$OUT.d"; mkdir -p "$LOGD"; : > "$OUT"

run() {
  local name=$1; shift
  local log="$LOGD/$name.log"
  if (cd "$WT/apps/e2e" && "$@") > "$log" 2>&1; then st=PASS; else st=FAIL; fi
  local sum
  sum=$(grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" "$log" | tr -s ' ' | tr '\n' ' ')
  echo "$st $name $sum" | tee -a "$OUT"
  grep -E "^\s+[0-9]+\) \[" "$log" | head -15 | tee -a "$OUT"
}

if [ "$ONLY" != web ]; then
  run mini env E2E_SCOPE=miniapp E2E_MINIAPP_PORT=$((B + 3)) npx playwright test --reporter=line
fi
if [ "$ONLY" != mini ]; then
  run web env GATE_PG_PORT=$((B + 4)) GATE_REDIS_PORT=$((B + 5)) E2E_API_PORT=$((B + 1)) E2E_WEB_PORT=$((B + 2)) E2E_MINIAPP_PORT=$((B + 3)) \
    bash scripts/web-gate.sh --reporter=line
fi
