#!/usr/bin/env bash
# Bật một API UAT từ bản build apps/api/dist (không watch, đỡ CPU).
# Dùng: api-up.sh <port> <db> <redis-db> [pg-port]   |   api-up.sh stop <port>
# Ghi PID vào ~/.cache/tubu-uat/api-<port>.pid, log vào docs/2026-10-20-uat/logs/api-<port>.log.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
WT=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat
API=${API_DIR:-$WT/apps/api}
STATE=$HOME/.cache/tubu-uat; mkdir -p $STATE
if [ "${1:-}" = stop ]; then
  port=$2; pidf=$STATE/api-$port.pid
  [ -f $pidf ] && { pid=$(cat $pidf); for c in $(pgrep -P $pid); do kill $c 2>/dev/null; done; kill $pid 2>/dev/null; rm -f $pidf; echo "đã dừng API $port ($pid)"; } || echo "không có PID cho $port"
  exit 0
fi
port=$1; db=$2; rdb=$3; pg=${4:-25432}
case $port in 32[2-9][0-9]) ;; *) echo "cổng $port ngoài dải UAT 3220-3299" >&2; exit 1;; esac
if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "cổng $port đang bận" >&2; exit 1; fi
log=$WT/docs/2026-10-20-uat/logs/api-$port.log
cd $API
env PORT=$port \
  DATABASE_URL="postgresql://tubu@127.0.0.1:$pg/$db?schema=public" \
  REDIS_URL="redis://127.0.0.1:26379/$rdb" \
  CORS_ORIGINS="" \
  ${EXTRA_ENV:-} \
  nohup node dist/main.js > $log 2>&1 &
echo $! > $STATE/api-$port.pid
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:$port/api/health >/dev/null 2>&1; then echo "API $port lên (PID $(cat $STATE/api-$port.pid), DB $db, Redis db $rdb)"; exit 0; fi
  sleep 1
done
echo "API $port chưa lên sau 60 giây, xem $log" >&2; tail -20 $log >&2; exit 1
