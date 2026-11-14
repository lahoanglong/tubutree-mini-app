#!/usr/bin/env bash
# Kiểm ops/pre-cutover-check.sh: từng hạng mục READY/ACTION_NEEDED, mã thoát, token Cloudflare không bao giờ bị in, và CHỈ ĐỌC (thư mục giả không đổi,
# không có tệp tạm, không gọi certbot/acme.sh/apachectl, curl chỉ GET (chỉ thêm header Host), docker chỉ inspect và run --network none --read-only, mã nguồn không chứa lệnh ghi).
# Không cần mạng, Docker, certbot hay Node 22: `curl`, `df`, `docker`, `certbot`, `python3`, `dpkg-query`, `snap`, `node` và `openssl s_client` đều giả.
# Chứng chỉ thử sinh bằng openssl thật. Chạy được trên macOS (bash 3.2, LibreSSL) và Linux.
#   bash ops/test-pre-cutover-check.sh [đường-dẫn-pre-cutover-check.sh]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${1:-$SELF_DIR/pre-cutover-check.sh}"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REAL_OPENSSL="$(command -v openssl)"
SAFE_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
TOKEN="SECRETTOKEN_TEST_9f8e7d6c5b4a"
ACME_TOKEN="SECRETACMEVALUE_TEST_1a2b3c4d"
API_SECRET="SECRETJWT_TEST_5e6f7a8b9c"
FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: mong '$3', thực tế '$2'"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1: thiếu '$3'"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then fail "$1: không được có '$3'"; else pass "$1"; fi; }

# ── chứng chỉ thử (openssl thật) ──
mkdir -p "$WORK/pki"
mkcert() { # tên ngày danh-sách-SAN [khoá-dùng-lại]
  cat > "$WORK/pki/$1.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = tubutree.com
[v3]
subjectAltName = $3
EOF
  "$REAL_OPENSSL" req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/pki/$1.key" -out "$WORK/pki/$1.crt" -days "$2" -config "$WORK/pki/$1.cnf" >/dev/null 2>&1
}
mkcert good 90 "DNS:tubutree.com,DNS:www.tubutree.com"
mkcert wild 90 "DNS:*.tubutree.com"
mkcert both 90 "DNS:tubutree.com,DNS:*.tubutree.com"
mkcert nowww 90 "DNS:tubutree.com"
mkcert expiring 5 "DNS:tubutree.com,DNS:www.tubutree.com"
mkcert other 90 "DNS:tubutree.com,DNS:www.tubutree.com"
[ -s "$WORK/pki/good.crt" ] && [ -s "$WORK/pki/other.key" ] || { echo "FAIL không sinh được chứng chỉ thử bằng openssl"; exit 1; }

# ── lệnh giả ──
mkdir -p "$WORK/stub"
cat > "$WORK/stub/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
url="${@: -1}"
case "$url" in
  */sitemap.xml)
    [ "${SITEMAP_MODE:-ok}" = down ] && exit 7
    if [ "${SITEMAP_MODE:-ok}" = old ]; then echo '<urlset><url><loc>https://app.tubutree.com/</loc></url></urlset>'; else echo '<urlset><url><loc>https://tubutree.com/</loc></url></urlset>'; fi
    exit 0 ;;
  *127.0.0.1:14000*) code="${CURL_CODE_REDIRECT:-301}" ;;
  *api.tubutree.com*) code="${CURL_CODE_API:-200}" ;;
  *app.tubutree.com*) code="${CURL_CODE_APP:-200}" ;;
  *) code=200 ;;
esac
printf '%s' "$code"
[ "$code" = 000 ] && exit 7
exit 0
STUB
cat > "$WORK/stub/df" <<'STUB'
#!/usr/bin/env bash
echo "df $*" >> "$CALLS"
used="${FAKE_DF_USED:-40}"
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/fake 1000000 $((used * 10000)) $(((100 - used) * 10000)) ${used}% /"
STUB
cat > "$WORK/stub/openssl" <<STUB
#!/usr/bin/env bash
if [ "\$1" = s_client ]; then
  echo "openssl s_client \$*" >> "\$CALLS"
  host=""; while [ \$# -gt 0 ]; do [ "\$1" = -connect ] && host="\${2%%:*}"; shift; done
  var="LIVE_CERT_\$(printf '%s' "\${host%%.*}" | tr a-z A-Z)"
  eval "f=\\\${\$var:-}"
  [ -n "\$f" ] && [ -f "\$f" ] && cat "\$f"
  exit 0
fi
exec "$REAL_OPENSSL" "\$@"
STUB
cat > "$WORK/stub/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$1" in
  inspect)
    case "$*" in
      *.Config.Env*)
        [ "${API_ENV_MODE:-ok}" = missing ] && exit 1
        printf '%b' "${API_ENV:-NODE_ENV=production\nCORS_ORIGINS=https://app.tubutree.com,https://tubutree.com\nJWT_SECRET=$API_SECRET\n}" ;;
      *) [ -n "${DOCKER_IMAGE:-}" ] && echo "$DOCKER_IMAGE" ;;
    esac ;;
  run)
    case "${DOCKER_RUN_MODE:-ok}" in
      ok) echo "offline (bảng luật, không gọi mạng): 145 URL, 145 PASS, 0 WARN, 0 FAIL, 0 SKIP" ;;
      fail) echo "FAIL  /x/ -> /y  (lỗi)"; echo "offline (bảng luật, không gọi mạng): 2 URL, 1 PASS, 0 WARN, 1 FAIL, 0 SKIP"; exit 1 ;;
    esac
    ;;
esac
exit 0
STUB
cat > "$WORK/stub/python3" <<'STUB'
#!/usr/bin/env bash
echo "python3 $*" >> "$CALLS"
[ "$1" = -B ] && shift
[ "$1" = -c ] && [ "${PY_HAS_PLUGIN:-0}" = 1 ] && exit 0
exit 1
STUB
cat > "$WORK/stub/dpkg-query" <<'STUB'
#!/usr/bin/env bash
echo "dpkg-query $*" >> "$CALLS"
case "${DPKG_HAS:-0}" in
  1) printf 'install ok installed' ;;
  removed) printf 'deinstall ok config-files' ;;
  *) exit 1 ;;
esac
STUB
cat > "$WORK/stub/dpkg" <<'STUB'
#!/usr/bin/env bash
echo "dpkg $*" >> "$CALLS"
exit 0
STUB
cat > "$WORK/stub/snap" <<'STUB'
#!/usr/bin/env bash
echo "snap $*" >> "$CALLS"
[ "${SNAP_HAS:-0}" = 1 ] && exit 0
exit 1
STUB
cat > "$WORK/stub/node-stub" <<'STUB'
#!/usr/bin/env bash
echo "node $*" >> "$CALLS"
if [ "$1" = -e ]; then [ "${NODE_MODE:-ok}" = old ] && exit 1; exit 0; fi
case "${NODE_MODE:-ok}" in
  ok) echo "PASS  /a/ -> /b  (301)"; echo; echo "offline (bảng luật, không gọi mạng): 145 URL, 145 PASS, 0 WARN, 0 FAIL, 0 SKIP" ;;
  fail) echo "FAIL  /x/ -> /y  (đích vẫn còn luật)"; echo; echo "offline (bảng luật, không gọi mạng): 2 URL, 1 PASS, 0 WARN, 1 FAIL, 0 SKIP"; exit 1 ;;
  noline) echo "rác"; exit 0 ;;
esac
STUB
# Các lệnh KHÔNG được gọi: nếu script đụng tới, nhật ký sẽ ghi lại và test đỏ.
for forbidden in apachectl systemctl acme.sh; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS"\nexit 0\n' "$forbidden" > "$WORK/stub/$forbidden"
done
chmod +x "$WORK/stub/"*

cat > "$WORK/vhost.conf" <<'EOF'
<VirtualHost *:443>
    ServerName tubutree.com
    SSLCertificateFile /etc/letsencrypt/live/tubutree.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/tubutree.com/privkey.pem
</VirtualHost>
EOF

# ── dựng kịch bản ──
ago() { date -d "$1 hours ago" +%Y%m%d%H%M 2>/dev/null || date -v-"$1"H +%Y%m%d%H%M; }
snap_dir() { (cd "$D" && ls -laR certs creds acme backups tmp home 2>&1 | grep -v '^total'); }
setup() { # tên: mọi thứ ở trạng thái READY
  D="$WORK/$1"
  rm -rf "$D"
  mkdir -p "$D/bin" "$D/certs" "$D/creds" "$D/acme" "$D/backups" "$D/tmp" "$D/home"
  cp "$WORK/stub/"* "$D/bin/"
  printf '#!/bin/sh\necho "certbot $*" >> "$CALLS"\nexit 0\n' > "$D/bin/certbot"; chmod +x "$D/bin/certbot"
  cp "$WORK/pki/good.crt" "$D/certs/fullchain.pem"; cp "$WORK/pki/good.key" "$D/certs/privkey.pem"
  printf 'dns_cloudflare_api_token = %s\n' "$TOKEN" > "$D/creds/cloudflare.ini"; chmod 600 "$D/creds/cloudflare.ini"
  echo "-- dump" | gzip > "$D/backups/tubutree_20261114_000000_cron.sql.gz"
  : > "$D/calls.log"
  ENVV="PY_HAS_PLUGIN=1 NODE_MODE=ok"
}
# run_pc [BIẾN=giá-trị ...]: OUT, RC, SNAP_BEFORE/AFTER.
run_pc() {
  : > "$D/calls.log"
  SNAP_BEFORE="$(snap_dir)"
  # shellcheck disable=SC2086 # tách từ có chủ ý: ENVV là danh sách BIẾN=giá-trị
  OUT="$(env -i PATH="${PATH_EXTRA:-}${PATH_EXTRA:+:}$D/bin:$SAFE_PATH" HOME="$D/home" TMPDIR="$D/tmp" CALLS="$D/calls.log" \
    VHOST_SRC="$WORK/vhost.conf" CERT_FILE="$D/certs/fullchain.pem" KEY_FILE="$D/certs/privkey.pem" \
    CF_CREDENTIALS="$D/creds/cloudflare.ini" ACME_HOME="$D/acme" BACKUP_DIR="$D/backups" NODE_BIN="$D/bin/node-stub" \
    LIVE_CERT_APP="$WORK/pki/good.crt" LIVE_CERT_API="$WORK/pki/good.crt" CA_FILE="$D/certs/fullchain.pem" API_SECRET="$API_SECRET" \
    $ENVV "$@" bash "$SCRIPT" 2>&1)"
  RC=$?
  SNAP_AFTER="$(snap_dir)"
}
line_of() { grep -E "^\[(READY|ACTION_NEEDED)\] +$1 " <<<"$OUT"; }
expect_ready() { if line_of "$1" | grep -q '^\[READY\]'; then pass "$1 READY"; else fail "$1 phải READY: $(line_of "$1")"; fi; }
expect_action() { # id [chuỗi con của lý do]
  local l; l="$(line_of "$1")"
  if grep -q '^\[ACTION_NEEDED\]' <<<"$l"; then pass "$1 ACTION_NEEDED"; else fail "$1 phải ACTION_NEEDED: ${l:-<không có dòng>}"; return; fi
  [ -z "${2:-}" ] || contains "$1 nêu '$2'" "$l" "$2"
}
PATH_EXTRA=""
no_secret() {
  lacks "$1: không lộ token certbot" "$OUT" "$TOKEN"
  lacks "$1: không lộ token acme.sh" "$OUT" "$ACME_TOKEN"
  lacks "$1: không lộ biến env khác của container api" "$OUT" "$API_SECRET"
}

echo "--- 1. mọi thứ sẵn sàng: 14 READY, thoát 0, không lộ token"
setup t1; run_pc
check "thoát 0" "$RC" 0
for id in vhost-src cert-file cert-app cert-api dns01-tool cf-token app-http api-health site-url cors-origins live-redirect disk-free pg-backup redirect-rules; do expect_ready "$id"; done
contains "tổng kết" "$OUT" "Tổng: 14 READY, 0 ACTION_NEEDED"
contains "kết luận" "$OUT" "mọi hạng mục READY"
contains "nói rõ không chạy cutover" "$OUT" "Cutover vẫn là việc của chủ"
no_secret t1

echo "--- 2. trạng thái VPS hiện nay (chưa cấp chứng chỉ, chưa có plugin/token): đúng 3 mục ACTION_NEEDED, thoát 1"
setup t2
rm -f "$D/certs/fullchain.pem" "$D/certs/privkey.pem" "$D/creds/cloudflare.ini" "$D/bin/certbot"
ENVV="NODE_MODE=ok"; run_pc
check "thoát 1" "$RC" 1
expect_action cert-file
if grep -Eq 'chưa có|không thấy' <<<"$(line_of cert-file)"; then pass "cert-file nêu chưa cấp/không thấy chứng chỉ"; else fail "cert-file không nêu lý do: $(line_of cert-file)"; fi
expect_action dns01-tool "không có certbot"
expect_action cf-token "chưa có token"
for id in vhost-src cert-app cert-api app-http api-health site-url cors-origins live-redirect disk-free pg-backup redirect-rules; do expect_ready "$id"; done
contains "tổng kết" "$OUT" "Tổng: 11 READY, 3 ACTION_NEEDED"
contains "kết luận" "$OUT" "CHƯA sẵn sàng cutover"

echo "--- 3. chứng chỉ: SAN thiếu www / chỉ wildcard (không phủ apex) / hết hạn / khoá lệch / không phải PEM"
setup t3a; cp "$WORK/pki/nowww.crt" "$D/certs/fullchain.pem"; cp "$WORK/pki/nowww.key" "$D/certs/privkey.pem"; run_pc
expect_action cert-file "SAN không phủ www.tubutree.com"; check "thoát 1" "$RC" 1
setup t3b; cp "$WORK/pki/wild.crt" "$D/certs/fullchain.pem"; cp "$WORK/pki/wild.key" "$D/certs/privkey.pem"; run_pc
expect_action cert-file "SAN không phủ tubutree.com"
lacks "wildcard phủ www (không báo thiếu www)" "$(line_of cert-file)" "không phủ www.tubutree.com"
setup t3c; cp "$WORK/pki/both.crt" "$D/certs/fullchain.pem"; cp "$WORK/pki/both.key" "$D/certs/privkey.pem"; run_pc
expect_ready cert-file
setup t3d; cp "$WORK/pki/expiring.crt" "$D/certs/fullchain.pem"; cp "$WORK/pki/expiring.key" "$D/certs/privkey.pem"; run_pc
expect_action cert-file "hết hạn trong < 14 ngày"
run_pc MIN_CERT_DAYS=3
expect_ready cert-file
setup t3e; cp "$WORK/pki/other.key" "$D/certs/privkey.pem"; run_pc
expect_action cert-file "KHÔNG khớp"
setup t3f; echo "không phải pem" > "$D/certs/fullchain.pem"; run_pc
expect_action cert-file "không phải chứng chỉ PEM"
setup t3g; rm -f "$D/certs/privkey.pem"; run_pc
expect_action cert-file "không đọc được khoá riêng"
setup t3h; run_pc SAN_REQUIRED="tubutree.com www.tubutree.com app.tubutree.com"
expect_action cert-file "SAN không phủ app.tubutree.com"

echo "--- 3b. chuỗi CA: chứng chỉ tự ký/staging không được READY dù SAN, hạn, khoá đều đúng"
setup t3i; run_pc CA_FILE=""
expect_action cert-file "KHÔNG được CA tin cậy"; check "tự ký thoát 1" "$RC" 1
setup t3j; run_pc CA_FILE="$WORK/pki/nowww.crt"
expect_action cert-file "KHÔNG được CA tin cậy"
setup t3k; run_pc
contains "READY nêu chuỗi CA tin cậy" "$(line_of cert-file)" "chuỗi CA tin cậy"

echo "--- 4. chứng chỉ đang chạy của app/api: sắp hết hạn, không đọc được"
setup t4a; run_pc LIVE_CERT_APP="$WORK/pki/expiring.crt"
expect_action cert-app "còn"; expect_ready cert-api
setup t4b; run_pc LIVE_CERT_API=""
expect_action cert-api "không đọc được"
setup t4c; run_pc LIVE_TLS_HOSTS=""
lacks "LIVE_TLS_HOSTS rỗng: bỏ qua" "$OUT" "cert-app"

echo "--- 5. công cụ DNS-01: certbot thiếu plugin, plugin qua python/dpkg/snap, acme.sh + dns_cf"
setup t5a; ENVV="NODE_MODE=ok"; run_pc
expect_action dns01-tool "THIẾU plugin dns-cloudflare"
for src in PY_HAS_PLUGIN DPKG_HAS SNAP_HAS; do
  setup t5b; ENVV="NODE_MODE=ok $src=1"; run_pc
  expect_ready dns01-tool
done
setup t5c; rm -f "$D/bin/certbot"; ENVV="NODE_MODE=ok"; mkdir -p "$D/acme/dnsapi"; printf '#!/bin/sh\n' > "$D/acme/acme.sh"; chmod +x "$D/acme/acme.sh"
run_pc; expect_action dns01-tool "thiếu dns_cf"
touch "$D/acme/dnsapi/dns_cf.sh"; run_pc
expect_ready dns01-tool; contains "nêu acme.sh" "$(line_of dns01-tool)" "acme.sh + dnsapi dns_cf"
lacks "KHÔNG chạy acme.sh" "$(cat "$D/calls.log")" "acme.sh"
setup t5d; rm -f "$D/bin/certbot"; ENVV="NODE_MODE=ok"; run_pc
expect_action dns01-tool "không có certbot"
echo "--- 5b. certbot có shebang python: dùng đúng interpreter đó; shebang sh thì KHÔNG chạy 'import' bằng sh"
setup t5e; printf '#!%s/python3\nprint(1)\n' "$D/bin" > "$D/bin/certbot"; chmod +x "$D/bin/certbot"; ENVV="NODE_MODE=ok PY_HAS_PLUGIN=1"; run_pc
expect_ready dns01-tool
setup t5f; ENVV="NODE_MODE=ok"; run_pc
lacks "shebang sh: không gọi sh -c import" "$(cat "$D/calls.log")" "sh -c"
echo "--- 5c. dpkg: gói đã gỡ còn config-files không tính; certbot snap không dùng plugin apt; python chạy với -B (không ghi __pycache__)"
setup t5g; ENVV="NODE_MODE=ok DPKG_HAS=removed"; run_pc
expect_action dns01-tool "THIẾU plugin dns-cloudflare"
setup t5h; mkdir -p "$D/snap/bin"; mv "$D/bin/certbot" "$D/snap/bin/certbot"; PATH_EXTRA="$D/snap/bin"; ENVV="NODE_MODE=ok DPKG_HAS=1"; run_pc; PATH_EXTRA=""
expect_action dns01-tool "THIẾU plugin dns-cloudflare"
lacks "certbot snap: không gọi dpkg-query" "$(cat "$D/calls.log")" "dpkg-query"
setup t5i; ENVV="NODE_MODE=ok PY_HAS_PLUGIN=1"; run_pc
contains "python chạy với -B" "$(cat "$D/calls.log")" "python3 -B -c import certbot_dns_cloudflare"
lacks "không gọi python không -B" "$(grep '^python3 ' "$D/calls.log" | grep -v -- ' -B ' || true)" "python3"

echo "--- 6. token Cloudflare: mode lỏng / rỗng / thiếu khoá / acme.sh account.conf / biến môi trường; không bao giờ in giá trị"
setup t6a; chmod 644 "$D/creds/cloudflare.ini"; run_pc
expect_action cf-token "phải 600"; no_secret t6a
setup t6b; printf 'dns_cloudflare_api_token =\n' > "$D/creds/cloudflare.ini"; chmod 600 "$D/creds/cloudflare.ini"; run_pc
expect_action cf-token "không rỗng"
setup t6c; printf 'dns_cloudflare_email = a@b.c\ndns_cloudflare_api_key = %s\n' "$TOKEN" > "$D/creds/cloudflare.ini"; chmod 600 "$D/creds/cloudflare.ini"; run_pc
expect_action cf-token "dns_cloudflare_api_token"; no_secret t6c
setup t6d; rm -f "$D/creds/cloudflare.ini"; printf "SAVED_CF_Token='%s'\n" "$ACME_TOKEN" > "$D/acme/account.conf"; run_pc
expect_ready cf-token; contains "nêu nguồn acme.sh" "$(line_of cf-token)" "acme.sh account.conf"; no_secret t6d
setup t6e; rm -f "$D/creds/cloudflare.ini"; run_pc CF_Token="$ACME_TOKEN"
expect_ready cf-token; contains "nêu nguồn biến môi trường" "$(line_of cf-token)" "biến môi trường"; no_secret t6e
setup t6f; chmod 400 "$D/creds/cloudflare.ini"; run_pc
expect_ready cf-token
setup t6g; printf 'SAVED_CF_Token=\n' > "$D/acme/account.conf"; rm -f "$D/creds/cloudflare.ini"; run_pc
expect_action cf-token "chưa có token"

echo "--- 7. app/api: không phải 200 thì ACTION_NEEDED (redirect 301 cũng không đạt)"
setup t7a; run_pc CURL_CODE_APP=503
expect_action app-http "503"; expect_ready api-health
setup t7b; run_pc CURL_CODE_API=000
expect_action api-health "000"
setup t7c; run_pc CURL_CODE_APP=301
expect_action app-http "301"

echo "--- 7b. điều kiện chặn thật: SITE_URL, CORS_ORIGINS của container api, luật chuyển hướng mới đã chạy trên Next"
setup t7d; run_pc SITEMAP_MODE=old
expect_action site-url "NEXT_PUBLIC_SITE_URL"; expect_ready cors-origins; expect_ready live-redirect
setup t7e; run_pc SITEMAP_MODE=down
expect_action site-url "chưa ra https://tubutree.com"
setup t7f; run_pc CURL_CODE_REDIRECT=404
expect_action live-redirect "trả 404"; contains "nêu cần deploy web" "$(line_of live-redirect)" "cần deploy web"
setup t7g; run_pc CURL_CODE_REDIRECT=000
expect_action live-redirect "trả 000"
setup t7h; run_pc API_ENV='NODE_ENV=production\nCORS_ORIGINS=https://app.tubutree.com\nJWT_SECRET=SECRETJWT_TEST_5e6f7a8b9c\n'
expect_action cors-origins "chưa có https://tubutree.com"; no_secret t7h
setup t7i; run_pc API_ENV='CORS_ORIGINS= https://app.tubutree.com , https://tubutree.com \nJWT_SECRET=SECRETJWT_TEST_5e6f7a8b9c\n'
expect_ready cors-origins
setup t7j; run_pc API_ENV='CORS_ORIGINS=https://app.tubutree.com,https://tubutree.com.evil.example\n'
expect_action cors-origins "chưa có https://tubutree.com"
setup t7k; run_pc API_ENV='NODE_ENV=production\nJWT_SECRET=SECRETJWT_TEST_5e6f7a8b9c\n'
expect_ready cors-origins; contains "nêu mặc định" "$(line_of cors-origins)" "danh sách mặc định"; no_secret t7k
setup t7l; run_pc API_ENV='CORS_ORIGINS=,\n'
expect_ready cors-origins
setup t7m; run_pc API_ENV_MODE=missing
expect_action cors-origins "không đọc được env"
echo "--- 7c. kịch bản của reviewer: chủ đã có chứng chỉ và token nhưng SITE_URL, CORS, deploy web chưa làm → KHÔNG được báo sẵn sàng"
setup t7n; run_pc SITEMAP_MODE=old CURL_CODE_REDIRECT=404 API_ENV='CORS_ORIGINS=https://app.tubutree.com\n'
check "thoát 1" "$RC" 1
for id in site-url cors-origins live-redirect; do expect_action "$id"; done
contains "tổng kết 3 ACTION_NEEDED" "$OUT" "Tổng: 11 READY, 3 ACTION_NEEDED"
lacks "không in 'mọi hạng mục READY'" "$OUT" "mọi hạng mục READY"

echo "--- 8. đĩa trống >= 20%: used 80 → READY, 81 → ACTION_NEEDED"
setup t8a; run_pc FAKE_DF_USED=80
expect_ready disk-free
setup t8b; run_pc FAKE_DF_USED=81
expect_action disk-free "19%"
setup t8c; run_pc DISK_PATHS="/nonexistent-path-xyz"
expect_action disk-free "không đọc được dung lượng"

echo "--- 9. backup Postgres: không có thư mục / chưa có file / rỗng / gzip hỏng / cũ / mới và hợp lệ"
setup t9a; rm -rf "$D/backups"; run_pc
expect_action pg-backup "không thấy thư mục"
setup t9b; rm -f "$D/backups/"*; run_pc
expect_action pg-backup "chưa có file"
setup t9c; rm -f "$D/backups/"*; : > "$D/backups/tubutree_20261114_000000_cron.sql.gz"; run_pc
expect_action pg-backup "chưa có file"
setup t9d; rm -f "$D/backups/"*; echo "không phải gzip" > "$D/backups/tubutree_20261114_000000_cron.sql.gz"; run_pc
expect_action pg-backup "KHÔNG phải gzip hợp lệ"
setup t9e; touch -t "$(ago 20)" "$D/backups/tubutree_20261114_000000_cron.sql.gz"; run_pc
expect_action pg-backup "cũ hơn 8 giờ"
run_pc BACKUP_MAX_AGE_HOURS=48
expect_ready pg-backup
setup t9f; echo "x" > "$D/backups/.last-offsite-ok"; run_pc
contains "INFO offsite có dấu" "$OUT" "backup offsite: dấu .last-offsite-ok trong 30 giờ qua"
setup t9g; run_pc
contains "INFO offsite chưa bật (không gây ACTION)" "$OUT" "backup offsite: chưa bật"
check "chưa bật offsite vẫn thoát 0" "$RC" 0

echo "--- 10. bảng chuyển hướng offline: FAIL / không có dòng tổng kết / Node cũ dùng docker không mạng / không có gì chạy được"
setup t10a; run_pc NODE_MODE=fail
expect_action redirect-rules "bảng chuyển hướng có lỗi"; contains "nêu dòng FAIL" "$(line_of redirect-rules)" "FAIL /x/ -> /y"
setup t10b; run_pc NODE_MODE=noline
expect_action redirect-rules "không cho ra dòng tổng kết"
setup t10c; run_pc NODE_MODE=old DOCKER_IMAGE=tubutree-web:latest
expect_ready redirect-rules; contains "chạy qua docker" "$(line_of redirect-rules)" "docker tubutree-web:latest"
contains "docker run không mạng" "$(cat "$D/calls.log")" "docker run --rm --network none --read-only -v $REPO_ROOT:/repo:ro --entrypoint node tubutree-web:latest /repo/scripts/ops/check-cutover-redirects.mjs --offline"
setup t10d; run_pc NODE_MODE=old DOCKER_IMAGE=tubutree-web:latest DOCKER_RUN_MODE=fail
expect_action redirect-rules "bảng chuyển hướng có lỗi"
setup t10e; run_pc NODE_MODE=old
expect_action redirect-rules "không có Node >= 22.18"
setup t10f; run_pc NODE_BIN=/không/có/node NODE_MODE=old
expect_action redirect-rules "không có Node >= 22.18"

echo "--- 10b. bảng luật THẬT (cần Node >= 22.18 trên máy này)"
REAL_NODE=""
for cand in "$(command -v node 2>/dev/null)" "$HOME"/.local/node/node-v22*/bin/node; do
  [ -x "${cand:-}" ] && "$cand" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null && { REAL_NODE="$cand"; break; }
done
if [ -n "$REAL_NODE" ]; then
  setup t10g; run_pc NODE_BIN="$REAL_NODE"
  expect_ready redirect-rules
  contains "tổng kết thật 0 FAIL" "$(line_of redirect-rules)" " 0 FAIL, "
else
  echo "skip không có Node >= 22.18"
fi

echo "--- 11. THAM SỐ: --help thoát 0, tham số lạ thoát 2, số sai thoát 2"
setup t11
OUT="$(bash "$SCRIPT" --help 2>&1)"; RC=$?
check "--help thoát 0" "$RC" 0
contains "--help nêu CHỈ ĐỌC" "$OUT" "CHỈ ĐỌC"
OUT="$(bash "$SCRIPT" --bogus 2>&1)"; RC=$?
check "tham số lạ thoát 2" "$RC" 2
OUT="$(env MIN_CERT_DAYS=abc bash "$SCRIPT" 2>&1)"; RC=$?
check "MIN_CERT_DAYS=abc thoát 2" "$RC" 2

echo "--- 12. CHỈ ĐỌC: thư mục giả không đổi, TMPDIR vẫn rỗng, không gọi lệnh ghi/cài, curl chỉ GET, docker chỉ inspect/run không mạng"
for sc in t1 t2 t6d t10c; do
  case "$sc" in
    t1) setup t12 ;;
    t2) setup t12; rm -f "$D/certs/fullchain.pem" "$D/bin/certbot" ;;
    t6d) setup t12; rm -f "$D/creds/cloudflare.ini"; printf "SAVED_CF_Token='%s'\n" "$ACME_TOKEN" > "$D/acme/account.conf" ;;
    t10c) setup t12; ENVV="NODE_MODE=old DOCKER_IMAGE=tubutree-web:latest" ;;
  esac
  run_pc
  check "$sc: thư mục giả y nguyên" "$SNAP_AFTER" "$SNAP_BEFORE"
  check "$sc: TMPDIR rỗng" "$(ls -A "$D/tmp" | wc -l | tr -d ' ')" 0
  calls="$(cat "$D/calls.log")"
  for bad in "certbot " "acme.sh" "apachectl" "systemctl"; do lacks "$sc: không gọi $bad" "$calls" "$bad"; done
  bad_curl="$(grep '^curl ' <<<"$calls" | grep -E -- ' -X | --request | -d | --data| -T | -F | --upload' || true)"
  check "$sc: curl chỉ GET (không -X/-d/-T/-F)" "$bad_curl" ""
  bad_hdr="$(grep '^curl ' <<<"$calls" | grep -E -- ' -H ' | grep -vE -- ' -H Host: ' || true)"
  check "$sc: curl chỉ thêm header Host" "$bad_hdr" ""
  bad_docker="$(grep '^docker ' <<<"$calls" | grep -vE '^docker (inspect |run --rm --network none --read-only )' || true)"
  bad_inspect="$(grep '^docker inspect' <<<"$calls" | grep -vE -- '--format' || true)"
  check "$sc: docker inspect luôn có --format (không dump toàn bộ cấu hình)" "$bad_inspect" ""
  check "$sc: docker chỉ inspect và run không mạng, chỉ đọc" "$bad_docker" ""
  no_secret "$sc"
done

echo "--- 13. mã nguồn không chứa lệnh ghi/cài/cutover"
src="$(grep -v '^[[:space:]]*#' "$SCRIPT")"
for pat in '--apply' 'cutover-apex-apply' 'cutover-apex-rollback' 'apachectl' 'certbot (certonly|renew|delete)' 'acme\.sh --(issue|install|renew)' 'docker (rm|rmi|compose|exec|stop|start|restart|kill|build|push|tag)' \
  'systemctl' 'crontab' '\bmktemp\b' '(^|[[:space:];&|(])rm +-' '\bmv ' '\bcp ' '\bchmod\b' '\bchown\b' '\btee\b' '\binstall -' '>>' 'curl .*(-X|--data| -d | -T | -F )'; do
  if grep -Eq -- "$pat" <<<"$src"; then fail "mã nguồn chứa mẫu cấm: $pat"; else pass "mã nguồn không chứa: $pat"; fi
done
# Ngoài các dòng thông báo (chuỗi có chữ ">=" hay "<giá trị>"), mọi `>` còn lại phải là chuyển hướng tới /dev/null hoặc &1/&2, không ghi vào tệp.
bad_redirect="$(grep -vE '(ready|action|verdict|problem=)[ "]' <<<"$src" | grep -E '>' | grep -vE '>/dev/null|>&|<<<' || true)"
check "không ghi tệp bằng >" "$bad_redirect" ""

exit "$FAILED"
