#!/usr/bin/env bash
# Dựng worktree cho từng gói đợt quyết định 30/10 từ main d915f19b5, cài deps offline, prisma generate, build shared-types.
#   mk-worktrees.sh <gói...>
set -u
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
R=/Users/longla/coding/tubutree-mini-app
one() {
  local k=$1 w=$R/.claude/worktrees/qd-$1
  [ -d "$w" ] || git -C $R worktree add -q -b review/qd-$k "$w" d915f19b5 || { echo "FAIL $k worktree"; return; }
  (cd "$w" && pnpm install --frozen-lockfile --offline >/dev/null 2>&1 \
    && (cd apps/api && npx prisma generate >/dev/null 2>&1) \
    && pnpm --filter @tubutree/shared-types build >/dev/null 2>&1) && echo "OK $k" || echo "FAIL $k install"
}
for k in "$@"; do one "$k" & while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 2; done; done
wait
