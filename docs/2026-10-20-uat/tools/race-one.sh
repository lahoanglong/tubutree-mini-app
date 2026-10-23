#!/usr/bin/env bash
# Chạy vài race spec trên một cụm Postgres riêng rồi tắt cụm.
# Dùng: race-one.sh <worktree> <cổng pg> <spec...>
# Chờ load dưới 40 trước khi chạy vì máy dùng chung nhiều phiên.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
WT=$1; PORT=$2; shift 2
T=$(cd "$(dirname "$0")" && pwd)
while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -ge 40 ]; do sleep 30; done
echo "load ok $(uptime)"
bash $T/pg-native.sh start $PORT >/dev/null || { echo "không dựng được cụm $PORT"; exit 1; }
trap 'bash $T/pg-native.sh stop $PORT >/dev/null 2>&1' EXIT
bash $T/pg-native.sh createdb $PORT tubutree_it >/dev/null 2>&1
export DATABASE_URL="postgresql://tubu@127.0.0.1:$PORT/tubutree_it?schema=public"
cd $WT/apps/api
npx prisma migrate deploy >/dev/null 2>&1 || { echo "migrate lỗi"; exit 1; }
npx jest -c test/integration-race/jest.config.js --runInBand "$@"
