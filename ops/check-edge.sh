#!/usr/bin/env bash
# Kiểm "biên" của Tubu Tree: DNS, hạn chứng chỉ, HTTP, nén, cache, /api/health, và (với --local) đĩa, container,
# cron gia hạn chứng chỉ, bản backup gần nhất. Chỉ ĐỌC: gọi GET tới URL công khai, đọc df/docker ps/crontab, không ghi gì.
# Chạy được trên macOS và Linux (cần bash, curl, openssl; dig/host/nslookup để kiểm DNS; perl hoặc timeout để chặn treo).
#
#   bash ops/check-edge.sh                 # từ máy bất kỳ: kiểm api.tubutree.com và app.tubutree.com
#   bash ops/check-edge.sh --local         # trên VPS: thêm đĩa, container unhealthy, cron certbot, backup
#   bash ops/check-edge.sh --help
set -u

API_HOST="${API_HOST:-api.tubutree.com}"
APP_HOST="${APP_HOST:-app.tubutree.com}"
EXPECT_IP="${EXPECT_IP:-14.225.207.177}"
API_PATH="${API_PATH:-/api/home}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-21}"
CERT_FAIL_DAYS="${CERT_FAIL_DAYS:-7}"
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"
DISK_FAIL_PCT="${DISK_FAIL_PCT:-90}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-8}"
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"
API_LOCAL_URL="${API_LOCAL_URL:-http://127.0.0.1:14001}"
APP_LOCAL_URL="${APP_LOCAL_URL:-http://127.0.0.1:14000}"
LOCAL=0

usage() {
  cat <<EOF
Dùng: bash ops/check-edge.sh [tuỳ chọn]

Kiểm DNS, hạn chứng chỉ TLS, HTTP, nén (content-encoding), cache (Cache-Control, cf-cache-status) và /api/health
của hai tên miền; với --local còn kiểm đĩa, container unhealthy, cron certbot và bản backup gần nhất.
Chỉ đọc, không đổi gì trên máy hay trên mạng.

Tuỳ chọn (có thể đặt bằng biến môi trường cùng tên viết hoa, mặc định trong ngoặc):
  --api-host HOST        tên miền API (api.tubutree.com)             API_HOST
  --app-host HOST        tên miền web (app.tubutree.com)             APP_HOST
  --expect-ip IP         IP VPS mong đợi ở DNS; rỗng = bỏ so sánh    EXPECT_IP (14.225.207.177)
  --api-path PATH        đường dẫn API dùng đo nén/cache (/api/home) API_PATH
  --warn-days N          chứng chỉ còn dưới N ngày thì WARN (21)     CERT_WARN_DAYS
  --fail-days N          chứng chỉ còn dưới N ngày thì FAIL (7)      CERT_FAIL_DAYS
  --disk-warn PCT        đĩa đầy từ PCT% thì WARN (80)               DISK_WARN_PCT
  --disk-fail PCT        đĩa đầy từ PCT% thì FAIL (90)               DISK_FAIL_PCT
  --backup-dir DIR       thư mục backup (/var/backups/tubutree)      BACKUP_DIR
  --backup-max-hours N   bản backup mới nhất cũ hơn N giờ thì WARN (8, cron 6 giờ/lần)  BACKUP_MAX_AGE_HOURS
  --timeout SECONDS      thời gian chờ mỗi request (15)              CURL_TIMEOUT
  --local                chạy trên VPS: thêm đĩa, docker, cron certbot, backup, cổng loopback 14001/14000
  -h, --help             in trợ giúp này

Mã thoát: 0 không có FAIL (WARN vẫn là 0), 1 có ít nhất một FAIL, 2 sai tham số.
Ví dụ cron kiểm hằng giờ trên VPS, chỉ in khi có vấn đề:
  7 * * * * bash /opt/tubutree/ops/check-edge.sh --local | grep -E '^\[(WARN|FAIL)\]'
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --local) LOCAL=1; shift ;;
    --api-host | --app-host | --expect-ip | --api-path | --warn-days | --fail-days | --disk-warn | --disk-fail | --backup-dir | --backup-max-hours | --timeout)
      if [ $# -lt 2 ]; then echo "Thiếu giá trị cho $1 (xem --help)" >&2; exit 2; fi
      case "$1" in
        --api-host) API_HOST="$2" ;;
        --app-host) APP_HOST="$2" ;;
        --expect-ip) EXPECT_IP="$2" ;;
        --api-path) API_PATH="$2" ;;
        --warn-days) CERT_WARN_DAYS="$2" ;;
        --fail-days) CERT_FAIL_DAYS="$2" ;;
        --disk-warn) DISK_WARN_PCT="$2" ;;
        --disk-fail) DISK_FAIL_PCT="$2" ;;
        --backup-dir) BACKUP_DIR="$2" ;;
        --backup-max-hours) BACKUP_MAX_AGE_HOURS="$2" ;;
        --timeout) CURL_TIMEOUT="$2" ;;
      esac
      shift 2
      ;;
    *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 2 ;;
  esac
done

for n in CERT_WARN_DAYS CERT_FAIL_DAYS DISK_WARN_PCT DISK_FAIL_PCT BACKUP_MAX_AGE_HOURS CURL_TIMEOUT; do
  case "$(eval "printf '%s' \"\$$n\"")" in
    '' | *[!0-9]*) echo "$n phải là số nguyên không âm (xem --help)" >&2; exit 2 ;;
  esac
done

N_OK=0
N_WARN=0
N_FAIL=0
ok() { N_OK=$((N_OK + 1)); printf '[ OK ] %s\n' "$*"; }
warn() { N_WARN=$((N_WARN + 1)); printf '[WARN] %s\n' "$*"; }
fail() { N_FAIL=$((N_FAIL + 1)); printf '[FAIL] %s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/check-edge.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# macOS không có `timeout`; perl có sẵn ở cả hai hệ điều hành.
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  else
    "$@"
  fi
}

# Giá trị header (không phân biệt hoa thường, lấy lần xuất hiện cuối). Rỗng nếu không có.
hdr() {
  tr -d '\r' <"$2" 2>/dev/null | awk -v k="$(lc "$1")" '
    { i = index($0, ":"); if (i > 0 && tolower(substr($0, 1, i - 1)) == k) { v = substr($0, i + 1); sub(/^[ \t]+/, "", v); last = v } }
    END { print last }'
}

# fetch URL PREFIX [tham số curl thêm...] → ghi PREFIX.h (header), PREFIX.body, PREFIX.err; đặt F_CODE và F_RC.
fetch() {
  local url="$1" prefix="$2"
  shift 2
  F_CODE="$(curl -sS -o "$prefix.body" -D "$prefix.h" -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$@" "$url" 2>"$prefix.err")"
  F_RC=$?
  [ -n "$F_CODE" ] || F_CODE=000
}

curl_reason() {
  case "$1" in
    6) echo "không phân giải được tên miền" ;;
    7) echo "không kết nối được (cổng đóng hoặc VPS tắt)" ;;
    28) echo "quá thời gian chờ ${CURL_TIMEOUT}s" ;;
    35 | 51 | 58 | 60) echo "lỗi TLS/chứng chỉ (curl $1)" ;;
    *) echo "curl thoát mã $1" ;;
  esac
}

resolve_a() {
  local out=""
  if command -v dig >/dev/null 2>&1; then
    out="$(dig +short +time=3 +tries=2 A "$1" 2>/dev/null)"
  elif command -v host >/dev/null 2>&1; then
    out="$(host -t A "$1" 2>/dev/null | awk '/has address/ { print $NF }')"
  elif command -v nslookup >/dev/null 2>&1; then
    out="$(nslookup -type=A "$1" 2>/dev/null | awk '/^Name:/ { f = 1 } f && /^Address/ { print $NF }')"
  else
    return 2
  fi
  printf '%s\n' "$out" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
  return 0
}

# Epoch của chuỗi `Jan  5 12:00:00 2027 GMT` (đầu ra của openssl x509 -enddate): GNU date rồi BSD date.
to_epoch() {
  local d
  d="$(printf '%s' "$1" | tr -s ' ')"
  date -u -d "$d" +%s 2>/dev/null && return 0
  date -u -j -f '%b %d %T %Y %Z' "$d" +%s 2>/dev/null
}

check_dns() {
  local host="$1" cloudflare="$2" ips list
  ips="$(resolve_a "$host")"
  if [ $? -eq 2 ]; then
    warn "$host DNS: máy này không có dig, host hay nslookup nên bỏ qua"
    return
  fi
  list="$(printf '%s' "$ips" | tr '\n' ' ' | sed 's/ $//')"
  if [ -z "$list" ]; then
    fail "$host DNS: không có bản ghi A"
  elif [ -z "$EXPECT_IP" ]; then
    info "$host DNS: $list"
  elif printf '%s\n' "$ips" | grep -qx "$EXPECT_IP"; then
    ok "$host DNS: $list (đúng IP VPS)"
  elif [ "$cloudflare" = 1 ]; then
    info "$host DNS: $list (IP biên Cloudflare, ☁ cam đang bật; IP VPS mong đợi $EXPECT_IP)"
  else
    warn "$host DNS: $list, mong đợi $EXPECT_IP (nếu bật ☁ cam của Cloudflare thì khác là bình thường)"
  fi
}

check_cert() {
  local host="$1" enddate end now days
  enddate="$(run_with_timeout 10 openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p')"
  if [ -z "$enddate" ]; then
    fail "$host chứng chỉ: không đọc được (cổng 443 đóng hoặc không có TLS)"
    return
  fi
  end="$(to_epoch "$enddate")"
  if [ -z "$end" ]; then
    warn "$host chứng chỉ: hết hạn $enddate (không tính được số ngày còn lại trên máy này)"
    return
  fi
  now="$(date -u +%s)"
  days=$(((end - now) / 86400))
  if [ "$end" -le "$now" ]; then
    fail "$host chứng chỉ: ĐÃ HẾT HẠN từ $enddate"
  elif [ "$days" -lt "$CERT_FAIL_DAYS" ]; then
    fail "$host chứng chỉ: còn $days ngày (hết hạn $enddate), cron certbot renew có chạy không?"
  elif [ "$days" -lt "$CERT_WARN_DAYS" ]; then
    warn "$host chứng chỉ: còn $days ngày (hết hạn $enddate)"
  else
    ok "$host chứng chỉ: còn $days ngày (hết hạn $enddate)"
  fi
}

# check_http LABEL URL KIND   (KIND = api: đòi s-maxage; app: chỉ in Cache-Control)
check_http() {
  local label="$1" url="$2" kind="$3" prefix="$TMP/$1" cloudflare=0 enc cc cfs age cfs2 size
  fetch "$url" "$prefix" -H 'Accept-Encoding: gzip, br'
  if [ "$F_RC" -ne 0 ]; then
    fail "$label HTTP: $url — $(curl_reason "$F_RC")"
    return
  fi
  if [ -n "$(hdr cf-ray "$prefix.h")" ]; then cloudflare=1; fi
  case "$F_CODE" in
    2??) ok "$label HTTP: $url → $F_CODE" ;;
    3??) warn "$label HTTP: $url → $F_CODE (chuyển hướng tới $(hdr location "$prefix.h"))" ;;
    *) fail "$label HTTP: $url → $F_CODE" ;;
  esac

  enc="$(hdr content-encoding "$prefix.h")"
  size="$(wc -c <"$prefix.body" | tr -d ' ')"
  if [ -n "$enc" ]; then
    ok "$label nén: content-encoding=$enc (${size} byte sau nén)"
  else
    warn "$label nén: không có content-encoding (${size} byte): mod_deflate chưa bật ở vhost, hoặc Cloudflare chưa proxy"
  fi

  cc="$(hdr cache-control "$prefix.h")"
  cfs="$(hdr cf-cache-status "$prefix.h")"
  age="$(hdr age "$prefix.h")"
  if [ "$kind" = api ]; then
    case "$cc" in
      *s-maxage*) ok "$label cache: Cache-Control=$cc" ;;
      *) warn "$label cache: Cache-Control='${cc:-<không có>}' (route công khai phải có s-maxage, xem PublicCache)" ;;
    esac
  else
    info "$label cache: Cache-Control=${cc:-<không có>}"
  fi
  if [ "$cloudflare" = 1 ]; then
    fetch "$url" "$prefix.2" -H 'Accept-Encoding: gzip, br'
    cfs2="$(hdr cf-cache-status "$prefix.2.h")"
    info "$label Cloudflare: cf-cache-status ${cfs:-<không có>} → ${cfs2:-<không có>}${age:+, age=$age}"
    if [ "$kind" = api ] && [ "$cfs2" != HIT ]; then
      info "$label Cloudflare: JSON chưa được cache ở biên (mặc định Cloudflare không cache JSON, cần Cache Rule, xem D6-07)"
    fi
  else
    info "$label biên: không thấy header Cloudflare (DNS only hoặc truy cập thẳng VPS)"
  fi
  CLOUDFLARE_SEEN="$cloudflare"
}

check_health() {
  local url="$1" label="$2" prefix="$TMP/health" body
  fetch "$url" "$prefix"
  if [ "$F_RC" -ne 0 ]; then
    fail "$label health: $url — $(curl_reason "$F_RC")"
    return
  fi
  body="$(head -c 200 "$prefix.body" | tr -d '\r\n')"
  if [ "$F_CODE" = 200 ]; then
    ok "$label health: $url → 200 $body"
  else
    fail "$label health: $url → $F_CODE $body"
  fi
}

check_host() {
  local label="$1" host="$2" path="$3" kind="$4"
  CLOUDFLARE_SEEN=0
  check_http "$label" "https://$host$path" "$kind"
  check_dns "$host" "$CLOUDFLARE_SEEN"
  check_cert "$host"
}

check_disk() {
  local path="$1" line pct mount
  [ -e "$path" ] || return 0
  line="$(df -P "$path" 2>/dev/null | awk 'NR == 2')"
  [ -n "$line" ] || return 0
  pct="$(printf '%s' "$line" | awk '{ gsub("%", "", $5); print $5 }')"
  mount="$(printf '%s' "$line" | awk '{ print $6 }')"
  case "$pct" in '' | *[!0-9]*) return 0 ;; esac
  if [ "$pct" -ge "$DISK_FAIL_PCT" ]; then
    fail "đĩa $path ($mount): đầy ${pct}% (từ ${DISK_FAIL_PCT}%): Postgres và log có thể ngừng ghi"
  elif [ "$pct" -ge "$DISK_WARN_PCT" ]; then
    warn "đĩa $path ($mount): đầy ${pct}% (từ ${DISK_WARN_PCT}%): dọn image cũ bằng docker image prune, xem docker system df"
  else
    ok "đĩa $path ($mount): đầy ${pct}%"
  fi
  df -h "$path" 2>/dev/null | sed 's/^/       /'
}

check_local() {
  local bad names newest fresh
  info "--- Máy này ($(hostname 2>/dev/null || echo '?')) ---"
  check_disk /
  [ "$(df -P /var/lib/docker 2>/dev/null | awk 'NR == 2 { print $6 }')" = "$(df -P / 2>/dev/null | awk 'NR == 2 { print $6 }')" ] || check_disk /var/lib/docker

  if command -v docker >/dev/null 2>&1; then
    if names="$(docker ps --format '{{.Names}} {{.Status}}' 2>&1)"; then
      bad="$(printf '%s\n' "$names" | grep -Ei 'unhealthy|restarting' || true)"
      if [ -n "$bad" ]; then
        fail "docker: container có vấn đề: $(printf '%s' "$bad" | tr '\n' ';')"
      else
        ok "docker: không có container unhealthy hoặc restarting ($(printf '%s\n' "$names" | grep -c . | tr -d ' ') đang chạy)"
      fi
    else
      warn "docker: không đọc được docker ps (thiếu quyền?): $(printf '%s' "$names" | head -1)"
    fi
  else
    info "docker: không có lệnh docker trên máy này, bỏ qua"
  fi

  check_health "$API_LOCAL_URL/api/health" "api (loopback)"
  fetch "$APP_LOCAL_URL/" "$TMP/applocal"
  if [ "$F_RC" -ne 0 ]; then fail "web (loopback) HTTP: $APP_LOCAL_URL/ — $(curl_reason "$F_RC")"
  elif [ "$F_CODE" = 200 ]; then ok "web (loopback) HTTP: $APP_LOCAL_URL/ → 200"
  else fail "web (loopback) HTTP: $APP_LOCAL_URL/ → $F_CODE"; fi

  if crontab -l 2>/dev/null | grep -q certbot || grep -rqs certbot /etc/cron.d /etc/crontab 2>/dev/null ||
    { command -v systemctl >/dev/null 2>&1 && systemctl list-timers 2>/dev/null | grep -q certbot; }; then
    ok "chứng chỉ: có cron hoặc timer certbot gia hạn"
  else
    warn "chứng chỉ: không thấy cron hoặc timer certbot (xem ops/README-vietnix-deploy.md, mục certbot renew); crontab của root chỉ đọc được bằng root, thử lại với sudo"
  fi

  if [ -d "$BACKUP_DIR" ]; then
    newest="$(ls -t "$BACKUP_DIR"/tubutree_*.sql.gz 2>/dev/null | head -1)"
    if [ -z "$newest" ]; then
      fail "backup: $BACKUP_DIR chưa có file tubutree_*.sql.gz nào"
    else
      fresh="$(find "$BACKUP_DIR" -maxdepth 1 -name 'tubutree_*.sql.gz' -mmin "-$((BACKUP_MAX_AGE_HOURS * 60))" 2>/dev/null | head -1)"
      if [ -n "$fresh" ]; then
        ok "backup: bản mới nhất trong ${BACKUP_MAX_AGE_HOURS} giờ qua ($(basename "$newest"))"
      else
        warn "backup: bản mới nhất ($(basename "$newest")) cũ hơn ${BACKUP_MAX_AGE_HOURS} giờ, cron backup có chạy không? tail /var/log/tubutree-backup.log"
      fi
    fi
  else
    warn "backup: không thấy thư mục $BACKUP_DIR (chưa cài backup, hoặc chạy bằng user không đọc được)"
  fi
}

printf 'Tubu Tree check-edge %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
info "--- $API_HOST ---"
check_host api "$API_HOST" "$API_PATH" api
check_health "https://$API_HOST/api/health" "api"
info "--- $APP_HOST ---"
check_host app "$APP_HOST" "/" app
if [ "$LOCAL" = 1 ]; then check_local; fi

printf '\nTổng: %s OK, %s WARN, %s FAIL\n' "$N_OK" "$N_WARN" "$N_FAIL"
[ "$N_FAIL" -eq 0 ]
