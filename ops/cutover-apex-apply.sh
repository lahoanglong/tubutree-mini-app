#!/usr/bin/env bash
# Cài vhost apex tubutree.com (ops/vietnix-vhost-apex.conf.cutover) lên Apache aaPanel của VPS Vietnix, kiểm, và TỰ QUAY LẠI nếu có gì hỏng. Chạy TRÊN VPS, quyền root.
#
#   bash ops/cutover-apex-apply.sh              # chỉ KIỂM điều kiện (không đổi gì trên máy); mã thoát 0 = đủ điều kiện cài
#   bash ops/cutover-apex-apply.sh --apply      # kiểm, rồi cài, configtest, graceful, kiểm chuyển hướng; hỏng bước nào thì gọi cutover-apex-rollback.sh
#   bash ops/cutover-apex-apply.sh --help
#
# Cài vhost KHÔNG đổi lưu lượng thật: DNS của tubutree.com còn trỏ ZenCloud nên khách chưa tới Apache này. Đổi bản ghi A ở Cloudflare là bước riêng của chủ
# (docs/launch/apex-cutover-rehearsal-2026-11-14.md). Script này không đụng DNS, không chạy certbot, không build lại web, không `restart` Apache.
#
# Điều kiện kiểm trước khi đụng Apache (thiếu cái nào thì thoát mã 2, chưa đổi gì): root; Apache configtest sạch; thư mục backup có manifest khớp sha256;
# ảnh uploads đủ tệp và khớp sha256; đĩa dưới 80%; chứng chỉ phủ tubutree.com + www.tubutree.com, còn >= 14 ngày, khớp khoá; web trả 200 cho Host tubutree.com;
# sitemap web ra https://tubutree.com (NEXT_PUBLIC_SITE_URL); API chấp nhận Origin https://tubutree.com cho đăng nhập/làm mới phiên (CORS_ORIGINS);
# diễn tập trên Next qua cổng 14000 (Host: tubutree.com) đạt 0 FAIL; origin ZenCloud trả 200 cho khối proxy blog.
# Sau khi cài: configtest, graceful, rồi `check-cutover-redirects.mjs --blog proxy` trên TOÀN BỘ URL WordPress đang index (kèm mẫu ảnh uploads) qua HTTPS thật của vhost mới
# (--resolve-ip 127.0.0.1), và app/api vẫn trả đúng mã như trước khi cài. Mã thoát: 0 xong, 1 hỏng sau khi cài (đã tự quay lại), 2 chưa đủ điều kiện, 3 sai tham số.
#
# Biến môi trường (mặc định trong ngoặc) dùng để diễn tập trên Apache riêng, không dùng khi cài thật:
#   APACHECTL (/www/server/apache/bin/apachectl), VHOST_DIR (/www/server/panel/vhost/apache), VHOST_NAME (tubutree.com.conf), VHOST_SRC (ops/vietnix-vhost-apex.conf.cutover),
#   BACKUP_DIR (/opt/backups/tubutree-wp-precutover-20261114), CERT_DIR (/etc/letsencrypt/live/tubutree.com), UPLOADS_DIR (/www/wwwroot/tubutree.com/wp-content/uploads),
#   URL_LIST (scripts/ops/data/wp-live-urls-20261114.txt), NEXT_URL (http://127.0.0.1:14000), CHECK_BASE (https://tubutree.com), CHECK_IP (127.0.0.1),
#   CHECK_PORT (443), CHECK_CA_FILE (rỗng; tệp CA tin cậy thêm cho bộ kiểm khi diễn tập bằng chứng chỉ tự ký),
#   WEB_CONTAINER (tubutree-web-1), ORIGIN_IP (42.1.122.84), MIN_UPLOAD_FILES (3000), MIN_CERT_DAYS (14).
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd)"
APACHECTL="${APACHECTL:-/www/server/apache/bin/apachectl}"
VHOST_DIR="${VHOST_DIR:-/www/server/panel/vhost/apache}"
VHOST_NAME="${VHOST_NAME:-tubutree.com.conf}"
VHOST_SRC="${VHOST_SRC:-$SELF_DIR/vietnix-vhost-apex.conf.cutover}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/tubutree-wp-precutover-20261114}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/tubutree.com}"
UPLOADS_DIR="${UPLOADS_DIR:-/www/wwwroot/tubutree.com/wp-content/uploads}"
URL_LIST="${URL_LIST:-$REPO_ROOT/scripts/ops/data/wp-live-urls-20261114.txt}"
NEXT_URL="${NEXT_URL:-http://127.0.0.1:14000}"
CHECK_BASE="${CHECK_BASE:-https://tubutree.com}"
CHECK_IP="${CHECK_IP:-127.0.0.1}"
CHECK_PORT="${CHECK_PORT:-443}"
CHECK_CA_FILE="${CHECK_CA_FILE:-}"
WEB_CONTAINER="${WEB_CONTAINER:-tubutree-web-1}"
ORIGIN_IP="${ORIGIN_IP:-42.1.122.84}"
MIN_UPLOAD_FILES="${MIN_UPLOAD_FILES:-3000}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
DISK_MAX_PCT="${DISK_MAX_PCT:-80}"
export APACHECTL VHOST_DIR VHOST_NAME VHOST_SRC BACKUP_DIR

APPLY=0
SKIP_CANONICAL=0
SKIP_CORS=0
usage() { sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --skip-canonical-check) SKIP_CANONICAL=1; shift ;;
    --skip-cors-check) SKIP_CORS=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 3 ;;
  esac
done

FAILS=0
pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf '[WARN] %s\n' "$*"; }
info() { printf '       %s\n' "$*"; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cutover-apex.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

http_code() { curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo 000; }

EXPORT_DIR="$BACKUP_DIR/wp-public-export"
NODE_OK=0
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then NODE_OK=1; fi

# Danh sách URL kiểm: mọi URL WordPress đang index + mẫu ảnh uploads (mỗi 150 ảnh lấy một). Thư mục tạm phải đọc được từ container (mktemp tạo 700).
prepare_check_inputs() {
  if [ -f "$EXPORT_DIR/uploads-urls.txt" ]; then
    { cat "$URL_LIST"; awk 'NR % 150 == 1' "$EXPORT_DIR/uploads-urls.txt"; } > "$TMP/urls.txt"
  else
    cp "$URL_LIST" "$TMP/urls.txt"
  fi
  chmod 755 "$TMP" && chmod 644 "$TMP/urls.txt"
  if [ -n "$CHECK_CA_FILE" ]; then cp "$CHECK_CA_FILE" "$TMP/ca.pem" && chmod 644 "$TMP/ca.pem"; fi
}

# run_check <tệp kết quả> <tham số của check-cutover-redirects.mjs, không gồm --urls>: kết quả stdout vào <tệp>, stderr vào <tệp>.err.
# Mã trả 0 chỉ khi có dòng tổng kết ở cuối stdout và 0 FAIL. Node in ExperimentalWarning khi nạp .ts ra stderr: vô hại, chỉ lỗi khác mới được in.
run_check() {
  local out="$1" rc image
  shift
  if [ "$NODE_OK" = 1 ]; then
    env ${CHECK_CA_FILE:+NODE_EXTRA_CA_CERTS="$CHECK_CA_FILE"} node "$REPO_ROOT/scripts/ops/check-cutover-redirects.mjs" "$@" --urls "$TMP/urls.txt" --concurrency 4 > "$out" 2> "$out.err"
    rc=$?
  else
    image="$(docker inspect "$WEB_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null)"
    if [ -z "$image" ]; then echo "không có Node >= 22.18 và không tìm được ảnh docker của $WEB_CONTAINER để chạy bộ kiểm" > "$out.err"; : > "$out"; return 98; fi
    docker run --rm --network host ${CHECK_CA_FILE:+-e NODE_EXTRA_CA_CERTS=/work/ca.pem} --entrypoint node -v "$REPO_ROOT:/repo:ro" -v "$TMP:/work:ro" "$image" \
      /repo/scripts/ops/check-cutover-redirects.mjs "$@" --urls /work/urls.txt --concurrency 4 > "$out" 2> "$out.err"
    rc=$?
  fi
  tail -1 "$out" | grep -q ' URL, .* PASS, .* WARN, .* FAIL, .* SKIP$' || rc=99
  return "$rc"
}
check_errors() { grep -vE 'ExperimentalWarning|MODULE_TYPELESS_PACKAGE_JSON|--trace-warnings|--experimental-default-type|To eliminate this warning' "$1.err" | head -8; }

# ── 1. Kiểm điều kiện (chỉ đọc) ───────────────────────────────────────────────────────────────────────────────────────────────────
echo "== Kiểm điều kiện cutover apex (chỉ đọc) =="
[ "$(id -u)" = 0 ] && pass "chạy bằng root" || fail "cần root (đọc khoá chứng chỉ, ghi vhost Apache)"
[ -f "$VHOST_SRC" ] && pass "có vhost nguồn: $VHOST_SRC" || fail "thiếu vhost nguồn: $VHOST_SRC"
[ -f "$URL_LIST" ] && pass "có danh sách URL WordPress: $(grep -vc '^#' "$URL_LIST") đường dẫn" || fail "thiếu danh sách URL: $URL_LIST"

if ct_out="$($APACHECTL -t 2>&1)" && printf '%s' "$ct_out" | grep -q 'Syntax OK'; then
  pass "Apache configtest sạch trước khi cài"
else
  fail "Apache configtest hỏng TRƯỚC khi cài (không cài đè lên cấu hình đang hỏng): $(printf '%s' "$ct_out" | head -3 | tr '\n' ' ')"
fi

if [ -f "$BACKUP_DIR/apache-vhosts/configtest-baseline.txt" ] && [ -f "$EXPORT_DIR/MANIFEST.sha256" ] && [ -f "$EXPORT_DIR/summary.json" ]; then
  if (cd "$EXPORT_DIR" && sha256sum -c --quiet MANIFEST.sha256 >/dev/null 2>&1); then
    pass "backup $BACKUP_DIR: vhost, TLS, JSON/sitemap khớp sha256 ($(wc -l < "$EXPORT_DIR/MANIFEST.sha256") tệp)"
  else
    fail "backup $BACKUP_DIR: manifest sha256 KHÔNG khớp"
  fi
else
  fail "chưa có backup đủ ở $BACKUP_DIR (cần apache-vhosts/configtest-baseline.txt, wp-public-export/MANIFEST.sha256, summary.json)"
fi

if [ -f "$EXPORT_DIR/uploads.sha256" ] && [ -d "$UPLOADS_DIR" ]; then
  n="$(find "$UPLOADS_DIR" -type f ! -name '*.part' | wc -l)"
  if [ "$n" -ge "$MIN_UPLOAD_FILES" ] && [ ! -s "$EXPORT_DIR/uploads-failed.txt" ]; then
    if (cd "$UPLOADS_DIR" && sha256sum -c --quiet "$EXPORT_DIR/uploads.sha256" >/dev/null 2>&1); then
      pass "ảnh uploads: $n tệp trên đĩa, khớp sha256, không tệp lỗi tải"
    else
      fail "ảnh uploads: sha256 KHÔNG khớp manifest (tệp bị đổi hoặc thiếu)"
    fi
  else
    fail "ảnh uploads: $n tệp (cần >= $MIN_UPLOAD_FILES) hoặc uploads-failed.txt không rỗng"
  fi
else
  fail "chưa sao ảnh uploads (cần $UPLOADS_DIR và $EXPORT_DIR/uploads.sha256): chạy scripts/ops/wp-public-export.mjs --uploads-dir"
fi

used="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ "${used:-100}" -lt "$DISK_MAX_PCT" ] && pass "đĩa / dùng ${used}% (< ${DISK_MAX_PCT}%)" || fail "đĩa / dùng ${used}% (>= ${DISK_MAX_PCT}%)"

CERT="$CERT_DIR/fullchain.pem"
KEY="$CERT_DIR/privkey.pem"
if [ -r "$CERT" ] && [ -r "$KEY" ]; then
  san="$(openssl x509 -noout -ext subjectAltName -in "$CERT" 2>/dev/null)"
  if printf '%s' "$san" | grep -q 'DNS:tubutree.com' && printf '%s' "$san" | grep -q 'DNS:www.tubutree.com'; then
    pass "chứng chỉ phủ tubutree.com và www.tubutree.com"
  else
    fail "chứng chỉ KHÔNG phủ đủ hai tên (SAN: $(printf '%s' "$san" | tail -1 | tr -d ' '))"
  fi
  if openssl x509 -checkend $((MIN_CERT_DAYS * 86400)) -noout -in "$CERT" >/dev/null 2>&1; then
    pass "chứng chỉ còn >= $MIN_CERT_DAYS ngày ($(openssl x509 -enddate -noout -in "$CERT"))"
  else
    fail "chứng chỉ hết hạn trong < $MIN_CERT_DAYS ngày"
  fi
  if [ "$(openssl x509 -noout -pubkey -in "$CERT" 2>/dev/null | openssl sha256)" = "$(openssl pkey -pubout -in "$KEY" 2>/dev/null | openssl sha256)" ]; then
    pass "khoá riêng khớp chứng chỉ"
  else
    fail "khoá riêng KHÔNG khớp chứng chỉ"
  fi
else
  fail "chưa có chứng chỉ ở $CERT_DIR (VPS chưa cấp cho tubutree.com: xem điều kiện 1 trong ops/vietnix-vhost-apex.conf.cutover)"
fi

code="$(http_code -H 'Host: tubutree.com' "$NEXT_URL/")"
[ "$code" = 200 ] && pass "web Next ($NEXT_URL) trả 200 cho Host: tubutree.com" || fail "web Next trả $code cho Host: tubutree.com"

if [ "$SKIP_CANONICAL" = 1 ]; then
  warn "BỎ QUA kiểm NEXT_PUBLIC_SITE_URL (--skip-canonical-check): chỉ dùng khi diễn tập, KHÔNG dùng khi cài thật"
else
  sm="$(curl -s --max-time 20 -H 'Host: tubutree.com' "$NEXT_URL/sitemap.xml" 2>/dev/null)"
  if printf '%s' "$sm" | grep -q '<loc>https://tubutree.com/' && ! printf '%s' "$sm" | grep -q 'app.tubutree.com'; then
    pass "sitemap.xml của web ra https://tubutree.com (NEXT_PUBLIC_SITE_URL đúng)"
  else
    fail "sitemap.xml của web chưa ra https://tubutree.com: đặt NEXT_PUBLIC_SITE_URL=https://tubutree.com rồi build lại ảnh web (điều kiện 2)"
  fi
fi

# Chế độ cookie của web (x-client: web) chỉ được API nhận khi Origin nằm trong CORS_ORIGINS (apps/api/src/common/cors.ts: cookieAuthOriginGuard). Prod 14/11/2026 chỉ có
# https://app.tubutree.com nên khách vào apex sẽ bị 403 ở /api/auth/refresh|logout|guest|zalo-oauth. Gửi refresh KHÔNG kèm cookie: Origin hợp lệ thì lỗi 400/401 (không đổi dữ liệu).
if [ "$SKIP_CORS" = 1 ]; then
  warn "BỎ QUA kiểm CORS_ORIGINS (--skip-cors-check): chỉ dùng khi diễn tập, KHÔNG dùng khi cài thật"
else
  code="$(http_code -X POST -H 'Origin: https://tubutree.com' -H 'x-client: web' -H 'Content-Type: application/json' -d '{}' --resolve "api.tubutree.com:443:127.0.0.1" https://api.tubutree.com/api/auth/refresh)"
  case "$code" in
    403 | 000) fail "API từ chối Origin https://tubutree.com ở /api/auth/refresh (mã $code): thêm https://tubutree.com vào CORS_ORIGINS của API (.env) rồi tạo lại container api, trước khi đổi DNS" ;;
    *) pass "API nhận Origin https://tubutree.com cho đăng nhập/làm mới phiên (mã $code, không phải 403)" ;;
  esac
fi

code="$(http_code --resolve "tubutree.com:443:$ORIGIN_IP" https://tubutree.com/wp-json/)"
[ "$code" = 200 ] && pass "origin ZenCloud $ORIGIN_IP trả 200 cho khối proxy blog" || fail "origin ZenCloud $ORIGIN_IP trả $code (khối proxy blog sẽ 502)"

APP_BEFORE="$(http_code --resolve "app.tubutree.com:443:127.0.0.1" https://app.tubutree.com/)"
API_BEFORE="$(http_code --resolve "api.tubutree.com:443:127.0.0.1" https://api.tubutree.com/api/home)"
info "mã trước khi cài: app=$APP_BEFORE api=$API_BEFORE (phải giữ nguyên sau khi cài)"
case "$APP_BEFORE$API_BEFORE" in *000*) fail "app hoặc api không trả lời qua Apache trước khi cài" ;; esac

prepare_check_inputs
if run_check "$TMP/pre.txt" --base "$NEXT_URL" --host-header tubutree.com --blog skip; then
  pass "diễn tập trên Next (Host: tubutree.com, chưa qua Apache): $(tail -1 "$TMP/pre.txt")"
else
  grep -E '^FAIL' "$TMP/pre.txt" | head -12
  check_errors "$TMP/pre.txt"
  fail "web Next CHƯA qua kiểm chuyển hướng ($(tail -1 "$TMP/pre.txt")): triển khai bản web có bảng chuyển hướng mới (điều kiện 2) rồi chạy lại"
fi

if [ "$FAILS" -gt 0 ]; then
  echo
  echo "KHÔNG đủ điều kiện: $FAILS mục FAIL. Chưa đổi gì trên máy."
  exit 2
fi
if [ "$APPLY" = 0 ]; then
  echo
  echo "Đủ điều kiện. Chưa cài (chạy lại với --apply để cài)."
  exit 0
fi

# ── 2. Cài ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
echo
echo "== Cài vhost (graceful, không restart) =="
TARGET="$VHOST_DIR/$VHOST_NAME"
STATE="$BACKUP_DIR/.cutover-state"
if [ ! -f "$STATE" ]; then
  {
    if [ -e "$TARGET" ]; then
      cp -a "$TARGET" "$BACKUP_DIR/apache-vhosts/pre-apply-$VHOST_NAME"
      echo "PRE_EXISTED=1"
    else
      echo "PRE_EXISTED=0"
    fi
    echo "APPLIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$STATE"
fi
info "trạng thái trước khi cài lưu ở $STATE: $(head -1 "$STATE")"

rollback_and_exit() {
  echo "[FAIL] $1"
  echo "== Tự quay lại =="
  bash "$SELF_DIR/cutover-apex-rollback.sh" --from-apply
  exit 1
}

install -m 600 -o root -g root "$VHOST_SRC" "$TARGET.tmp" || rollback_and_exit "không ghi được $TARGET.tmp"
mv -f "$TARGET.tmp" "$TARGET" || rollback_and_exit "không đặt được $TARGET"
if ct_out="$($APACHECTL -t 2>&1)" && printf '%s' "$ct_out" | grep -q 'Syntax OK'; then
  pass "configtest sạch với vhost mới"
else
  rollback_and_exit "configtest hỏng với vhost mới: $(printf '%s' "$ct_out" | head -3 | tr '\n' ' ')"
fi
$APACHECTL -k graceful >/dev/null 2>&1 || rollback_and_exit "apachectl -k graceful lỗi"
pass "apachectl -k graceful xong"

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  c="$(http_code --resolve "tubutree.com:$CHECK_PORT:$CHECK_IP" "$CHECK_BASE/")"
  [ "$c" != 000 ] && { ready=1; break; }
  sleep 1
done
[ "$ready" = 1 ] || rollback_and_exit "vhost mới không trả lời HTTPS sau graceful"

# ── 3. Kiểm sau khi cài ───────────────────────────────────────────────────────────────────────────────────────────────────────────
APP_AFTER="$(http_code --resolve "app.tubutree.com:443:127.0.0.1" https://app.tubutree.com/)"
API_AFTER="$(http_code --resolve "api.tubutree.com:443:127.0.0.1" https://api.tubutree.com/api/home)"
if [ "$APP_AFTER" = "$APP_BEFORE" ] && [ "$API_AFTER" = "$API_BEFORE" ]; then
  pass "app=$APP_AFTER api=$API_AFTER giữ nguyên sau khi cài"
else
  rollback_and_exit "app/api đổi mã sau khi cài (app $APP_BEFORE→$APP_AFTER, api $API_BEFORE→$API_AFTER)"
fi

echo "== Kiểm chuyển hướng: $(grep -vc '^#' "$TMP/urls.txt") URL qua $CHECK_BASE (--resolve-ip $CHECK_IP, --blog proxy) =="
if run_check "$TMP/check.txt" --base "$CHECK_BASE" --resolve-ip "$CHECK_IP" --blog proxy; then
  tail -1 "$TMP/check.txt"
  mkdir -p "$BACKUP_DIR/logs" && cp "$TMP/check.txt" "$BACKUP_DIR/logs/check-cutover-redirects-pass-$(date +%Y%m%d-%H%M%S).txt"
  pass "kiểm chuyển hướng: 0 FAIL"
else
  rc=$?
  tail -1 "$TMP/check.txt"
  grep -E '^FAIL' "$TMP/check.txt" | head -20
  check_errors "$TMP/check.txt"
  mkdir -p "$BACKUP_DIR/logs" && cat "$TMP/check.txt" "$TMP/check.txt.err" > "$BACKUP_DIR/logs/check-cutover-redirects-failed-$(date +%Y%m%d-%H%M%S).txt"
  rollback_and_exit "kiểm chuyển hướng có FAIL (mã $rc); kết quả đầy đủ lưu ở $BACKUP_DIR/logs/"
fi

echo
echo "Xong: vhost $VHOST_NAME đã cài và graceful. Lưu lượng thật CHƯA đổi (DNS còn ở ZenCloud)."
echo "Bước kế (việc của chủ, Cloudflare): đổi A tubutree.com và www về 14.225.207.177 (☁ xám), rồi chạy:"
echo "  bash ops/check-edge.sh --app-host tubutree.com   # từ máy ngoài, sau khi DNS đã đổi"
echo "Quay lại gấp: đổi A tubutree.com về 42.1.122.84 ở Cloudflare TRƯỚC, rồi  bash ops/cutover-apex-rollback.sh"
exit 0
