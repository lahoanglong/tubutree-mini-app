#!/usr/bin/env bash
# Gọi nóng 20 route chính của web ngay sau deploy (wave release chạy tay, không chạy tự động).
#
# Lý do (đo ở tubu-w4-05 trên bản dựng cục bộ trỏ API PROD): mỗi lần deploy là một thư mục .next mới, bộ đệm ISR chỉ có trang dựng sẵn lúc build.
# Trang sản phẩm không dựng sẵn nên khách ĐẦU TIÊN mở mỗi trang phải chờ dựng theo yêu cầu (0,85 s, x-nextjs-cache: MISS); khách sau nhận bản đệm
# (4–8 ms, HIT). Khi đã có bản đệm, hết hạn revalidate thì Next trả bản cũ ngay (14 ms, STALE) và dựng lại ở nền, không chặn khách.
# Script này để chính máy deploy gánh lần MISS đó cho 12 trang chính và 8 trang sản phẩm đầu Trang chủ.
#
#   scripts/perf/warm-routes.sh [https://tubutree.com]
#
# Chỉ GET, không cookie, không đăng nhập. Thoát 1 nếu route nào trả mã khác 2xx/3xx. Chạy được bằng bash 3.2 (macOS) lẫn bash 5.
set -euo pipefail

BASE="${1:-https://tubutree.com}"
BASE="${BASE%/}"
UA="tubu-warm-routes/1"
ROUTES="/ /san-pham /ban-chay /hub-san-pham /vuon-xanh /hop-xanh /uu-dai /gio-vang /mua-chung /cau-chuyen /hoc-vien /doi-rac"
PDP_COUNT=8

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Lần gọi `/` cũng lấy HTML để chọn trang sản phẩm theo đúng thứ tự khách thấy, mỗi slug một lần.
probe() {
  local out
  out="$(curl -sS -o "$tmp/body" -D "$tmp/head" -A "$UA" --max-time 30 -w '%{http_code} %{time_starttransfer}' "$BASE$1" 2>/dev/null)" || out="000 -"
  echo "$out $(grep -i '^x-nextjs-cache' "$tmp/head" 2>/dev/null | tr -d '\r' | awk '{print $2}')"
}

bad=0
count=0
printf '| Route | HTTP | TTFB (s) | x-nextjs-cache |\n|---|---:|---:|---|\n'
row() {
  local route=$1 res code
  res="$(probe "$route")"
  code="${res%% *}"
  set -- $res
  printf '| %s | %s | %s | %s |\n' "$route" "$1" "$2" "${3:-}"
  count=$((count + 1))
  case "$code" in 2*|3*) ;; *) bad=1 ;; esac
}

pdps=""
for route in $ROUTES; do
  row "$route"
  if [ "$route" = "/" ] && [ -f "$tmp/body" ]; then
    pdps="$(grep -o 'href="/san-pham/[a-z0-9-]*"' "$tmp/body" | sed 's/^href="//; s/"$//' | awk '!seen[$0]++' | head -n "$PDP_COUNT" || true)"
  fi
done
for route in $pdps; do
  row "$route"
done
echo "Đã gọi $count route trên $BASE."
exit "$bad"
