#!/usr/bin/env bash
# Dựng lại lane 4 từ đầu đúng thứ tự brief rồi nạp dữ liệu Đổi rác. Chạy từ gốc worktree uat-1104:
#   bash /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L4-doi-rac-cong-dong/00-lane-fresh.sh
set -euo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104
H=docs/2026-10-20-uat/tools/uat-harness; R=docs/2026-10-28-review
S=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L4-doi-rac-cong-dong
$H/lane-down.sh 4
node $H/lane-db.mjs create 4 --fresh
$H/lane-up.sh 4 --web
( cd apps/api && DATABASE_URL=$(grep ^DATABASE_URL= ../../$H/state/lane-4/lane.env | cut -d= -f2-) npx prisma migrate deploy )
$H/lane-down.sh 4 && $H/lane-up.sh 4 --web
node $H/db.mjs 4 "SELECT count(*) AS migrations FROM _prisma_migrations WHERE finished_at IS NOT NULL"
node $R/tools/seed-data.mjs --lane 4 all || echo "seed-data.mjs lỗi ở bước 'extra' vì waste.enabled chưa bật được (xem 00-setup.mjs); các bước trước đã chạy"
rm -f $S/results.jsonl $S/params.json
node $S/00-setup.mjs
