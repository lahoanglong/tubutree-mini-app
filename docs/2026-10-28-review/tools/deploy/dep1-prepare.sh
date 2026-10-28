#!/usr/bin/env bash
# Runbook docs/launch/deploy-rollback-runbook.md mục 5, bước 1–4 (API cũ vẫn phục vụ khách).
# Dùng: ssh -i ~/.ssh/chodeli_vietnix_vps root@14.225.207.177 'bash -s' -- <SHA đầy đủ> < dep1-prepare.sh
# Chạy lại an toàn: ff-only, thẻ rollback chỉ đặt khi image đang chạy khác image mới build.
set -euo pipefail
SHA="${1:?thiếu SHA}"
cd /opt/tubutree
DC="docker compose -f docker-compose.vietnix.yml"
echo "== $(date '+%H:%M:%S') bước 1: lấy mã"
df -h / | tail -1
if [ -n "$(git status --short)" ]; then echo "DỪNG: git status không trống"; git status --short; exit 1; fi
OLD=$(git rev-parse HEAD)
git fetch -q origin
git merge -q --ff-only "$SHA"
git log -1 --format='%h %s'
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "DỪNG: HEAD khác SHA"; exit 1; }
if git diff --quiet "$OLD" HEAD -- docker-compose.vietnix.yml; then echo "compose không đổi"; else echo "CHÚ Ý: compose đổi"; fi

echo "== $(date '+%H:%M:%S') bước 2: giữ image đang chạy"
API_C=$($DC ps -q api </dev/null); WEB_C=$($DC ps -q web </dev/null)
[ -n "$API_C" ] && [ -n "$WEB_C" ] || { echo "DỪNG: api hoặc web không chạy"; exit 1; }
API_ID=$(docker inspect -f '{{.Image}}' "$API_C"); API_NAME=$(docker inspect -f '{{.Config.Image}}' "$API_C")
WEB_ID=$(docker inspect -f '{{.Image}}' "$WEB_C"); WEB_NAME=$(docker inspect -f '{{.Config.Image}}' "$WEB_C")
CUR_SHA=$(cat .last-deployed-sha)
printf 'API_ID=%s\nAPI_NAME=%s\nWEB_ID=%s\nWEB_NAME=%s\n' "$API_ID" "$API_NAME" "$WEB_ID" "$WEB_NAME" | tee .rollback-images
for t in rollback "prev-${CUR_SHA:0:8}"; do
  docker tag "$API_ID" "${API_NAME%%:*}:$t"
  docker tag "$WEB_ID" "${WEB_NAME%%:*}:$t"
done
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep tubutree

echo "== $(date '+%H:%M:%S') .env: trần cache ảnh"
if ! grep -q '^IMAGE_CACHE_MAX_MB=' .env; then
  cp -p .env ".env.bak.$(date +%Y%m%d-%H%M%S)"
  echo 'IMAGE_CACHE_MAX_MB=200' >> .env
fi
grep '^IMAGE_' .env

echo "== $(date '+%H:%M:%S') bước 3: build"
$DC build api web </dev/null 2>&1 | tail -4
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' | grep -E 'tubutree-(api|web):latest'

echo "== $(date '+%H:%M:%S') sharp trong image mới"
$DC run --rm --no-deps -T api node -e "const s=require('sharp');s({create:{width:4,height:4,channels:3,background:'#2f7d32'}}).webp().toBuffer().then(b=>console.log('sharp ok',b.length,'byte, vips',s.versions.vips)).catch(e=>{console.error('sharp LỖI',e.message);process.exit(1)})" </dev/null

echo "== $(date '+%H:%M:%S') bước 4: check-env, go-live pre-deploy, migration chờ áp"
$DC run --rm --no-deps -T api node dist/config/check-env.js </dev/null
set +e
$DC run --rm --no-deps -T --user "$(stat -c %u:%g /var/backups/tubutree)" -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check -- --phase=pre-deploy </dev/null > .golive-pre.txt 2>&1
echo "go-live pre-deploy exit $?"
set -e
grep -E 'FAIL|WARN' .golive-pre.txt | sed 's/^/  /' | head -30
# migrate status thoát 1 khi còn migration chờ áp, nên không để pipefail dừng script ở đây.
{ $DC run --rm --no-deps -T api pnpm exec prisma migrate status </dev/null 2>&1 || true; } | tr -d '\r' | { grep -E '^[0-9]{14}_' || true; } | tee .pending-migrations | wc -l
df -h / | tail -1
echo "== $(date '+%H:%M:%S') xong bước 1–4"
