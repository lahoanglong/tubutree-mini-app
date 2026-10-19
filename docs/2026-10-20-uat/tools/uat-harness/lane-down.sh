#!/usr/bin/env bash
# Dừng sạch một lane: web, Vite, API, giả Pancake — mỗi cái kèm cả cây tiến trình con (pgrep -P), chỉ PID lane này đã ghi.
# Dùng: lane-down.sh <N> [--drop]   (--drop: xoá luôn DB tubutree_uat_l<N> và FLUSHDB Redis db N)
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
H=$(cd "$(dirname "$0")" && pwd)
N=${1:-}; DROP=0; [ "${2:-}" = --drop ] && DROP=1
case $N in [1-9]) ;; *) echo "dùng: lane-down.sh <1..8> [--drop]" >&2; exit 2 ;; esac
API=$((3200 + N * 10 + 1)); WEBP=$((API + 1)); MINIP=$((API + 2)); PANC=$((API + 7))
D=$H/state/lane-$N
APIPID=$D/pids/api.pid

tree() { local p=$1; echo "$p"; for c in $(pgrep -P "$p" 2>/dev/null); do tree "$c"; done; }

stop() {
  local name=$1 pidf=$2 port=$3
  if [ ! -f "$pidf" ]; then echo "$name: không có PID ($pidf)"; return; fi
  local root; root=$(cat "$pidf")
  if ! kill -0 "$root" 2>/dev/null; then echo "$name: PID $root đã chết"; rm -f "$pidf"; return; fi
  local pids; pids=$(tree "$root" | tr '\n' ' ')
  kill $pids 2>/dev/null
  for _ in $(seq 1 15); do
    local left=""; for p in $pids; do kill -0 "$p" 2>/dev/null && left="$left $p"; done
    [ -z "$left" ] && break; sleep 1
  done
  local left=""; for p in $pids; do kill -0 "$p" 2>/dev/null && left="$left $p"; done
  [ -n "$left" ] && { kill -9 $left 2>/dev/null; echo "$name: kill -9$left"; }
  rm -f "$pidf"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "$name: CẢNH BÁO cổng $port vẫn bận"; else echo "$name: đã dừng (cây: $pids)"; fi
}

stop web "$D/pids/web.pid" $WEBP
stop vite "$D/pids/vite.pid" $MINIP
stop api "$APIPID" $API
stop pancake "$D/pids/pancake.pid" $PANC

if [ $DROP = 1 ] && [ "$N" != 9 ]; then
  node "$H/lane-db.mjs" drop "$N"
  node "$H/lane-db.mjs" flush-redis "$N"
  rm -rf "$D/pancake"
fi
