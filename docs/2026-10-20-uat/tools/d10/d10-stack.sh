#!/usr/bin/env bash
# Dựng cả stack docker-compose.vietnix.yml (bản sao + env giả) trong project tạm `tubu-d10`, không cổng cố định, volume tmpfs.
# Dùng: d10-stack.sh prep | up | probe | drill | down      (image tubu-uat-api:local, tubu-uat-web:local phải có sẵn)
# KHÔNG đụng tubu_pg, tubu_redis, tubu-uat-redis, cổng 14000/14001. Ghi mọi thứ ra stdout (tee do người gọi).
set -uo pipefail
WT=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat
TOOLS=$WT/docs/2026-10-20-uat/tools/d10
W=${D10_WORKDIR:-/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/scratchpad/d10-compose}
export D10_REPO_ROOT=$WT D10_API_PORT=${D10_API_PORT:-3297} D10_WEB_PORT=${D10_WEB_PORT:-3298}
DC="docker compose -p tubu-d10 -f docker-compose.vietnix.yml -f d10-override.yml"
cd "$W" || exit 1
case "${1:-}" in
  prep)
    cp "$WT/docker-compose.vietnix.yml" "$WT/docker-compose.prod.yml" "$WT/Caddyfile" "$TOOLS/d10-override.yml" .
    cp "$TOOLS/d10-fake.env" .env
    for p in $D10_API_PORT $D10_WEB_PORT; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "cổng $p đang bận"; exit 1; }; done
    echo "prep xong ở $W" ;;
  up)
    date '+%T up bắt đầu'; $DC up -d --no-build 2>&1 | tail -20; echo "exit=$?"; date '+%T up xong'
    $DC ps ;;
  probe)
    for s in postgres redis api web; do id=$($DC ps -q $s); echo "== $s $(docker inspect -f '{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}} user={{.Config.User}} nanocpus={{.HostConfig.NanoCpus}} mem={{.HostConfig.Memory}} restart={{.HostConfig.RestartPolicy.Name}}' $id)"; done
    echo '--- redis policy / appendonly'; $DC exec -T redis redis-cli config get maxmemory-policy; $DC exec -T redis redis-cli config get maxmemory; $DC exec -T redis redis-cli config get appendonly
    echo '--- web user'; $DC exec -T web id -un
    echo '--- web eacces'; $DC logs --since 10m web 2>&1 | grep -ci eacces
    echo '--- api /api/health'; curl -s -m 10 -w '\nHTTP %{http_code}\n' http://127.0.0.1:$D10_API_PORT/api/health
    echo '--- web /'; curl -s -m 20 -o /dev/null -w 'HTTP %{http_code} %{time_total}s\n' http://127.0.0.1:$D10_WEB_PORT/
    echo '--- api PID 1 và cây tiến trình'; $DC exec -T api sh -c 'ps -o pid,ppid,args 2>/dev/null || ps'
    echo '--- api TZ'; $DC exec -T api sh -c 'echo TZ=$TZ; date'
    echo '--- api logs 15 dòng cuối'; $DC logs --tail 15 api 2>&1 | cut -c1-200 ;;
  drill)
    echo '--- runbook 3.4: DB trống tubutree_drill, migrate đủ bằng image mới'
    $DC exec -T postgres psql -U tubu -d postgres -c 'CREATE DATABASE tubutree_drill'
    echo '--- runbook mục 5 bước 4: danh sách chờ áp từ migrate status (DB trống: phải ra 207 dòng)'
    POSTGRES_DB=tubutree_drill $DC run --rm --no-deps -T api pnpm exec prisma migrate status 2>&1 | tr -d '\r' | grep -E '^[0-9]{14}_' | wc -l
    ( time POSTGRES_DB=tubutree_drill $DC run --rm --no-deps -T api pnpm exec prisma migrate deploy ) 2>&1 | tail -8
    POSTGRES_DB=tubutree_drill $DC run --rm --no-deps -T api pnpm exec prisma migrate status 2>&1 | tail -3
    $DC exec -T postgres psql -U tubu -d postgres -c 'DROP DATABASE tubutree_drill' ;;
  down)
    $DC down -v --remove-orphans 2>&1 | tail -10 ;;
  *) echo "dùng: $0 prep|up|probe|drill|down"; exit 2 ;;
esac
