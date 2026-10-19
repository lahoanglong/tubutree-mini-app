#!/usr/bin/env bash
# Khởi động lại web lane 6 (next dev) với NEXT_PUBLIC_ZALO_APP_ID để nút "Đăng nhập với Zalo" hoạt động (lane-up.sh không đặt biến này).
# Dùng: restart-web.sh with-zalo | default      (chỉ đụng tiến trình web của lane 6, theo PID file; không pkill)
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
HERE=$(cd "$(dirname "$0")" && pwd)
H=$(cd "$HERE/../../../tools/uat-harness" && pwd)
D=$H/state/lane-6
MODE=${1:-with-zalo}
PIDF=$D/pids/web.pid
WEBP=3262; API=3261

kill_tree() { local p=$1; for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done; kill "$p" 2>/dev/null; }
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  kill_tree "$(cat "$PIDF")"
  for _ in $(seq 1 20); do lsof -nP -iTCP:$WEBP -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
fi
if lsof -nP -iTCP:$WEBP -sTCP:LISTEN >/dev/null 2>&1; then echo "cổng $WEBP vẫn bận, dừng" >&2; exit 1; fi
THR=$(grep -E '^THROTTLE_BYPASS_TOKEN=' "$D/lane.env" | head -1 | cut -d= -f2-)
rm -rf "$D/web/.next"
ZID=""; [ "$MODE" = with-zalo ] && ZID=uat-fake-zalo-app-id
( cd "$D/web" || exit 1
  NEXT_PUBLIC_ZALO_APP_ID="$ZID" NEXT_PUBLIC_API_BASE_URL="http://localhost:$API/api" API_BASE_URL="http://127.0.0.1:$API/api" NEXT_PUBLIC_SITE_URL="http://localhost:$WEBP" \
  THROTTLE_BYPASS_TOKEN="$THR" NEXT_TELEMETRY_DISABLED=1 \
  nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p $WEBP > "$D/logs/web.log" 2>&1 &
  echo $! > "$PIDF" )
for _ in $(seq 1 90); do lsof -nP -iTCP:$WEBP -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 1; done
lsof -nP -iTCP:$WEBP -sTCP:LISTEN >/dev/null 2>&1 && echo "web $WEBP lên ($MODE, PID $(cat "$PIDF"))" || { echo "web không lên" >&2; tail -5 "$D/logs/web.log" >&2; exit 1; }
