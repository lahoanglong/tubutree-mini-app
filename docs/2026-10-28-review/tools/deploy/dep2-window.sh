#!/usr/bin/env bash
# Runbook mục 5, bước 5–9: dừng API, backup, migrate, seed:reference, bật web rồi API.
# Dùng: ssh ... 'bash -s' -- <SHA đầy đủ> <số migration chờ áp> < dep2-window.sh
# Lỗi trước bước migrate: bật lại đúng container API cũ ($DC start, không tạo lại nên vẫn là image cũ).
# Lỗi từ bước migrate trở đi: API để tắt, làm runbook mục 7.1.
set -euo pipefail
SHA="${1:?thiếu SHA}"; EXPECT="${2:?thiếu số migration chờ áp}"
cd /opt/tubutree
DC="docker compose -f docker-compose.vietnix.yml"
PGUSER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true); PGUSER=${PGUSER:-tubu}
PGDB=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true); PGDB=${PGDB:-tubutree}
psqlq() { $DC exec -T postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "DỪNG: HEAD khác SHA, chạy dep1 trước"; exit 1; }
[ "$(wc -l < .pending-migrations)" -eq "$EXPECT" ] || { echo "DỪNG: .pending-migrations khác $EXPECT"; exit 1; }

STAGE=pre
on_err() {
  if [ "$STAGE" = pre ]; then echo "LỖI trước migrate: bật lại API cũ"; $DC start api </dev/null; else echo "LỖI ở bước $STAGE: API để tắt, làm runbook 7.1"; fi
}
trap on_err ERR

T0=$(date +%s)
echo "== $(date '+%H:%M:%S') bước 5: dừng API"
$DC stop api </dev/null
$DC ps --format '{{.Service}} {{.State}}' </dev/null

echo "== $(date '+%H:%M:%S') bước 6: backup"
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB bash tools/backup/backup-db.sh </dev/null 2>&1 | tail -4
DUMP=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1)
echo "$DUMP" | tee .rollback-dump
ls -lh "$DUMP"; gunzip -t "$DUMP"; echo "gunzip OK"
BEFORE=$(psqlq -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" </dev/null)
psqlq -tAc "SELECT 'orders='||(SELECT count(*) FROM orders)||' users='||(SELECT count(*) FROM users)||' reviews='||(SELECT count(*) FROM reviews)||' migrations=$BEFORE'" </dev/null

STAGE=migrate
echo "== $(date '+%H:%M:%S') bước 7: migrate"
time $DC run --rm --no-deps -T api pnpm exec prisma migrate deploy </dev/null 2>&1 | grep -E 'Applying|applied|Error|error' || true
AFTER=$(psqlq -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" </dev/null)
DANGDO=$(psqlq -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" </dev/null)
echo "migration: $BEFORE -> $AFTER, dang_do=$DANGDO"
[ "$AFTER" -eq $((BEFORE + EXPECT)) ] && [ "$DANGDO" -eq 0 ] || { echo "DỪNG: số migration sai"; false; }
psqlq -c "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT $EXPECT" </dev/null

STAGE=seed
echo "== $(date '+%H:%M:%S') bước 7b: seed:reference"
$DC run --rm --no-deps -T api pnpm run prisma:seed:reference --with-business-defaults </dev/null 2>&1 | grep -E 'seed-reference|Error|error'

STAGE=up
echo "== $(date '+%H:%M:%S') bước 8–9: bật web, API"
$DC up -d --no-build --no-deps web </dev/null 2>&1 | tail -2
$DC up -d --no-build --no-deps api </dev/null 2>&1 | tail -2
s=unknown
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q api </dev/null)" 2>/dev/null || echo unknown)
  [ "$s" = healthy ] && break; sleep 3
done
echo "$(date '+%H:%M:%S') api=$s"
curl -s http://127.0.0.1:14001/api/health; echo
echo "API ngừng $(( $(date +%s) - T0 )) giây"
[ "$s" = healthy ] || { echo "DỪNG: API chưa healthy"; false; }
for i in $(seq 1 40); do
  w=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q web </dev/null)" 2>/dev/null || echo unknown)
  [ "$w" = healthy ] && break; sleep 3
done
echo "$(date '+%H:%M:%S') web=$w"
echo "$SHA" > .last-deployed-sha
trap - ERR
echo "== $(date '+%H:%M:%S') xong bước 5–9"
