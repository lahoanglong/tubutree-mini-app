#!/usr/bin/env bash
# Bật một lane UAT: DB riêng (copy từ mẫu), Redis db riêng, giả Pancake, API thật (apps/api/dist), Vite Mini App, web Next (--web).
# Dùng: lane-up.sh <N> [--web] [--fresh] [--no-mini]
#   N        1..8 (6 agent chọn 6 lane có cổng trống; lane 2 trùng cổng API/web/Vite UAT 3221-3223 khi chúng đang chạy;
#            9 = lane dựng DB mẫu, chỉ build-template.sh dùng)
#   --web    bật thêm web Next (next dev -p 32N2) từ bản sao apps/web riêng của lane (không chung .next với phiên khác)
#   --fresh  xoá DB lane + FLUSHDB Redis lane, copy lại từ mẫu (mất dữ liệu lane)
#   --no-mini không bật Vite Mini App
# Cổng: API 32N1, web 32N2, Mini App 32N3, giả Pancake 32N8. Đã chạy thì bỏ qua thành phần đó (idempotent).
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
H=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$H/../../../.." && pwd)
TOOLS=$(cd "$H/.." && pwd)
N=${1:-}; shift || true
WEB=0; FRESH=0; MINI=1
for a in "$@"; do
  case $a in --web) WEB=1 ;; --fresh) FRESH=1 ;; --no-mini) MINI=0 ;; *) echo "tham số lạ: $a" >&2; exit 2 ;; esac
done
case $N in [1-9]) ;; *) echo "dùng: lane-up.sh <1..8> [--web] [--fresh] [--no-mini]" >&2; exit 2 ;; esac

API=$((3200 + N * 10 + 1)); WEBP=$((API + 1)); MINIP=$((API + 2)); PANC=$((API + 7))
if [ "$N" = 9 ]; then DB=tubutree_uat_tpl; RDB=15; else DB=tubutree_uat_l$N; RDB=$N; fi
D=$H/state/lane-$N; mkdir -p "$D/logs" "$D/pids"
APIPID=$D/pids/api.pid

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
owner() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" PID "$2}'; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
wait_port() { for _ in $(seq 1 "${2:-60}"); do listening "$1" && return 0; sleep 1; done; return 1; }

# Cổng bận bởi tiến trình KHÔNG phải của lane này thì dừng sớm, không giành cổng của agent khác.
check_port() {
  local port=$1 pidf=$2
  if listening "$port" && ! alive "$pidf"; then echo "cổng $port đang bận bởi $(owner "$port") (không phải lane $N) — dừng" >&2; exit 1; fi
}
check_port $API "$APIPID"; check_port $PANC "$D/pids/pancake.pid"
[ $MINI = 1 ] && check_port $MINIP "$D/pids/vite.pid"
[ $WEB = 1 ] && check_port $WEBP "$D/pids/web.pid"

# 1. DB + Redis
if [ "$N" != 9 ]; then
  if [ $FRESH = 1 ] && alive "$APIPID"; then echo "--fresh cần API lane đã dừng: chạy lane-down.sh $N trước" >&2; exit 1; fi
  out=$(node "$H/lane-db.mjs" create "$N" $([ $FRESH = 1 ] && echo --fresh)) || { echo "$out" >&2; exit 1; }
  echo "$out" | grep -v '^CREATED='
  if echo "$out" | grep -q 'CREATED=1'; then node "$H/lane-db.mjs" flush-redis "$N"; rm -rf "$D/pancake"; fi
fi
node -e "import('$H/lib.mjs').then(m => m.ensureLaneEnv(m.lane($N)))" || exit 1
ENVF=$D/lane.env
envval() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }

# 2. Giả Pancake
if alive "$D/pids/pancake.pid"; then echo "giả Pancake $PANC đã chạy (PID $(cat "$D/pids/pancake.pid"))"; else
  nohup node "$H/fake-pancake.mjs" "$N" > "$D/logs/pancake.log" 2>&1 &
  echo $! > "$D/pids/pancake.pid"
  wait_port $PANC 15 || { echo "giả Pancake không lên, xem $D/logs/pancake.log" >&2; tail -5 "$D/logs/pancake.log" >&2; exit 1; }
  echo "giả Pancake $PANC lên (PID $(cat "$D/pids/pancake.pid"))"
fi

# 3. API thật (apps/api/dist/main.js, không watch). Env lane đè apps/api/.env (process.env thắng trong ConfigModule).
if alive "$APIPID"; then echo "API $API đã chạy (PID $(cat "$APIPID"))"; else
  [ -f "$WT/apps/api/dist/main.js" ] || { echo "thiếu apps/api/dist/main.js — build apps/api trước" >&2; exit 1; }
  # Hai API chung một db Redis thì worker BullMQ ăn job của nhau (job xong mà sự kiện bên kia kẹt RECEIVED): db phải trống.
  others=$(node "$H/lane-db.mjs" redis-clients "$N") || exit 1
  [ "$others" = 0 ] || { echo "Redis db $RDB đang có $others kết nối của tiến trình khác — không bật API lane $N trên db này" >&2; exit 1; }
  ( cd "$WT/apps/api" || exit 1
    set -a; . "$ENVF"; set +a
    nohup node dist/main.js > "$D/logs/api.log" 2>&1 &
    echo $! > "$APIPID" )
  for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$API/api/health" >/dev/null 2>&1 && break; alive "$APIPID" || break; sleep 1; done
  curl -sf "http://127.0.0.1:$API/api/health" >/dev/null 2>&1 || { echo "API $API không lên, xem $D/logs/api.log" >&2; tail -20 "$D/logs/api.log" >&2; exit 1; }
  echo "API http://localhost:$API/api lên (PID $(cat "$APIPID"), DB $DB, Redis db $RDB)"
fi

# 4. Vite Mini App: VITE_API_BASE_URL đọc ở apps/miniapp/src/services/api.ts; VITE_API_TARGET (proxy /api của vite.config.mts)
#    trỏ lane để không request nào lọt tới api.tubutree.com.
if [ $MINI = 1 ]; then
  if alive "$D/pids/vite.pid"; then echo "Vite $MINIP đã chạy (PID $(cat "$D/pids/vite.pid"))"; else
    ( cd "$WT/apps/miniapp" || exit 1
      VITE_API_BASE_URL="http://localhost:$API/api" VITE_API_TARGET="http://127.0.0.1:$API" VITE_WEB_BASE_URL="http://localhost:$WEBP" \
      nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $MINIP --strictPort > "$D/logs/vite.log" 2>&1 &
      echo $! > "$D/pids/vite.pid" )
    wait_port $MINIP 60 || { echo "Vite không lên, xem $D/logs/vite.log" >&2; tail -5 "$D/logs/vite.log" >&2; exit 1; }
    echo "Mini App http://localhost:$MINIP lên (PID $(cat "$D/pids/vite.pid"))"
  fi
fi

# 5. Web Next: bản sao apps/web của lane (src chép lại mỗi lần bật, node_modules là symlink) để .next không chung với web 3222/lane khác.
if [ $WEB = 1 ]; then
  if alive "$D/pids/web.pid"; then echo "web $WEBP đã chạy (PID $(cat "$D/pids/web.pid"))"; else
    mkdir -p "$D/web"
    rsync -a --delete --exclude node_modules --exclude .next --exclude '*.spec.ts' --exclude '*.spec.tsx' "$WT/apps/web/" "$D/web/"
    ln -sfn "$WT/apps/web/node_modules" "$D/web/node_modules"
    ( cd "$D/web" || exit 1
      NEXT_PUBLIC_API_BASE_URL="http://localhost:$API/api" API_BASE_URL="http://127.0.0.1:$API/api" NEXT_PUBLIC_SITE_URL="http://localhost:$WEBP" \
      THROTTLE_BYPASS_TOKEN="$(envval THROTTLE_BYPASS_TOKEN)" NEXT_TELEMETRY_DISABLED=1 \
      nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p $WEBP > "$D/logs/web.log" 2>&1 &
      echo $! > "$D/pids/web.pid" )
    wait_port $WEBP 90 || { echo "web không lên, xem $D/logs/web.log" >&2; tail -5 "$D/logs/web.log" >&2; exit 1; }
    echo "web http://localhost:$WEBP lên (PID $(cat "$D/pids/web.pid")); trang dịch lần đầu khi mở (next dev)"
  fi
fi

echo "lane $N: API http://localhost:$API/api  DB $DB  Redis db $RDB  Pancake giả http://127.0.0.1:$PANC  log $D/logs"
