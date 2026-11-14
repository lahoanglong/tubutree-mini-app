#!/usr/bin/env bash
# Kiểm "sẵn sàng cutover apex tubutree.com": chứng chỉ SSL, công cụ cấp chứng chỉ DNS-01 Cloudflare, app/api, đĩa, backup Postgres, bảng chuyển hướng.
# CHỈ ĐỌC: không cài vhost, không đổi DNS, không cấp hay gia hạn chứng chỉ, không đụng Apache/WordPress, không ghi file nào của dự án hay hệ thống (kể cả tệp tạm, __pycache__).
# Chỉ chạy lệnh đọc: openssl x509/verify/s_client, curl GET, df, stat, gzip -t, docker inspect, và node chạy bảng luật ở chế độ --offline (không mạng).
# Ngoại lệ duy nhất: khi máy thiếu Node >= 22.18 thì `docker run --rm --network none --read-only` (container tạm, tự xoá, mã nguồn gắn chỉ đọc).
# Ngoài chứng chỉ, script kiểm đủ 4 điều kiện chặn của docs/launch/apex-cutover-rehearsal-2026-11-14.md: SITE_URL (sitemap), CORS_ORIGINS (env container api), luật chuyển hướng mới đã chạy trên Next.
# Giá trị token Cloudflare KHÔNG BAO GIỜ được in: script chỉ kiểm khoá có mặt, giá trị không rỗng, quyền file.
#
#   bash ops/pre-cutover-check.sh           # trên VPS bằng root (đọc được /etc/letsencrypt và /root/.secrets); từ máy khác thì các mục cục bộ báo ACTION_NEEDED
#   bash ops/pre-cutover-check.sh --help
#
# Mỗi hạng mục in một dòng:  [READY] hoặc [ACTION_NEEDED], mã hạng mục, lý do. Mã thoát: 0 mọi hạng mục READY, 1 còn ACTION_NEEDED, 2 sai tham số.
# Script này KHÔNG quyết định cutover và không chạy cutover: bước cài vhost là việc của chủ, theo docs/launch/apex-cutover-rehearsal-2026-11-14.md.
#
# Biến môi trường (mặc định trong ngoặc), chủ yếu để diễn tập/kiểm thử:
#   VHOST_SRC (ops/vietnix-vhost-apex.conf.cutover)  CERT_FILE, KEY_FILE (lấy từ SSLCertificateFile/SSLCertificateKeyFile của VHOST_SRC)
#   SAN_REQUIRED ("tubutree.com www.tubutree.com")   MIN_CERT_DAYS (14)   LIVE_TLS_HOSTS ("app.tubutree.com api.tubutree.com", rỗng = bỏ qua)
#   APP_URL (https://app.tubutree.com/)  API_HEALTH_URL (https://api.tubutree.com/api/health)  CURL_TIMEOUT (15)
#   DISK_PATHS ("/ /var/lib/docker")  MIN_DISK_FREE_PCT (20)
#   BACKUP_DIR (/var/backups/tubutree)  BACKUP_MAX_AGE_HOURS (8)
#   CF_CREDENTIALS (/root/.secrets/cloudflare.ini)  ACME_HOME ($HOME/.acme.sh)
#   NODE_BIN (node)  WEB_CONTAINER (tubutree-web-1)  API_CONTAINER (tubutree-api-1)
#   CA_FILE (rỗng = kho CA của hệ thống; chuỗi chứng chỉ phải được CA này tin)
#   NEXT_URL (http://127.0.0.1:14000)  CANON_HOST (tubutree.com)  CORS_ORIGIN_REQUIRED (https://tubutree.com)  LIVE_REDIRECT_PATH (/post-sitemap1.xml)
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd)"
VHOST_SRC="${VHOST_SRC:-$SELF_DIR/vietnix-vhost-apex.conf.cutover}"
CERT_FILE="${CERT_FILE:-}"
KEY_FILE="${KEY_FILE:-}"
SAN_REQUIRED="${SAN_REQUIRED-tubutree.com www.tubutree.com}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
LIVE_TLS_HOSTS="${LIVE_TLS_HOSTS-app.tubutree.com api.tubutree.com}"
APP_URL="${APP_URL:-https://app.tubutree.com/}"
API_HEALTH_URL="${API_HEALTH_URL:-https://api.tubutree.com/api/health}"
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"
DISK_PATHS="${DISK_PATHS-/ /var/lib/docker}"
MIN_DISK_FREE_PCT="${MIN_DISK_FREE_PCT:-20}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tubutree}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-8}"
CF_CREDENTIALS="${CF_CREDENTIALS:-/root/.secrets/cloudflare.ini}"
ACME_HOME="${ACME_HOME:-${HOME:-/root}/.acme.sh}"
NODE_BIN="${NODE_BIN:-node}"
WEB_CONTAINER="${WEB_CONTAINER:-tubutree-web-1}"
API_CONTAINER="${API_CONTAINER:-tubutree-api-1}"
CA_FILE="${CA_FILE:-}"
NEXT_URL="${NEXT_URL:-http://127.0.0.1:14000}"
CANON_HOST="${CANON_HOST:-tubutree.com}"
CORS_ORIGIN_REQUIRED="${CORS_ORIGIN_REQUIRED:-https://tubutree.com}"
LIVE_REDIRECT_PATH="${LIVE_REDIRECT_PATH:-/post-sitemap1.xml}"

usage() { sed -n '2,/^set -u/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
case "${1:-}" in
  '') ;;
  -h | --help) usage; exit 0 ;;
  *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 2 ;;
esac
for n in MIN_CERT_DAYS CURL_TIMEOUT MIN_DISK_FREE_PCT BACKUP_MAX_AGE_HOURS; do
  case "$(eval "printf '%s' \"\$$n\"")" in
    '' | *[!0-9]*) echo "$n phải là số nguyên không âm (xem --help)" >&2; exit 2 ;;
  esac
done

N_READY=0
N_ACTION=0
ready() { N_READY=$((N_READY + 1)); printf '[READY]         %-14s %s\n' "$1" "$2"; }
action() { N_ACTION=$((N_ACTION + 1)); printf '[ACTION_NEEDED] %-14s %s\n' "$1" "$2"; }
info() { printf '[INFO]          %s\n' "$*"; }
# verdict ID MÔ-TẢ-LỖI MÔ-TẢ-OK: lỗi rỗng thì READY.
verdict() { if [ -z "$2" ]; then ready "$1" "$3"; else action "$1" "$2"; fi; }

# macOS không có `timeout`; perl có sẵn ở cả hai hệ điều hành.
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"
  elif command -v perl >/dev/null 2>&1; then perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  else "$@"; fi
}

# Epoch của chuỗi `Jan  5 12:00:00 2027 GMT` (đầu ra của openssl x509 -enddate): GNU date rồi BSD date.
to_epoch() {
  local d
  d="$(printf '%s' "$1" | tr -s ' ')"
  date -u -d "$d" +%s 2>/dev/null && return 0
  date -u -j -f '%b %d %T %Y %Z' "$d" +%s 2>/dev/null
}

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }

# san_covers "<danh sách tên, mỗi dòng một tên>" TÊN: khớp đúng tên, hoặc *.cha phủ đúng một nhãn con (không phủ apex).
san_covers() {
  local want n parent
  want="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r n; do
    n="$(printf '%s' "$n" | sed 's/^ *//; s/ *$//' | tr '[:upper:]' '[:lower:]')"
    [ -n "$n" ] || continue
    [ "$n" = "$want" ] && return 0
    case "$n" in
      '*.'*)
        parent="${n#*.}"
        case "$want" in *.*) [ "${want#*.}" = "$parent" ] && return 0 ;; esac
        ;;
    esac
  done <<<"$1"
  return 1
}

# Đọc tệp chứng chỉ: in "SAN:<tên>" mỗi dòng, "END:<notAfter>". Chỉ đọc.
cert_facts() {
  openssl x509 -noout -text -in "$1" 2>/dev/null | awk '/Subject Alternative Name/ { getline; gsub(/DNS:/, ""); n = split($0, a, ","); for (i = 1; i <= n; i++) { gsub(/^ +| +$/, "", a[i]); if (a[i] != "") print "SAN:" a[i] } }'
  openssl x509 -noout -enddate -in "$1" 2>/dev/null | sed -n 's/^notAfter=/END:/p'
}

days_left() {
  local end now
  end="$(to_epoch "$1")"
  [ -n "$end" ] || return 1
  now="$(date -u +%s)"
  echo $(((end - now) / 86400))
}

# ── 1. vhost nguồn và chứng chỉ dự kiến ───────────────────────────────────────────────────────────────────────────────────────────
check_vhost_source() {
  if [ ! -f "$VHOST_SRC" ]; then
    action vhost-src "thiếu vhost nguồn $VHOST_SRC"
    return
  fi
  [ -n "$CERT_FILE" ] || CERT_FILE="$(awk '$1 == "SSLCertificateFile" { print $2; exit }' "$VHOST_SRC")"
  [ -n "$KEY_FILE" ] || KEY_FILE="$(awk '$1 == "SSLCertificateKeyFile" { print $2; exit }' "$VHOST_SRC")"
  if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
    action vhost-src "vhost nguồn không khai SSLCertificateFile/SSLCertificateKeyFile: $VHOST_SRC"
    return
  fi
  ready vhost-src "vhost cutover đọc chứng chỉ ở $CERT_FILE (khoá $KEY_FILE)"
}

check_cert_file() {
  [ -n "$CERT_FILE" ] || return 0
  local problems="" facts sans end days pub_c pub_k name verify_out
  if [ ! -r "$CERT_FILE" ]; then
    if [ -e "$CERT_FILE" ]; then
      problems="có $CERT_FILE nhưng không đọc được (chạy bằng root)"
    elif [ "$(id -u)" != 0 ]; then
      problems="không thấy $CERT_FILE (chưa cấp, hoặc không chạy bằng root nên không vào được thư mục)"
    else
      problems="chưa có $CERT_FILE: chưa cấp chứng chỉ cho tubutree.com (HTTP-01 không chạy được khi apex còn ở ZenCloud, cần DNS-01)"
    fi
    action cert-file "$problems"
    return
  fi
  facts="$(cert_facts "$CERT_FILE")"
  sans="$(printf '%s\n' "$facts" | sed -n 's/^SAN://p')"
  end="$(printf '%s\n' "$facts" | sed -n 's/^END://p' | head -1)"
  if [ -z "$sans" ] || [ -z "$end" ]; then
    action cert-file "$CERT_FILE không phải chứng chỉ PEM đọc được (hoặc không có Subject Alternative Name)"
    return
  fi
  for name in $SAN_REQUIRED; do
    san_covers "$sans" "$name" || problems="${problems}${problems:+; }SAN không phủ $name"
  done
  if ! openssl x509 -checkend $((MIN_CERT_DAYS * 86400)) -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    problems="${problems}${problems:+; }hết hạn trong < $MIN_CERT_DAYS ngày (notAfter $end)"
  fi
  if [ -r "$KEY_FILE" ]; then
    pub_c="$(openssl x509 -noout -pubkey -in "$CERT_FILE" 2>/dev/null | openssl sha256 2>/dev/null)"
    pub_k="$(openssl pkey -pubout -in "$KEY_FILE" 2>/dev/null | openssl sha256 2>/dev/null)"
    if [ -z "$pub_c" ] || [ "$pub_c" != "$pub_k" ]; then problems="${problems}${problems:+; }khoá riêng $KEY_FILE KHÔNG khớp chứng chỉ"; fi
  else
    problems="${problems}${problems:+; }không đọc được khoá riêng $KEY_FILE"
  fi
  # Chuỗi phải được CA tin cậy: chứng chỉ tự ký hoặc staging (certbot --test-cert) có SAN/hạn/khoá đúng nhưng trình duyệt nào cũng từ chối.
  verify_out="$(if [ -n "$CA_FILE" ]; then openssl verify -CAfile "$CA_FILE" -untrusted "$CERT_FILE" "$CERT_FILE" 2>&1; else openssl verify -untrusted "$CERT_FILE" "$CERT_FILE" 2>&1; fi)"
  if ! printf '%s\n' "$verify_out" | grep -q ': OK$'; then
    problems="${problems}${problems:+; }chuỗi chứng chỉ KHÔNG được CA tin cậy (tự ký, staging, thiếu intermediate hoặc đã hết hạn): $(printf '%s\n' "$verify_out" | grep -i 'error' | head -1 | cut -c1-120)"
  fi
  days="$(days_left "$end" || echo '?')"
  verdict cert-file "$problems" "chứng chỉ phủ $(printf '%s' "$SAN_REQUIRED" | tr ' ' ','), còn $days ngày (>= $MIN_CERT_DAYS), khoá khớp, chuỗi CA tin cậy"
}

check_cert_live() {
  local host="$1" label enddate days
  label="cert-${host%%.*}"
  enddate="$(run_with_timeout 10 openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p')"
  if [ -z "$enddate" ]; then
    action "$label" "$host: không đọc được chứng chỉ đang chạy (cổng 443 đóng hoặc không có TLS)"
    return
  fi
  days="$(days_left "$enddate" || true)"
  if [ -z "$days" ]; then
    action "$label" "$host: hết hạn $enddate nhưng máy này không tính được số ngày còn lại"
  elif [ "$days" -lt "$MIN_CERT_DAYS" ]; then
    action "$label" "$host: chứng chỉ còn $days ngày (< $MIN_CERT_DAYS), hết hạn $enddate"
  else
    ready "$label" "$host: chứng chỉ còn $days ngày (>= $MIN_CERT_DAYS)"
  fi
}

# ── 2. Công cụ cấp chứng chỉ DNS-01 Cloudflare (chỉ kiểm có mặt, không chạy) ──────────────────────────────────────────────────────
certbot_has_cloudflare_plugin() {
  local py first
  # `dpkg -s` thoát 0 cả với gói đã gỡ còn lại tệp cấu hình (deinstall ok config-files): phải đúng "install ok installed". Certbot bản snap không dùng plugin của apt.
  case "$(command -v certbot 2>/dev/null)" in
    /snap/* | */snap/bin/*) ;;
    *) if command -v dpkg-query >/dev/null 2>&1 && [ "$(dpkg-query -W -f='${Status}' python3-certbot-dns-cloudflare 2>/dev/null)" = "install ok installed" ]; then return 0; fi ;;
  esac
  if command -v snap >/dev/null 2>&1 && snap list certbot-dns-cloudflare >/dev/null 2>&1; then return 0; fi
  # Interpreter của chính certbot (venv, /opt/certbot...): chỉ chạy khi đúng là python*, không bao giờ chạy `-c import ...` bằng sh (có máy `import` là lệnh chụp màn hình).
  first="$(head -n 1 "$(command -v certbot)" 2>/dev/null)"
  py=""
  case "$first" in
    '#!'/*)
      # shellcheck disable=SC2086 # tách từ có chủ ý: dòng shebang
      set -- ${first#\#!}
      py="$1"
      case "$py" in */env) py="$(command -v "${2:-python3}" 2>/dev/null || true)" ;; esac
      case "$(basename "${py:-x}")" in python*) ;; *) py="" ;; esac
      ;;
  esac
  if [ -n "$py" ] && [ -x "$py" ] && "$py" -B -c 'import certbot_dns_cloudflare' >/dev/null 2>&1; then return 0; fi
  if command -v python3 >/dev/null 2>&1 && python3 -B -c 'import certbot_dns_cloudflare' >/dev/null 2>&1; then return 0; fi
  return 1
}

check_dns01_tool() {
  local via="" miss="" acme_sh=""
  if command -v certbot >/dev/null 2>&1; then
    if certbot_has_cloudflare_plugin; then via="certbot + plugin dns-cloudflare"; else miss="certbot có nhưng THIẾU plugin dns-cloudflare (gói python3-certbot-dns-cloudflare)"; fi
  else
    miss="không có certbot"
  fi
  if [ -z "$via" ]; then
    acme_sh="$(command -v acme.sh 2>/dev/null || true)"
    [ -n "$acme_sh" ] || { [ -x "$ACME_HOME/acme.sh" ] && acme_sh="$ACME_HOME/acme.sh"; }
    if [ -n "$acme_sh" ] && [ -f "$ACME_HOME/dnsapi/dns_cf.sh" ]; then
      via="acme.sh + dnsapi dns_cf"
    else
      miss="${miss}; không có acme.sh với dnsapi/dns_cf.sh${acme_sh:+ (có acme.sh nhưng thiếu dns_cf)}"
    fi
  fi
  if [ -n "$via" ]; then ready dns01-tool "có công cụ DNS-01 Cloudflare: $via"
  else action dns01-tool "chưa có công cụ cấp chứng chỉ DNS-01 Cloudflare: $miss (công thức: docs/2026-09-12-deploy-runbook.md mục 1.6.4)"; fi
}

# Token Cloudflare: chỉ kiểm CÓ và KHÔNG RỖNG, không bao giờ đọc ra biến hay in giá trị. Nguồn: tệp credentials của certbot, acme.sh account.conf, biến môi trường.
check_cf_token() {
  local found="" problem="" mode
  if [ -e "$CF_CREDENTIALS" ]; then
    if [ ! -r "$CF_CREDENTIALS" ]; then
      problem="$CF_CREDENTIALS không đọc được (chạy bằng root)"
    elif ! grep -Eq '^[[:space:]]*dns_cloudflare_api_token[[:space:]]*=[[:space:]]*[^[:space:]]+' "$CF_CREDENTIALS" 2>/dev/null; then
      problem="$CF_CREDENTIALS không có dòng dns_cloudflare_api_token = <giá trị> không rỗng"
    else
      mode="$(mode_of "$CF_CREDENTIALS")"
      case "$mode" in
        *00) found="tệp $CF_CREDENTIALS (mode $mode)" ;;
        *) problem="$CF_CREDENTIALS mode $mode: phải 600 (certbot từ chối và token lộ cho người khác trên máy)" ;;
      esac
    fi
  fi
  if [ -z "$found" ] && [ -r "$ACME_HOME/account.conf" ] && grep -Eq "^SAVED_CF_Token=['\"]?[^'\" ]+" "$ACME_HOME/account.conf" 2>/dev/null; then
    found="acme.sh account.conf (SAVED_CF_Token)"
  fi
  if [ -z "$found" ] && { [ -n "${CF_Token:-}" ] || [ -n "${CF_API_TOKEN:-}" ]; }; then
    found="biến môi trường CF_Token/CF_API_TOKEN"
  fi
  if [ -n "$found" ]; then
    ready cf-token "có token Cloudflare ở $found (giá trị không in; quyền Zone:DNS:Edit chỉ kiểm được khi cấp thật)"
  else
    action cf-token "chưa có token Cloudflare dùng được${problem:+ ($problem)}: cần token quyền Zone:DNS:Edit của chủ, đặt ở $CF_CREDENTIALS (mode 600, dòng dns_cloudflare_api_token = ...)"
  fi
}

# ── 3. app/api, đĩa, backup ───────────────────────────────────────────────────────────────────────────────────────────────────────
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$1" 2>/dev/null || true; }

check_http_200() {
  local id="$1" url="$2" code
  code="$(http_code "$url")"
  [ -n "$code" ] || code=000
  if [ "$code" = 200 ]; then ready "$id" "$url trả 200"; else action "$id" "$url trả $code (cần 200)"; fi
}

check_disk() {
  local path line used free mount seen="" problems="" okmsg="" p
  for p in $DISK_PATHS; do
    [ -e "$p" ] || continue
    line="$(df -P "$p" 2>/dev/null | awk 'NR == 2')"
    [ -n "$line" ] || continue
    mount="$(printf '%s' "$line" | awk '{ print $6 }')"
    case " $seen " in *" $mount "*) continue ;; esac
    seen="$seen $mount"
    used="$(printf '%s' "$line" | awk '{ gsub("%", "", $5); print $5 }')"
    case "$used" in '' | *[!0-9]*) continue ;; esac
    free=$((100 - used))
    if [ "$free" -lt "$MIN_DISK_FREE_PCT" ]; then problems="${problems}${problems:+; }$mount còn trống ${free}% (< ${MIN_DISK_FREE_PCT}%)"
    else okmsg="${okmsg}${okmsg:+, }$mount trống ${free}%"; fi
  done
  if [ -z "$seen" ]; then action disk-free "không đọc được dung lượng đĩa của: $DISK_PATHS"
  else verdict disk-free "$problems" "$okmsg (>= ${MIN_DISK_FREE_PCT}%)"; fi
}

check_backup_latest() {
  local newest fresh marker
  if [ ! -d "$BACKUP_DIR" ]; then
    action pg-backup "không thấy thư mục $BACKUP_DIR (chạy trên VPS, cần quyền đọc)"
    return
  fi
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'tubutree_*.sql.gz' -size +0c -exec ls -t {} + 2>/dev/null | head -1)"
  if [ -z "$newest" ]; then
    action pg-backup "$BACKUP_DIR chưa có file tubutree_*.sql.gz nào không rỗng"
    return
  fi
  if ! gzip -t "$newest" 2>/dev/null; then
    action pg-backup "bản mới nhất $(basename "$newest") KHÔNG phải gzip hợp lệ (hỏng): chạy lại backup trước cutover"
    return
  fi
  fresh="$(find "$newest" -mmin "-$((BACKUP_MAX_AGE_HOURS * 60))" 2>/dev/null)"
  if [ -n "$fresh" ]; then ready pg-backup "bản mới nhất $(basename "$newest") hợp lệ (gzip -t), trong ${BACKUP_MAX_AGE_HOURS} giờ qua"
  else action pg-backup "bản mới nhất $(basename "$newest") cũ hơn ${BACKUP_MAX_AGE_HOURS} giờ: chạy backup ngay trước cutover (ops/backup-predeploy.sh)"; fi
  marker="$BACKUP_DIR/.last-offsite-ok"
  if [ -e "$marker" ]; then info "backup offsite: dấu .last-offsite-ok $(if [ -n "$(find "$marker" -mmin -1800 2>/dev/null)" ]; then echo 'trong 30 giờ qua'; else echo 'CŨ hơn 30 giờ'; fi)"
  else info "backup offsite: chưa bật (không có .last-offsite-ok), chỉ ghi chú"; fi
}

# ── 3b. Điều kiện chặn thật của cutover (docs/launch/apex-cutover-rehearsal-2026-11-14.md): chỉ GET và docker inspect ───────────────
# SITE_URL: web phải dựng với NEXT_PUBLIC_SITE_URL=https://tubutree.com, nếu không canonical/sitemap vẫn trỏ app.tubutree.com.
check_site_url() {
  local sm
  sm="$(curl -s --max-time "$CURL_TIMEOUT" -H "Host: $CANON_HOST" "$NEXT_URL/sitemap.xml" 2>/dev/null || true)"
  if printf '%s' "$sm" | grep -q "loc.https://$CANON_HOST/" && ! printf '%s' "$sm" | grep -q 'app.tubutree.com'; then
    ready site-url "sitemap.xml của web ($NEXT_URL, Host: $CANON_HOST) ra https://$CANON_HOST (NEXT_PUBLIC_SITE_URL đúng)"
  else
    action site-url "sitemap.xml của web ($NEXT_URL, Host: $CANON_HOST) chưa ra https://$CANON_HOST (hoặc còn app.tubutree.com): đặt NEXT_PUBLIC_SITE_URL=https://$CANON_HOST rồi build lại ảnh web"
  fi
}

# CORS_ORIGINS: chế độ cookie của web chỉ được API nhận khi Origin nằm trong danh sách này (apps/api/src/common/cors.ts), nếu không khách ở apex nhận 403 khi đăng nhập/làm mới phiên.
# Đọc env của container đang chạy bằng `docker inspect` (không gửi request nào tới API); chỉ lấy đúng dòng CORS_ORIGINS, các biến khác không bao giờ được in.
check_cors_origins() {
  local env_list line item found=0 count=0 old_ifs="$IFS"
  env_list="$(docker inspect "$API_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)"
  if [ -z "$env_list" ]; then
    action cors-origins "không đọc được env của container $API_CONTAINER (docker inspect): chạy trên VPS bằng user dùng được docker"
    return
  fi
  line="$(printf '%s\n' "$env_list" | sed -n 's/^CORS_ORIGINS=//p' | head -1)"
  IFS=','
  for item in $line; do
    item="$(printf '%s' "$item" | sed 's/^ *//; s/ *$//')"
    [ -n "$item" ] && count=$((count + 1))
    [ "$item" = "$CORS_ORIGIN_REQUIRED" ] && found=1
  done
  IFS="$old_ifs"
  if [ "$count" = 0 ]; then
    # Giống bootstrap.ts: danh sách rỗng thì API dùng FALLBACK_WEB_ORIGINS (có cả apex).
    ready cors-origins "container $API_CONTAINER không đặt CORS_ORIGINS có giá trị: API dùng danh sách mặc định (gồm $CORS_ORIGIN_REQUIRED)"
  elif [ "$found" = 1 ]; then ready cors-origins "CORS_ORIGINS của $API_CONTAINER có $CORS_ORIGIN_REQUIRED"
  else action cors-origins "CORS_ORIGINS của $API_CONTAINER chưa có $CORS_ORIGIN_REQUIRED (khách ở apex bị 403 khi đăng nhập): thêm vào .env của API rồi tạo lại container api"; fi
}

# Luật chuyển hướng mới phải đã chạy trên Next thật (bản dựng cũ trả 404 cho 8 sitemap con Rank Math và /locations.kml): `redirect-rules` ở dưới chỉ kiểm bảng luật trong mã nguồn.
check_live_redirect() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" -H "Host: $CANON_HOST" "$NEXT_URL$LIVE_REDIRECT_PATH" 2>/dev/null || true)"
  [ -n "$code" ] || code=000
  if [ "$code" = 301 ]; then ready live-redirect "Next đang chạy ($NEXT_URL) trả 301 cho $LIVE_REDIRECT_PATH (Host: $CANON_HOST): luật chuyển hướng mới đã deploy"
  else action live-redirect "Next đang chạy ($NEXT_URL) trả $code cho $LIVE_REDIRECT_PATH (Host: $CANON_HOST), cần 301: bản dựng web chưa có luật chuyển hướng mới, cần deploy web"; fi
}

# ── 4. Bảng chuyển hướng (offline) ────────────────────────────────────────────────────────────────────────────────────────────────
node_ok() {
  command -v "$NODE_BIN" >/dev/null 2>&1 && "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' >/dev/null 2>&1
}

check_redirect_rules() {
  local out="" rc=0 image runner="node"
  local script="$REPO_ROOT/scripts/ops/check-cutover-redirects.mjs"
  if [ ! -f "$script" ]; then action redirect-rules "thiếu $script"; return; fi
  if node_ok; then
    out="$("$NODE_BIN" "$script" --offline 2>/dev/null)" || rc=$?
  else
    # Không có Node >= 22.18 (cần để nạp thẳng .ts): chạy trong ảnh của container web, KHÔNG nối mạng, hệ tệp chỉ đọc, mã nguồn gắn chỉ đọc.
    image="$(docker inspect "$WEB_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null)"
    if [ -z "$image" ]; then
      action redirect-rules "không có Node >= 22.18 và không tìm được ảnh docker của $WEB_CONTAINER để chạy bộ kiểm bảng luật"
      return
    fi
    runner="docker $image"
    out="$(docker run --rm --network none --read-only -v "$REPO_ROOT:/repo:ro" --entrypoint node "$image" /repo/scripts/ops/check-cutover-redirects.mjs --offline 2>/dev/null)" || rc=$?
  fi
  local last
  last="$(printf '%s\n' "$out" | tail -n 1)"
  if ! printf '%s' "$last" | grep -q ' URL, .* PASS, .* WARN, .* FAIL, .* SKIP$'; then
    action redirect-rules "bộ kiểm bảng luật ($runner) không cho ra dòng tổng kết (mã thoát $rc): chạy tay node scripts/ops/check-cutover-redirects.mjs --offline"
  elif [ "$rc" -ne 0 ]; then
    action redirect-rules "bảng chuyển hướng có lỗi ($last); $(printf '%s\n' "$out" | grep '^FAIL' | head -3 | tr -s ' ' | tr '\n' ';')"
  else
    ready redirect-rules "bảng chuyển hướng WordPress nhất quán, offline qua $runner: ${last#*: }"
  fi
}

printf 'Tubu Tree pre-cutover-check %s (chỉ đọc, KHÔNG cutover, KHÔNG đổi DNS/Apache/chứng chỉ)\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
info "máy: $(hostname 2>/dev/null || echo '?'), user: $(id -un 2>/dev/null || echo '?')"
check_vhost_source
check_cert_file
for h in $LIVE_TLS_HOSTS; do check_cert_live "$h"; done
check_dns01_tool
check_cf_token
check_http_200 app-http "$APP_URL"
check_http_200 api-health "$API_HEALTH_URL"
check_site_url
check_cors_origins
check_live_redirect
check_disk
check_backup_latest
check_redirect_rules

printf '\nTổng: %s READY, %s ACTION_NEEDED\n' "$N_READY" "$N_ACTION"
if [ "$N_ACTION" -eq 0 ]; then
  echo "KẾT LUẬN: mọi hạng mục READY. Cutover vẫn là việc của chủ (script này không chạy nó)."
  exit 0
fi
echo "KẾT LUẬN: còn $N_ACTION hạng mục ACTION_NEEDED, CHƯA sẵn sàng cutover."
exit 1
