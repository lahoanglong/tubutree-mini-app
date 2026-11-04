#!/usr/bin/env bash
# Dựng lane 4 mới rồi chạy toàn bộ ca API theo thứ tự. Chạy từ bất kỳ đâu; mất khoảng 6 phút.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
S=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L4-doi-rac-cong-dong
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104
bash $S/00-lane-fresh.sh > $S/lane-fresh.log 2>&1 || { echo "dựng lane lỗi, xem $S/lane-fresh.log"; exit 1; }
for f in 10-waste-api 20-waste-desk 21-waste-reverse 25-waste-mailin 30-game-api 40-community-api 60-race 70-perm 80-tz; do
  echo "=== $f"; node $S/$f.mjs 2>&1 | grep -E "^\[(PASS|FAIL|BLOCKED|CẦN CHỦ)\]|Error|error" | cut -c1-240
done
echo "=== 50-ui matrix"; node $S/50-ui.mjs matrix 2>&1 | grep -E "^\[(PASS|FAIL|BLOCKED|CẦN CHỦ)\]" | cut -c1-240
echo "=== 50-ui flows"; node $S/50-ui.mjs flows 2>&1 | grep -E "^\[(PASS|FAIL|BLOCKED|CẦN CHỦ)\]" | cut -c1-240
