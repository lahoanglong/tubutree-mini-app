#!/usr/bin/env bash
# Kiểm ops/setup-apex-dns01-ssl.sh: --check từng hạng mục, --install-plugin idempotent, --staging/--issue gọi certbot đúng tham số, chặn khi thiếu điều kiện,
# token Cloudflare KHÔNG BAO GIỜ nằm trong stdout/stderr (kể cả khi certbot giả cố in tệp credentials), và script không động tới vhost hay cutover.
# Không cần mạng, certbot, apt hay root thật: `certbot`, `apt-get`, `dpkg-query`, `snap`, `id`, `nginx`, `apachectl` đều giả (ghi lệnh vào $CALLS). Chứng chỉ thử sinh bằng openssl thật.
# PATH của script chỉ gồm lệnh giả và vài công cụ cơ bản (symlink), nên máy Linux có sẵn certbot thật cũng không làm lệch kết quả. Chạy được trên macOS (bash 3.2) và Linux.
#   bash ops/test-setup-apex-dns01-ssl.sh [đường-dẫn-setup-apex-dns01-ssl.sh]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${1:-$SELF_DIR/setup-apex-dns01-ssl.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REAL_OPENSSL="$(command -v openssl)"
REAL_BASH="$(command -v bash)"
TOKEN="SECRETTOKEN_TEST_9f8e7d6c5b4a"
FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: mong '$3', thực tế '$2'"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1: thiếu '$3'"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then fail "$1: không được có '$3'"; else pass "$1"; fi; }

# ── công cụ cơ bản (symlink) và lệnh giả ──
mkdir -p "$WORK/bin" "$WORK/stub" "$WORK/cb" "$WORK/snapbin/snap/bin" "$WORK/cf" "$WORK/pki"
for t in bash sh sed awk grep stat date head cut tr basename dirname cat openssl mktemp uname hostname; do
  p="$(command -v "$t" 2>/dev/null || true)"
  [ -n "$p" ] && ln -s "$p" "$WORK/bin/$t"
done
cat > "$WORK/cb/certbot" <<'STUB'
#!/usr/bin/env bash
echo "certbot $*" >> "$CALLS"
if [ "${CERTBOT_LEAK:-0}" = 1 ]; then
  # Giả lập certbot lỡ in tệp credentials ra cả stdout lẫn stderr: bộ lọc của script phải che giá trị token.
  cat "$CF_CREDENTIALS"
  cat "$CF_CREDENTIALS" >&2
fi
echo "certbot giả: xong"
exit "${CERTBOT_RC:-0}"
STUB
cp "$WORK/cb/certbot" "$WORK/snapbin/snap/bin/certbot"
cat > "$WORK/stub/dpkg-query" <<'STUB'
#!/usr/bin/env bash
if [ "$(cat "$PLUGIN_STATE" 2>/dev/null)" = installed ]; then printf 'install ok installed'; exit 0; fi
printf 'unknown ok not-installed'; exit 1
STUB
cat > "$WORK/stub/apt-get" <<'STUB'
#!/usr/bin/env bash
echo "apt-get $*" >> "$CALLS"
[ "${APT_FAIL:-0}" = 1 ] && exit 100
echo installed > "$PLUGIN_STATE"
exit 0
STUB
cat > "$WORK/stub/snap" <<'STUB'
#!/usr/bin/env bash
echo "snap $*" >> "$CALLS"
exit 1
STUB
cat > "$WORK/stub/id" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in -u) echo "${FAKE_UID:-0}" ;; -un) if [ "${FAKE_UID:-0}" = 0 ]; then echo root; else echo tester; fi ;; *) echo "uid=${FAKE_UID:-0}" ;; esac
STUB
for t in nginx apachectl; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS"\n' "$t" > "$WORK/stub/$t"
done
cat > "$WORK/stub/pre-check.sh" <<'STUB'
#!/usr/bin/env bash
echo "pre-check $*" >> "$CALLS"
echo "[READY]         vhost-src      giả"
echo "[ACTION_NEEDED] cf-token       giả"
exit 1
STUB
chmod +x "$WORK"/stub/* "$WORK/cb/certbot" "$WORK/snapbin/snap/bin/certbot"
[ -x "$WORK/bin/openssl" ] || { echo "FAIL không có openssl"; exit 1; }

# ── chứng chỉ thử (openssl thật), tự ký và tự làm CA qua CA_FILE ──
mkcert() { # tên ngày
  cat > "$WORK/pki/$1.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = tubutree.com
O = $1
[v3]
subjectAltName = DNS:tubutree.com,DNS:www.tubutree.com
EOF
  "$REAL_OPENSSL" req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/pki/$1.key" -out "$WORK/pki/$1.crt" -days "$2" -config "$WORK/pki/$1.cnf" >/dev/null 2>&1
}
mkcert good 90
mkcert staging 90
mkcert expiring 5
[ -s "$WORK/pki/good.crt" ] && [ -s "$WORK/pki/staging.crt" ] && [ -s "$WORK/pki/expiring.crt" ] || { echo "FAIL không sinh được chứng chỉ thử bằng openssl"; exit 1; }
use_cert() { mkdir -p "$WORK/live/tubutree.com"; cp "$WORK/pki/$1.crt" "$WORK/live/tubutree.com/fullchain.pem"; }
no_cert() { rm -rf "$WORK/live"; }
set_creds() { # mode [nội-dung]
  printf '%s\n' "${2-dns_cloudflare_api_token = $TOKEN}" > "$WORK/cf/cloudflare.ini"
  chmod "$1" "$WORK/cf/cloudflare.ini"
}
no_creds() { rm -f "$WORK/cf/cloudflare.ini"; }

# ── chạy script: OUT, ERR, RC; kèm kiểm token không lộ và không đụng vhost ở mọi lần chạy ──
CALLS="$WORK/calls.log"
OUT="" ERR="" RC=0
script_path() { # PATH cho script: lệnh giả + công cụ cơ bản; certbot giả trừ khi NO_CERTBOT=1
  if [ "${NO_CERTBOT:-0}" = 1 ]; then echo "$WORK/stub:$WORK/bin"; else echo "$WORK/stub:$WORK/cb:$WORK/bin"; fi
}
guards() { # nhãn
  lacks "$1: stdout không lộ token" "$OUT" "$TOKEN"
  lacks "$1: stderr không lộ token" "$ERR" "$TOKEN"
  lacks "$1: không gọi nginx" "$(cat "$CALLS")" "nginx"
  lacks "$1: không gọi apachectl" "$(cat "$CALLS")" "apachectl"
  lacks "$1: không gọi cutover-apex" "$(cat "$CALLS")" "cutover-apex"
}
run() { # nhãn args...   (biến thể lấy từ shell hiện tại)
  local label="$1"
  shift
  : > "$CALLS"
  OUT="$(env PATH="$(script_path)" CALLS="$CALLS" PLUGIN_STATE="$WORK/plugin.state" \
    CF_CREDENTIALS="$WORK/cf/cloudflare.ini" LIVE_DIR="$WORK/live/tubutree.com" LE_ACCOUNTS_DIR="$WORK/accounts" \
    CA_FILE="${TEST_CA:-$WORK/pki/good.crt}" PRE_CHECK="$WORK/stub/pre-check.sh" PROPAGATION_SECONDS=30 \
    CERTBOT_RC="${CERTBOT_RC:-0}" CERTBOT_LEAK="${CERTBOT_LEAK:-0}" APT_FAIL="${APT_FAIL:-0}" FAKE_UID="${FAKE_UID:-0}" \
    ${CERTBOT_EMAIL:+CERTBOT_EMAIL="$CERTBOT_EMAIL"} \
    "$REAL_BASH" "$SCRIPT" "$@" 2>"$WORK/err.txt")"
  RC=$?
  ERR="$(cat "$WORK/err.txt")"
  guards "$label"
}
run_snap() { # nhãn args...: certbot nằm dưới .../snap/bin
  local label="$1"
  shift
  : > "$CALLS"
  OUT="$(env PATH="$WORK/snapbin/snap/bin:$WORK/stub:$WORK/bin" CALLS="$CALLS" PLUGIN_STATE="$WORK/plugin.state" FAKE_UID=0 \
    CF_CREDENTIALS="$WORK/cf/cloudflare.ini" LIVE_DIR="$WORK/live/tubutree.com" LE_ACCOUNTS_DIR="$WORK/accounts" \
    "$REAL_BASH" "$SCRIPT" "$@" 2>"$WORK/err.txt")"
  RC=$?
  ERR="$(cat "$WORK/err.txt")"
  guards "$label"
}
reset_state() {
  rm -rf "$WORK/accounts" "$WORK/plugin.state" "$WORK/live"
  mkdir -p "$WORK/accounts/acme-v02.api.letsencrypt.org" "$WORK/accounts/acme-staging-v02.api.letsencrypt.org"
  unset CERTBOT_RC CERTBOT_LEAK APT_FAIL FAKE_UID CERTBOT_EMAIL TEST_CA NO_CERTBOT
  no_creds
}
installed() { echo installed > "$WORK/plugin.state"; }
certbot_calls() { grep -c '^certbot' "$CALLS" || true; }

# ══ Tham số ══
reset_state
run "tham số lạ" --bogus; check "tham số lạ: mã thoát 2" "$RC" 2; contains "tham số lạ: nêu tham số" "$ERR" "--bogus"
run "hai chế độ" --issue --staging; check "hai chế độ: mã thoát 2" "$RC" 2
run "--help" --help; check "--help: mã thoát 0" "$RC" 0; contains "--help: có --staging" "$OUT" "--staging"; contains "--help: có --install-plugin" "$OUT" "--install-plugin"
check "--help: không chạy certbot" "$(certbot_calls)" 0

# ══ --check (mặc định, chỉ đọc) ══
reset_state
NO_CERTBOT=1
run "check thiếu certbot"
check "check thiếu certbot: mã thoát 1" "$RC" 1
contains "check thiếu certbot: báo certbot" "$OUT" "[ACTION_NEEDED] certbot"
contains "check thiếu certbot: báo plugin" "$OUT" "[ACTION_NEEDED] plugin"
contains "check thiếu certbot: gợi ý --install-plugin" "$OUT" "--install-plugin"
contains "check thiếu certbot: báo thiếu tệp token" "$OUT" "chưa có $WORK/cf/cloudflare.ini"
contains "check thiếu certbot: báo chưa có chứng chỉ" "$OUT" "chưa có $WORK/live/tubutree.com/fullchain.pem"
check "check: không ghi gì (không gọi certbot/apt-get)" "$(grep -c -E '^(certbot|apt-get)' "$CALLS" || true)" 0

reset_state
set_creds 600; use_cert good
run "check thiếu plugin"
check "check thiếu plugin: mã thoát 1" "$RC" 1
contains "check thiếu plugin: certbot READY" "$OUT" "[READY]         certbot"
contains "check thiếu plugin: plugin ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] plugin"
contains "check thiếu plugin: nêu tên gói" "$OUT" "python3-certbot-dns-cloudflare"
contains "check thiếu plugin: tệp token READY" "$OUT" "[READY]         credentials"
contains "check thiếu plugin: chứng chỉ READY" "$OUT" "[READY]         cert-file"

reset_state
installed; use_cert good
run "check thiếu tệp token"
check "check thiếu tệp token: mã thoát 1" "$RC" 1
contains "check thiếu tệp token: credentials ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] credentials"
contains "check thiếu tệp token: nêu đường dẫn" "$OUT" "chưa có $WORK/cf/cloudflare.ini"
contains "check thiếu tệp token: plugin READY" "$OUT" "[READY]         plugin"

reset_state
installed; use_cert good; set_creds 644
run "check mode 644"
check "check mode 644: mã thoát 1" "$RC" 1
contains "check mode 644: credentials ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] credentials"
contains "check mode 644: nêu mode 644" "$OUT" "mode 644"
contains "check mode 644: gợi ý chmod 600" "$OUT" "chmod 600"

reset_state
installed; use_cert good; set_creds 600 "dns_cloudflare_api_token ="
run "check token rỗng"
check "check token rỗng: mã thoát 1" "$RC" 1
contains "check token rỗng: credentials ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] credentials"
contains "check token rỗng: nêu thiếu giá trị" "$OUT" "không rỗng"
set_creds 600 "sai_dinh_dang = $TOKEN"
run "check sai định dạng"
contains "check sai định dạng: credentials ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] credentials"

reset_state
installed; use_cert good; set_creds 400
run "check mode 400"
contains "check mode 400: credentials READY" "$OUT" "[READY]         credentials"

reset_state
installed; set_creds 600; no_cert
run "check chưa có chứng chỉ"
check "check chưa có chứng chỉ: mã thoát 1" "$RC" 1
contains "check chưa có chứng chỉ: cert-file ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] cert-file"

reset_state
installed; set_creds 600; use_cert staging
run "check chứng chỉ staging"
check "check chứng chỉ staging: mã thoát 1" "$RC" 1
contains "check chứng chỉ staging: ACTION_NEEDED" "$OUT" "[ACTION_NEEDED] cert-file"
contains "check chứng chỉ staging: nêu CA không tin" "$OUT" "KHÔNG được CA tin cậy"

reset_state
installed; set_creds 600; use_cert expiring; TEST_CA="$WORK/pki/expiring.crt"
run "check chứng chỉ sắp hết hạn"
check "check chứng chỉ sắp hết hạn: mã thoát 1" "$RC" 1
contains "check chứng chỉ sắp hết hạn: nêu hết hạn" "$OUT" "hết hạn trong < 14 ngày"

reset_state
installed; set_creds 600; use_cert good
run "check đủ hết"
check "check đủ hết: mã thoát 0" "$RC" 0
contains "check đủ hết: tổng 4 READY" "$OUT" "Tổng: 4 READY, 0 ACTION_NEEDED"
contains "check đủ hết: nêu số ngày còn lại" "$OUT" "còn 89 ngày"
run "check --check tường minh" --check
check "check tường minh: mã thoát 0" "$RC" 0

# ══ --install-plugin ══
reset_state
FAKE_UID=1000
run "install không root" --install-plugin
check "install không root: mã thoát 1" "$RC" 1
contains "install không root: nêu cần root" "$ERR" "cần root"
check "install không root: không gọi apt-get" "$(grep -c apt-get "$CALLS" || true)" 0

reset_state
run "install lần đầu" --install-plugin
check "install lần đầu: mã thoát 0" "$RC" 0
check "install lần đầu: đúng lệnh apt-get" "$(grep apt-get "$CALLS")" "apt-get install -y python3-certbot-dns-cloudflare"
contains "install lần đầu: báo đã cài" "$OUT" "Đã cài plugin"
run "install lần hai (idempotent)" --install-plugin
check "install lần hai: mã thoát 0" "$RC" 0
check "install lần hai: KHÔNG gọi apt-get" "$(grep -c apt-get "$CALLS" || true)" 0
contains "install lần hai: báo đã có" "$OUT" "đã có"

reset_state
NO_CERTBOT=1
run "install chưa có certbot" --install-plugin
check "install chưa có certbot: mã thoát 0" "$RC" 0
check "install chưa có certbot: cài cả certbot và plugin" "$(grep apt-get "$CALLS")" "apt-get install -y certbot python3-certbot-dns-cloudflare"

reset_state
APT_FAIL=1
run "install apt lỗi" --install-plugin
check "install apt lỗi: mã thoát 1" "$RC" 1
contains "install apt lỗi: nêu apt-get lỗi" "$ERR" "apt-get install"

reset_state
run_snap "install certbot snap" --install-plugin
check "install certbot snap: mã thoát 1" "$RC" 1
contains "install certbot snap: nêu bản snap" "$ERR" "bản snap"
check "install certbot snap: KHÔNG gọi apt-get" "$(grep -c apt-get "$CALLS" || true)" 0

# ══ --staging ══
reset_state
installed; no_creds
run "staging thiếu tệp token" --staging
check "staging thiếu tệp token: mã thoát 1" "$RC" 1
contains "staging thiếu tệp token: nêu lý do" "$ERR" "chưa có $WORK/cf/cloudflare.ini"
check "staging thiếu tệp token: KHÔNG gọi certbot" "$(certbot_calls)" 0

reset_state
installed; set_creds 644
run "staging mode 644" --staging
check "staging mode 644: mã thoát 1" "$RC" 1
contains "staging mode 644: nêu mode" "$ERR" "mode 644"
check "staging mode 644: KHÔNG gọi certbot" "$(certbot_calls)" 0

reset_state
set_creds 600
run "staging thiếu plugin" --staging
check "staging thiếu plugin: mã thoát 1" "$RC" 1
contains "staging thiếu plugin: gợi ý --install-plugin" "$ERR" "--install-plugin"
check "staging thiếu plugin: KHÔNG gọi certbot" "$(certbot_calls)" 0

reset_state
installed; set_creds 600; FAKE_UID=1000
run "staging không root" --staging
check "staging không root: mã thoát 1" "$RC" 1
check "staging không root: KHÔNG gọi certbot" "$(certbot_calls)" 0

reset_state
installed; set_creds 600; rm -rf "$WORK/accounts"
run "staging chưa có tài khoản ACME" --staging
check "staging chưa có tài khoản ACME: mã thoát 1" "$RC" 1
contains "staging chưa có tài khoản ACME: nêu CERTBOT_EMAIL" "$ERR" "CERTBOT_EMAIL"
check "staging chưa có tài khoản ACME: KHÔNG gọi certbot" "$(certbot_calls)" 0
CERTBOT_EMAIL="ops@example.test"
run "staging có CERTBOT_EMAIL" --staging
check "staging có CERTBOT_EMAIL: mã thoát 0" "$RC" 0
contains "staging có CERTBOT_EMAIL: truyền --email" "$(cat "$CALLS")" "--email ops@example.test"

reset_state
installed; set_creds 600
run "staging thành công" --staging
check "staging: mã thoát 0" "$RC" 0
STAGING_CALL="$(grep '^certbot' "$CALLS")"
check "staging: đúng một lần gọi certbot" "$(certbot_calls)" 1
check "staging: đúng tham số certbot" "$STAGING_CALL" "certbot certonly --dns-cloudflare --dns-cloudflare-credentials $WORK/cf/cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d tubutree.com -d www.tubutree.com --non-interactive --agree-tos --test-cert --cert-name tubutree.com-staging"
contains "staging: chạy pre-cutover-check sau certbot" "$(cat "$CALLS")" "pre-check"
contains "staging: in báo cáo pre-cutover" "$OUT" "[ACTION_NEEDED] cf-token"
contains "staging: nhắc cutover là việc của chủ" "$OUT" "việc của chủ"
contains "staging: nhắc dọn lineage staging" "$OUT" "certbot delete --cert-name tubutree.com-staging"
check "staging: certbot chạy trước pre-check" "$(grep -n -E '^(certbot|pre-check)' "$CALLS" | cut -d: -f2 | cut -d' ' -f1 | tr '\n' ' ')" "certbot pre-check "

reset_state
installed; set_creds 600; CERTBOT_LEAK=1
run "staging certbot lỡ in tệp token" --staging
check "staging che token: mã thoát 0" "$RC" 0
contains "staging che token: stdout có dấu [REDACTED]" "$OUT" "[REDACTED]"
contains "staging che token: dòng credentials vẫn hiện tên khoá" "$OUT" "dns_cloudflare_api_token = [REDACTED]"

reset_state
installed; set_creds 600; CERTBOT_RC=1
run "staging certbot lỗi" --staging
check "staging certbot lỗi: mã thoát 1" "$RC" 1
contains "staging certbot lỗi: nêu mã thoát certbot" "$ERR" "certbot thoát mã 1"
check "staging certbot lỗi: KHÔNG chạy pre-check" "$(grep -c '^pre-check' "$CALLS" || true)" 0

# ══ --issue ══
reset_state
installed; set_creds 600
run "issue thành công" --issue
check "issue: mã thoát 0" "$RC" 0
ISSUE_CALL="$(grep '^certbot' "$CALLS")"
check "issue: đúng tham số certbot" "$ISSUE_CALL" "certbot certonly --dns-cloudflare --dns-cloudflare-credentials $WORK/cf/cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d tubutree.com -d www.tubutree.com --non-interactive --agree-tos --cert-name tubutree.com"
lacks "issue: KHÔNG có --test-cert" "$ISSUE_CALL" "--test-cert"
contains "issue: chạy pre-cutover-check" "$(cat "$CALLS")" "pre-check"
contains "issue: nhắc cutover là việc của chủ" "$OUT" "việc của chủ"

reset_state
installed; set_creds 600; CERTBOT_LEAK=1
run "issue certbot lỡ in tệp token" --issue
contains "issue che token: stdout có [REDACTED]" "$OUT" "[REDACTED]"

reset_state
installed; set_creds 644
run "issue mode 644" --issue
check "issue mode 644: mã thoát 1" "$RC" 1
check "issue mode 644: KHÔNG gọi certbot" "$(certbot_calls)" 0

reset_state
installed; set_creds 600; CERTBOT_RC=1
run "issue certbot lỗi" --issue
check "issue certbot lỗi: mã thoát 1" "$RC" 1
check "issue certbot lỗi: KHÔNG chạy pre-check" "$(grep -c '^pre-check' "$CALLS" || true)" 0

reset_state
installed; no_creds
run "issue thiếu tệp token" --issue
check "issue thiếu tệp token: mã thoát 1" "$RC" 1
check "issue thiếu tệp token: KHÔNG gọi certbot" "$(certbot_calls)" 0

# ══ Tĩnh: mã nguồn script (bỏ dòng chú thích) ══
CODE="$(grep -v '^[[:space:]]*#' "$SCRIPT")"
lacks "tĩnh: không chạy cutover-apex-apply" "$(grep -E '^[[:space:]]*(bash|sh|exec)[[:space:]].*cutover-apex-apply|\./[^ ]*cutover-apex-apply' <<<"$CODE")" "cutover-apex-apply"
lacks "tĩnh: không đụng vhost nginx" "$(grep -E '(^|[^a-z])nginx[[:space:]]|/etc/nginx' <<<"$CODE")" "nginx"
lacks "tĩnh: không gọi apachectl" "$(grep -E '(^|[^a-z])apachectl[[:space:]]' <<<"$CODE")" "apachectl"
lacks "tĩnh: không nạp token vào biến shell" "$(grep -E 'TOKEN=|tok=\$\(|cat[[:space:]]+"?\$CF_CREDENTIALS' <<<"$CODE")" "="

echo
if [ "$FAILED" = 0 ]; then
  echo "TẤT CẢ ĐẠT"
  exit 0
fi
echo "CÓ LỖI"
exit 1
