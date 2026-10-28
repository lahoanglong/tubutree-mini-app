#!/usr/bin/env bash
# Runbook mục 5, bước 10–11: go-live post-deploy, smoke, và các điểm riêng của đợt 28/10
# (ảnh đổi cỡ bằng sharp, WELCOME30, khoá cấu hình mới). Chỉ đọc, chạy lại bao nhiêu lần cũng được.
# Dùng: ssh ... 'bash -s' < dep3-check.sh
set -uo pipefail
cd /opt/tubutree
DC="docker compose -f docker-compose.vietnix.yml"
PGUSER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true); PGUSER=${PGUSER:-tubu}
PGDB=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true); PGDB=${PGDB:-tubutree}
psqlq() { $DC exec -T postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }

echo "== $(date '+%H:%M:%S') bước 10: go-live post-deploy"
$DC run --rm --no-deps -T --user "$(stat -c %u:%g /var/backups/tubutree)" -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check </dev/null > .golive-post.txt 2>&1
echo "go-live exit $?"
grep -E 'FAIL|WARN' .golive-post.txt | sed 's/^/  /' | head -30

echo "== $(date '+%H:%M:%S') bước 11: smoke"
curl -s https://api.tubutree.com/api/health; echo
curl -s -o /dev/null -w 'config/public %{http_code}\n' https://api.tubutree.com/api/config/public
curl -s -o /dev/null -w 'web / %{http_code}\n' https://app.tubutree.com/
curl -s -o /dev/null -w 'web /san-pham %{http_code}\n' https://app.tubutree.com/san-pham
curl -s -o /dev/null -w 'pancake-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/pancake
curl -s -o /dev/null -w 'gomdon-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/gomdon
curl -s -o /dev/null -w 'admin/dashboard/today khong-token %{http_code}\n' https://api.tubutree.com/api/admin/dashboard/today
$DC exec -T redis redis-cli config get maxmemory-policy </dev/null | tr '\n' ' '; echo

echo "-- ảnh đổi cỡ (/api/img)"
IMG=$(curl -s 'https://api.tubutree.com/api/products?limit=20' | grep -o -E '"(images|imageUrl|thumbnail)"[^]]*' | grep -o -E 'https://[^"]+' | head -1)
echo "ảnh gốc: ${IMG:-không tìm thấy}"
if [ -n "$IMG" ]; then
  U=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$IMG")
  curl -s -o /dev/null -H 'Accept: image/webp' -w 'img w=320 lần 1 %{http_code} %{content_type} %{size_download}B %{time_total}s\n' "https://api.tubutree.com/api/img?u=$U&w=320"
  curl -s -o /dev/null -H 'Accept: image/webp' -w 'img w=320 lần 2 %{http_code} %{content_type} %{size_download}B %{time_total}s\n' "https://api.tubutree.com/api/img?u=$U&w=320"
  curl -s -o /dev/null -w 'ảnh gốc %{size_download}B\n' "$IMG"
fi
curl -s -o /dev/null -w 'img host lạ %{http_code}\n' 'https://api.tubutree.com/api/img?u=https%3A%2F%2Fexample.com%2Fa.jpg&w=320'

echo "-- DB"
psqlq -tAc "SELECT code||' active='||\"isActive\"||' newCustomerOnly='||\"newCustomerOnly\" FROM coupons WHERE code='WELCOME30'" </dev/null
psqlq -tAc "SELECT key||'='||value::text FROM system_configs WHERE key IN ('affiliate.auto_wallet_transfer_enabled','loyalty.tier_drop_notice_days','loyalty.tier_drop_zns_template_id') ORDER BY key" </dev/null
psqlq -tAc "SELECT code FROM notification_templates WHERE code IN ('TIER_DROP_NOTICE','COMMISSION_WALLET_CREDITED','COMMISSION_WALLET_TAX_ONLY') ORDER BY code" </dev/null

echo "-- log API 10 phút"
$DC logs --since 10m api </dev/null 2>&1 | grep -c -iE 'chạy cron' | sed 's/^/dòng "chạy cron": /'
$DC logs --since 10m api </dev/null 2>&1 | grep -iE '\berror\b' | grep -v -iE 'ErrorBoundary' | tail -5
echo "-- đĩa và cache ảnh"
df -h / | tail -1
$DC exec -T api sh -c 'du -sh "${IMAGE_CACHE_DIR:-/tmp/tubu-img-cache}" 2>/dev/null || echo "chưa có cache"' </dev/null
cat .last-deployed-sha
