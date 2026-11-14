#!/usr/bin/env bash
# Cài plugin certbot dns-cloudflare và xin chứng chỉ SSL DNS-01 cho tubutree.com + www.tubutree.com (apex còn ở ZenCloud nên HTTP-01 không chạy được).
# KHÔNG đụng vhost Apache/nginx, KHÔNG đổi DNS, KHÔNG chạy ops/cutover-apex-apply.sh: cutover vẫn là việc của chủ (docs/launch/apex-cutover-rehearsal-2026-11-14.md).
# Giá trị token Cloudflare KHÔNG BAO GIỜ được in: script chỉ kiểm tệp có mặt, mode và có dòng token không rỗng; đầu ra của certbot đi qua bộ lọc che giá trị đó.
#
#   bash ops/setup-apex-dns01-ssl.sh                  # = --check: chỉ đọc, báo còn thiếu gì
#   bash ops/setup-apex-dns01-ssl.sh --install-plugin # apt-get install python3-certbot-dns-cloudflare (idempotent, cần root)
#   bash ops/setup-apex-dns01-ssl.sh --staging        # xin thử chứng chỉ staging (--test-cert) vào lineage riêng tubutree.com-staging, không chạm thư mục live thật
#   bash ops/setup-apex-dns01-ssl.sh --issue          # xin chứng chỉ thật vào /etc/letsencrypt/live/tubutree.com/, rồi chạy ops/pre-cutover-check.sh
#
# --staging và --issue cần: certbot + plugin dns-cloudflare, /root/.secrets/cloudflare.ini mode 600 (hoặc 400) có dòng `dns_cloudflare_api_token = <token>`,
# và chạy bằng root. Tạo tệp token (việc của chủ, token quyền Zone:DNS:Edit của zone tubutree.com):
#   install -d -m 700 /root/.secrets && umask 077 && printf 'dns_cloudflare_api_token = %s\n' '<token>' > /root/.secrets/cloudflare.ini
# Mã thoát: 0 xong/READY, 1 còn thiếu hoặc certbot lỗi, 2 sai tham số.
#
# Biến môi trường (mặc định trong ngoặc), chủ yếu để diễn tập/kiểm thử:
#   CF_CREDENTIALS (/root/.secrets/cloudflare.ini)  LIVE_DIR (/etc/letsencrypt/live/tubutree.com)  LE_ACCOUNTS_DIR (/etc/letsencrypt/accounts)
#   DOMAINS ("tubutree.com www.tubutree.com")  PROPAGATION_SECONDS (30)  MIN_CERT_DAYS (14)
#   CERTBOT_EMAIL (rỗng: bỏ qua nếu máy đã có tài khoản ACME; chưa có tài khoản thì phải đặt)  PRE_CHECK (ops/pre-cutover-check.sh)
#   CA_FILE (rỗng = kho CA hệ thống; chuỗi chứng chỉ ở LIVE_DIR phải được CA này tin)
#   APACHECTL (/www/server/apache/bin/apachectl: --issue gắn --deploy-hook "apachectl -t && apachectl -k graceful" như lineage app/api, nếu tệp này chạy được)
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_CREDENTIALS="${CF_CREDENTIALS:-/root/.secrets/cloudflare.ini}"
LIVE_DIR="${LIVE_DIR:-/etc/letsencrypt/live/tubutree.com}"
LE_ACCOUNTS_DIR="${LE_ACCOUNTS_DIR:-/etc/letsencrypt/accounts}"
DOMAINS="${DOMAINS-tubutree.com www.tubutree.com}"
PROPAGATION_SECONDS="${PROPAGATION_SECONDS:-30}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
PRE_CHECK="${PRE_CHECK:-$SELF_DIR/pre-cutover-check.sh}"
CA_FILE="${CA_FILE:-}"
APACHECTL="${APACHECTL:-/www/server/apache/bin/apachectl}"
PLUGIN_PKG="python3-certbot-dns-cloudflare"
PROD_CERT_NAME="tubutree.com"
STAGING_CERT_NAME="tubutree.com-staging"

usage() { sed -n '2,/^set -u/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

MODE=""
set_mode() {
  if [ -n "$MODE" ] && [ "$MODE" != "$1" ]; then
    echo "Chỉ chọn một chế độ (đã có --$MODE, thêm --$1). Xem --help" >&2
    exit 2
  fi
  MODE="$1"
}
for arg in "$@"; do
  case "$arg" in
    -h | --help) usage; exit 0 ;;
    --check) set_mode check ;;
    --install-plugin) set_mode install-plugin ;;
    --staging) set_mode staging ;;
    --issue) set_mode issue ;;
    *) echo "Tham số lạ: $arg (xem --help)" >&2; exit 2 ;;
  esac
done
MODE="${MODE:-check}"
for n in PROPAGATION_SECONDS MIN_CERT_DAYS; do
  case "$(eval "printf '%s' \"\$$n\"")" in
    '' | *[!0-9]*) echo "$n phải là số nguyên không âm (xem --help)" >&2; exit 2 ;;
  esac
done

N_READY=0
N_ACTION=0
ready() { N_READY=$((N_READY + 1)); printf '[READY]         %-12s %s\n' "$1" "$2"; }
action() { N_ACTION=$((N_ACTION + 1)); printf '[ACTION_NEEDED] %-12s %s\n' "$1" "$2"; }
info() { printf '[INFO]          %s\n' "$*"; }
die() { printf 'LỖI: %s\n' "$*" >&2; exit 1; }

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }

is_snap_certbot() {
  case "$(command -v certbot 2>/dev/null)" in /snap/* | */snap/bin/*) return 0 ;; esac
  return 1
}

# Giống ops/pre-cutover-check.sh (certbot_has_cloudflare_plugin): để mục dns01-tool ở đó đổi sang READY đúng lúc plugin được cài.
plugin_installed() {
  local first py
  if ! is_snap_certbot; then
    if command -v dpkg-query >/dev/null 2>&1 && [ "$(dpkg-query -W -f='${Status}' "$PLUGIN_PKG" 2>/dev/null)" = "install ok installed" ]; then return 0; fi
  fi
  if command -v snap >/dev/null 2>&1 && snap list certbot-dns-cloudflare >/dev/null 2>&1; then return 0; fi
  command -v certbot >/dev/null 2>&1 || return 1
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
  return 1
}

# Tệp token: in ra LÝ DO (không bao giờ in giá trị) nếu chưa dùng được, rỗng nếu ổn.
credentials_problem() {
  local mode
  if [ ! -e "$CF_CREDENTIALS" ]; then
    echo "chưa có $CF_CREDENTIALS (chủ tạo, mode 600, dòng dns_cloudflare_api_token = <token quyền Zone:DNS:Edit>)"
    return
  fi
  if [ ! -r "$CF_CREDENTIALS" ]; then
    echo "$CF_CREDENTIALS không đọc được (chạy bằng root)"
    return
  fi
  mode="$(mode_of "$CF_CREDENTIALS")"
  case "$mode" in
    600 | 400) ;;
    *) echo "$CF_CREDENTIALS mode ${mode:-?}: phải 600 (chạy: chmod 600 $CF_CREDENTIALS)"; return ;;
  esac
  if ! grep -Eq '^[[:space:]]*dns_cloudflare_api_token[[:space:]]*=[[:space:]]*[^[:space:]]+' "$CF_CREDENTIALS" 2>/dev/null; then
    echo "$CF_CREDENTIALS không có dòng dns_cloudflare_api_token = <giá trị> không rỗng"
  fi
}

# Chứng chỉ ở LIVE_DIR: chỉ đọc. Staging/tự ký bị bắt bằng openssl verify (kho CA hệ thống không tin CA staging).
# Rỗng = ổn (số ngày còn lại để ở CERT_OK_DAYS); khác rỗng = lý do chưa dùng được.
cert_problem() {
  local pem="$LIVE_DIR/fullchain.pem" end now_s end_s verify_out issuer
  CERT_OK_DAYS="?"
  if [ ! -r "$pem" ]; then
    if [ -e "$pem" ]; then echo "có $pem nhưng không đọc được (chạy bằng root)"; else echo "chưa có $pem: chưa cấp chứng chỉ cho tubutree.com"; fi
    return
  fi
  end="$(openssl x509 -noout -enddate -in "$pem" 2>/dev/null | sed -n 's/^notAfter=//p')"
  if [ -z "$end" ]; then echo "$pem không phải chứng chỉ PEM đọc được"; return; fi
  issuer="$(openssl x509 -noout -issuer -in "$pem" 2>/dev/null)"
  verify_out="$(if [ -n "$CA_FILE" ]; then openssl verify -CAfile "$CA_FILE" -untrusted "$pem" "$pem" 2>&1; else openssl verify -untrusted "$pem" "$pem" 2>&1; fi)"
  if ! printf '%s\n' "$verify_out" | grep -q ': OK$'; then
    echo "chuỗi chứng chỉ KHÔNG được CA tin cậy (staging, tự ký hoặc hết hạn; $(printf '%s' "$issuer" | cut -c1-80)): chạy --issue để cấp bản thật"
    return
  fi
  if ! openssl x509 -checkend $((MIN_CERT_DAYS * 86400)) -noout -in "$pem" >/dev/null 2>&1; then
    echo "chứng chỉ hết hạn trong < $MIN_CERT_DAYS ngày (notAfter $end)"
    return
  fi
  now_s="$(date -u +%s)"
  end_s="$(date -u -d "$(printf '%s' "$end" | tr -s ' ')" +%s 2>/dev/null || date -u -j -f '%b %d %T %Y %Z' "$(printf '%s' "$end" | tr -s ' ')" +%s 2>/dev/null || true)"
  [ -n "$end_s" ] && CERT_OK_DAYS=$(((end_s - now_s) / 86400))
  return 0
}

do_check() {
  local p
  if command -v certbot >/dev/null 2>&1; then
    ready certbot "có $(command -v certbot)$(is_snap_certbot && echo ' (bản snap: plugin phải là snap certbot-dns-cloudflare, không phải gói apt)')"
  else
    action certbot "chưa cài certbot (bash ops/setup-apex-dns01-ssl.sh --install-plugin sẽ cài cùng plugin)"
  fi
  if plugin_installed; then
    ready plugin "có plugin dns-cloudflare cho certbot"
  else
    action plugin "thiếu plugin dns-cloudflare ($PLUGIN_PKG): chạy bash ops/setup-apex-dns01-ssl.sh --install-plugin (root)"
  fi
  p="$(credentials_problem)"
  if [ -n "$p" ]; then action credentials "$p"; else ready credentials "$CF_CREDENTIALS có mode 600 và dòng dns_cloudflare_api_token không rỗng (giá trị không in)"; fi
  p="$(cert_problem)"
  if [ -n "$p" ]; then
    action cert-file "$p"
  else
    cert_problem >/dev/null
    ready cert-file "$LIVE_DIR/fullchain.pem hợp lệ, CA tin cậy, còn $CERT_OK_DAYS ngày (>= $MIN_CERT_DAYS)"
  fi
  printf '\nTổng: %s READY, %s ACTION_NEEDED\n' "$N_READY" "$N_ACTION"
  [ "$N_ACTION" -eq 0 ]
}

need_root() { [ "$(id -u)" = 0 ] || die "chế độ --$MODE cần root (đang chạy bằng $(id -un 2>/dev/null || echo '?'))"; }

do_install_plugin() {
  need_root
  if plugin_installed; then
    echo "Plugin dns-cloudflare đã có: không làm gì (idempotent)."
    return 0
  fi
  if is_snap_certbot; then
    die "certbot ở đây là bản snap, gói apt $PLUGIN_PKG không dùng được với nó. Cài bản snap: snap set certbot trust-plugin-with-root=ok && snap install certbot-dns-cloudflare && snap connect certbot:plugin certbot-dns-cloudflare"
  fi
  command -v apt-get >/dev/null 2>&1 || die "không có apt-get: máy này không phải Debian/Ubuntu, cài plugin dns-cloudflare theo cách riêng của máy"
  local pkgs="$PLUGIN_PKG"
  command -v certbot >/dev/null 2>&1 || pkgs="certbot $PLUGIN_PKG"
  echo "Cài: $pkgs"
  # shellcheck disable=SC2086 # tách từ có chủ ý: danh sách gói
  DEBIAN_FRONTEND=noninteractive apt-get install -y $pkgs || die "apt-get install $pkgs lỗi"
  plugin_installed || die "đã chạy apt-get nhưng vẫn không thấy plugin dns-cloudflare (kiểm: certbot plugins)"
  # Gói apt cài xong chưa chứng tỏ certbot nạp được plugin (lệch bản plugin và certbot): hỏi chính certbot, để --check và pre-cutover-check không báo READY oan.
  certbot plugins --prepare 2>&1 | grep -q 'dns-cloudflare' ||
    die "đã cài gói $PLUGIN_PKG nhưng certbot không nạp được plugin (certbot plugins --prepare không thấy dns-cloudflare; certbot $(certbot --version 2>&1 | head -1)): xem certbot plugins --prepare, có thể lệch bản plugin và certbot"
  echo "Đã cài plugin dns-cloudflare (certbot nạp được)."
}

# Bộ lọc che giá trị token: đọc token TRONG awk từ tệp (không đưa token qua tham số dòng lệnh, `ps` không thấy), thay mọi chỗ khớp bằng [REDACTED].
redact_token() {
  # Che CẢ giá trị thô (đúng như ghi trong tệp, kể cả ngoặc và chú thích) LẪN giá trị certbot thực dùng (đã bóc ngoặc đơn/kép và chú thích ` # ...`).
  awk -v f="$CF_CREDENTIALS" -v q="'" '
    function redact(text, t,    i) {
      if (length(t) == 0) return text
      while ((i = index(text, t)) > 0) text = substr(text, 1, i - 1) "[REDACTED]" substr(text, i + length(t))
      return text
    }
    BEGIN {
      raw = ""; val = ""
      while ((getline l < f) > 0) {
        if (l ~ /^[[:space:]]*dns_cloudflare_api_token[[:space:]]*=/) {
          sub(/^[^=]*=[[:space:]]*/, "", l); sub(/[[:space:]]+$/, "", l); sub(/\r$/, "", l)
          raw = l
          sub(/[[:space:]]+#.*$/, "", l); sub(/[[:space:]]+$/, "", l)
          if (l ~ "^[\"" q "]" && l ~ "[\"" q "]$" && length(l) >= 2) l = substr(l, 2, length(l) - 2)
          val = l
        }
      }
      close(f)
    }
    {
      out = redact($0, raw)
      if (val != raw) out = redact(out, val)
      print out
    }'
}

do_issue() {
  local staging="$1" cert_name server_dir p rc d
  need_root
  command -v certbot >/dev/null 2>&1 || die "chưa có certbot: chạy trước bash ops/setup-apex-dns01-ssl.sh --install-plugin"
  plugin_installed || die "thiếu plugin dns-cloudflare: chạy trước bash ops/setup-apex-dns01-ssl.sh --install-plugin"
  p="$(credentials_problem)"
  [ -z "$p" ] || die "$p"
  [ -n "$DOMAINS" ] || die "DOMAINS rỗng"

  local args=(certonly --dns-cloudflare --dns-cloudflare-credentials "$CF_CREDENTIALS" --dns-cloudflare-propagation-seconds "$PROPAGATION_SECONDS")
  for d in $DOMAINS; do args+=(-d "$d"); done
  args+=(--non-interactive --agree-tos)
  if [ "$staging" = 1 ]; then
    cert_name="$STAGING_CERT_NAME"
    server_dir="acme-staging-v02.api.letsencrypt.org"
    args+=(--test-cert)
  else
    cert_name="$PROD_CERT_NAME"
    server_dir="acme-v02.api.letsencrypt.org"
    # Lineage app/api đã có renew_hook nạp lại Apache; thiếu hook này thì Apache giữ chứng chỉ cũ sau mỗi lần gia hạn (sau ~90 ngày là hết hạn thật).
    # --deploy-hook chạy khi cấp lần đầu và mỗi lần gia hạn; configtest chạy trước, graceful không cắt kết nối. Script này KHÔNG tự chạy apachectl.
    if [ -x "$APACHECTL" ]; then
      args+=(--deploy-hook "$APACHECTL -t && $APACHECTL -k graceful")
    else
      info "không thấy $APACHECTL chạy được: lineage KHÔNG có hook nạp lại Apache, sau mỗi lần gia hạn phải tự graceful Apache"
    fi
  fi
  args+=(--cert-name "$cert_name")
  if [ -n "$CERTBOT_EMAIL" ]; then
    args+=(--email "$CERTBOT_EMAIL")
  elif [ ! -d "$LE_ACCOUNTS_DIR/$server_dir" ]; then
    die "máy chưa có tài khoản ACME ($LE_ACCOUNTS_DIR/$server_dir): đặt CERTBOT_EMAIL=<email nhận thông báo hết hạn> rồi chạy lại"
  fi

  if [ "$staging" = 1 ]; then
    info "STAGING: chứng chỉ thử vào lineage $cert_name (trình duyệt không tin, KHÔNG dùng cho cutover); thư mục live thật không bị chạm. Xong thì dọn: certbot delete --cert-name $cert_name"
  else
    info "Cấp chứng chỉ THẬT vào $LIVE_DIR (Let's Encrypt giới hạn số lần cấp: nên chạy --staging trước)"
  fi
  info "certbot ${args[*]}"
  certbot "${args[@]}" 2>&1 | redact_token
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -ne 0 ]; then
    echo "certbot thoát mã $rc: chứng chỉ CHƯA được cấp, bỏ qua pre-cutover-check." >&2
    return 1
  fi
  echo
  echo "certbot xong. Báo cáo trạng thái mới (ops/pre-cutover-check.sh, chỉ đọc; mã thoát 1 ở đây chỉ nghĩa là còn hạng mục khác chưa xong):"
  if [ -f "$PRE_CHECK" ]; then
    bash "$PRE_CHECK" 2>&1 | redact_token || true
  else
    echo "Không thấy $PRE_CHECK, bỏ qua." >&2
  fi
  if [ "$staging" = 1 ]; then
    echo "Staging chỉ chứng minh đường DNS-01 chạy được. Bước tiếp: bash ops/setup-apex-dns01-ssl.sh --issue (cấp thật). Cutover vẫn là việc của chủ."
  else
    echo "Chứng chỉ thật đã cấp. Cutover (ops/cutover-apex-apply.sh) vẫn là việc của chủ, script này không chạy nó."
  fi
  return 0
}

case "$MODE" in
  check) do_check ;;
  install-plugin) do_install_plugin ;;
  staging) do_issue 1 ;;
  issue) do_issue 0 ;;
esac
