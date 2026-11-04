#!/usr/bin/env bash
# Đối soát Ví + Điểm Xanh trên DB lane 5 (chỉ báo cáo, không sửa). Chạy từ gốc worktree uat-1104:
#   bash <đường dẫn>/14-reconcile.sh
set -euo pipefail
WT=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
set -a; . "$WT/docs/2026-10-20-uat/tools/uat-harness/state/lane-5/lane.env"; set +a
case "$DATABASE_URL" in *tubutree_uat_l5*) ;; *) echo "DATABASE_URL không phải lane 5, dừng"; exit 1;; esac
cd "$WT/apps/api"
./node_modules/.bin/tsx scripts/reconcile-wallet.ts
./node_modules/.bin/tsx scripts/reconcile-points.ts
