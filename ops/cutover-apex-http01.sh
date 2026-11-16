#!/usr/bin/env bash
# Cutover apex tubutree.com + www.tubutree.com bằng HTTP-01 webroot (KHÔNG cần Cloudflare API token).
# Dùng ngay sau khi chủ đã đổi bản ghi DNS A của tubutree.com và www.tubutree.com về VPS Vietnix (14.225.207.177).
#
#   bash ops/cutover-apex-http01.sh            # = --check: chỉ ĐỌC, kiểm root, Apache, certbot, webroot và DNS công khai
#   bash ops/cutover-apex-http01.sh --apply    # cài tạm vhost cổng 80 (phase1), kiểm HTTP-01, cấp cert Let's Encrypt, rồi gọi cutover-apex-apply.sh --apply
#   bash ops/cutover-apex-http01.sh --help
#
# An toàn cho Apache dùng chung với ChoDeli: TUYỆT ĐỐI không restart/stop Apache, chỉ `$APACHECTL -t` rồi `$APACHECTL -k graceful`.
# Nếu configtest, graceful hoặc certbot lỗi trước khi có cert thì tự gọi `ops/cutover-apex-rollback.sh --from-apply`.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APACHECTL="${APACHECTL:-/www/server/apache/bin/apachectl}"
VHOST_DIR="${VHOST_DIR:-/www/server/panel/vhost/apache}"
VHOST_NAME="${VHOST_NAME:-tubutree.com.conf}"
PHASE1_SRC="${PHASE1_SRC:-$SELF_DIR/vietnix-vhost-apex.conf.phase1}"
VHOST_SRC="${VHOST_SRC:-$SELF_DIR/vietnix-vhost-apex.conf.cutover}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/tubutree-wp-precutover-20261114}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/tubutree.com}"
LE_ACCOUNTS_DIR="${LE_ACCOUNTS_DIR:-/etc/letsencrypt/accounts}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
EXPECTED_IP="${EXPECTED_IP:-14.225.207.177}"
DOMAINS="${DOMAINS:-tubutree.com www.tubutree.com}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
export APACHECTL VHOST_DIR VHOST_NAME VHOST_SRC BACKUP_DIR CERT_DIR

APPLY=0
APPLY_EXTRA=()
usage() { sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --check) APPLY=0; shift ;;
    --apply) APPLY=1; shift ;;
    --skip-canonical-check) APPLY_EXTRA+=(--skip-canonical-check); shift ;;
    --skip-cors-check) APPLY_EXTRA+=(--skip-cors-check); shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 3 ;;
  esac
done

FAILS=0
DNS_READY=1
pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf '[WARN] %s\n' "$*"; }
info() { printf '       %s\n' "$*"; }

PROBE_FILE=""
cleanup() {
  [ -n "$PROBE_FILE" ] && rm -f "$PROBE_FILE"
}
trap cleanup EXIT

cert_already_valid() {
  local cert="$CERT_DIR/fullchain.pem" key="$CERT_DIR/privkey.pem" san
  [ -r "$cert" ] && [ -r "$key" ] || return 1
  san="$(openssl x509 -noout -ext subjectAltName -in "$cert" 2>/dev/null)"
  printf '%s' "$san" | grep -q 'DNS:tubutree.com' || return 1
  printf '%s' "$san" | grep -q 'DNS:www.tubutree.com' || return 1
  openssl x509 -checkend $((MIN_CERT_DAYS * 86400)) -noout -in "$cert" >/dev/null 2>&1 || return 1
  openssl verify -untrusted "$cert" "$cert" 2>&1 | grep -q ': OK$' || return 1
  return 0
}

resolve_ipv4() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ *$//'
}

echo "== Kiểm điều kiện HTTP-01 webroot cho apex tubutree.com =="
[ "$(id -u)" = 0 ] && pass "chạy bằng root" || fail "cần root"
[ -f "$PHASE1_SRC" ] && pass "có vhost phase1: $PHASE1_SRC" || fail "thiếu vhost phase1: $PHASE1_SRC"
[ -f "$VHOST_SRC" ] && pass "có vhost cutover: $VHOST_SRC" || fail "thiếu vhost cutover: $VHOST_SRC"
command -v certbot >/dev/null 2>&1 && pass "có certbot: $(command -v certbot)" || fail "thiếu certbot"

if [ -n "$CERTBOT_EMAIL" ] || [ -d "$LE_ACCOUNTS_DIR/acme-v02.api.letsencrypt.org" ]; then
  pass "có tài khoản ACME Let's Encrypt (hoặc đã đặt CERTBOT_EMAIL)"
else
  fail "chưa có tài khoản ACME ở $LE_ACCOUNTS_DIR/acme-v02.api.letsencrypt.org: đặt CERTBOT_EMAIL=<email> trước khi chạy"
fi

if ct_out="$($APACHECTL -t 2>&1)" && printf '%s' "$ct_out" | grep -q 'Syntax OK'; then
  pass "Apache configtest sạch trước khi chạy"
else
  fail "Apache configtest hỏng trước khi chạy: $(printf '%s' "$ct_out" | head -3 | tr '\n' ' ')"
fi

for d in $DOMAINS; do
  ips="$(resolve_ipv4 "$d")"
  if [ "$ips" = "$EXPECTED_IP" ]; then
    pass "DNS $d -> $ips (đúng VPS Vietnix)"
  else
    DNS_READY=0
    if [ "$APPLY" = 1 ] && ! cert_already_valid; then
      fail "DNS $d hiện trỏ '${ips:-chưa phân giải}' (cần $EXPECTED_IP để HTTP-01 Let's Encrypt xác thực được)"
    else
      warn "DNS $d hiện trỏ '${ips:-chưa phân giải}' (chờ chủ đổi A record về $EXPECTED_IP ở Cloudflare)"
    fi
  fi
done

if cert_already_valid; then
  pass "chứng chỉ ở $CERT_DIR đã hợp lệ cho tubutree.com + www.tubutree.com"
else
  info "chưa có chứng chỉ hợp lệ ở $CERT_DIR (sẽ cấp qua HTTP-01 webroot khi chạy --apply sau khi đổi DNS)"
fi

if [ "$FAILS" -gt 0 ]; then
  echo
  echo "KHÔNG đủ điều kiện ($FAILS mục FAIL). Chưa đổi gì trên máy."
  exit 2
fi

if [ "$APPLY" = 0 ]; then
  echo
  if [ "$DNS_READY" = 1 ] || cert_already_valid; then
    echo "Sẵn sàng chạy: bash ops/cutover-apex-http01.sh --apply"
    exit 0
  fi
  echo "Hạ tầng cục bộ đã sẵn sàng 100%. Ngay khi đổi A record tubutree.com + www về $EXPECTED_IP, chạy: bash ops/cutover-apex-http01.sh --apply"
  exit 0
fi

rollback_and_exit() {
  echo "[FAIL] $1"
  echo "== Tự quay lại =="
  bash "$SELF_DIR/cutover-apex-rollback.sh" --from-apply
  exit 1
}

install -d -m 755 "$WEBROOT/.well-known/acme-challenge" || { echo "[FAIL] không tạo được $WEBROOT/.well-known/acme-challenge" >&2; exit 1; }

if ! cert_already_valid; then
  echo
  echo "== Bước 1/2: Cài tạm vhost cổng 80 (phase1) và cấp chứng chỉ Let's Encrypt qua HTTP-01 webroot =="
  TARGET="$VHOST_DIR/$VHOST_NAME"
  STATE="$BACKUP_DIR/.cutover-state"
  if [ ! -f "$STATE" ]; then
    mkdir -p "$BACKUP_DIR/apache-vhosts"
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

  install -m 600 -o root -g root "$PHASE1_SRC" "$TARGET.tmp" || rollback_and_exit "không ghi được $TARGET.tmp"
  mv -f "$TARGET.tmp" "$TARGET" || rollback_and_exit "không đặt được $TARGET"
  if ct_out="$($APACHECTL -t 2>&1)" && printf '%s' "$ct_out" | grep -q 'Syntax OK'; then
    pass "configtest sạch với vhost phase1"
  else
    rollback_and_exit "configtest hỏng với vhost phase1: $(printf '%s' "$ct_out" | head -3 | tr '\n' ' ')"
  fi
  $APACHECTL -k graceful >/dev/null 2>&1 || rollback_and_exit "apachectl -k graceful lỗi ở bước phase1"
  pass "apachectl -k graceful xong (phase1)"
  sleep 1

  TOKEN="tubu-http01-$(date +%s)-$$"
  PROBE_FILE="$WEBROOT/.well-known/acme-challenge/$TOKEN"
  printf '%s' "$TOKEN" > "$PROBE_FILE"
  chmod 644 "$PROBE_FILE"

  for d in $DOMAINS; do
    got_local="$(curl --noproxy '*' -sS --max-time 10 --resolve "$d:80:127.0.0.1" "http://$d/.well-known/acme-challenge/$TOKEN" 2>/dev/null || true)"
    [ "$got_local" = "$TOKEN" ] || rollback_and_exit "probe HTTP-01 nội bộ cho $d không khớp (nhận '${got_local:0:60}')"
    got_pub="$(curl --noproxy '*' -sS --max-time 15 "http://$d/.well-known/acme-challenge/$TOKEN" 2>/dev/null || true)"
    [ "$got_pub" = "$TOKEN" ] || rollback_and_exit "probe HTTP-01 công khai http://$d/.well-known/acme-challenge/... chưa tới VPS này (kiểm lại DNS/Cloudflare)"
  done
  rm -f "$PROBE_FILE"
  PROBE_FILE=""
  pass "probe HTTP-01 nội bộ và công khai PASS cho: $DOMAINS"

  cb_args=(certonly --webroot -w "$WEBROOT")
  for d in $DOMAINS; do cb_args+=(-d "$d"); done
  cb_args+=(--cert-name tubutree.com --non-interactive --agree-tos)
  if [ -x "$APACHECTL" ]; then
    cb_args+=(--deploy-hook "$APACHECTL -t && $APACHECTL -k graceful")
  fi
  if [ -n "$CERTBOT_EMAIL" ]; then
    cb_args+=(--email "$CERTBOT_EMAIL")
  fi
  certbot "${cb_args[@]}" || rollback_and_exit "certbot --webroot lỗi"
  cert_already_valid || rollback_and_exit "certbot báo xong nhưng chứng chỉ ở $CERT_DIR chưa hợp lệ"
  pass "đã cấp chứng chỉ Let's Encrypt hợp lệ vào $CERT_DIR"
fi

echo
echo "== Bước 2/2: Nâng cấp lên vhost HTTPS đầy đủ và kiểm 459 URL WordPress + ảnh uploads (cutover-apex-apply.sh --apply) =="
exec bash "$SELF_DIR/cutover-apex-apply.sh" --apply "${APPLY_EXTRA[@]}"
