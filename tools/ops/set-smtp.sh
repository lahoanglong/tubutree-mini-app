#!/usr/bin/env bash
# Bật kênh email báo động (Gmail SMTP) trên VPS: ghi 7 biến OPS_ALERT_EMAIL_TO + SMTP_* vào /opt/tubutree/.env rồi tạo lại container API.
# Đường tay thay cho `ops.yml` hành động set-env khi workflow VM chưa bật. Chạy trên máy người vận hành, không chạy trên VPS:
#   bash tools/ops/set-smtp.sh [địa chỉ Gmail gửi và nhận, mặc định tubutree@gmail.com]
# Mật khẩu ứng dụng Gmail (16 chữ, tạo ở myaccount.google.com/apppasswords) được hỏi ẩn, đi qua stdin của ssh: không nằm trên
# dòng lệnh, không in ra, không ghi file ở máy này. API không lên healthy trong 120 giây thì trả .env cũ và tạo lại API.
# Biến môi trường: TUBU_SSH (lệnh ssh tới VPS), TUBU_DIR (mặc định /opt/tubutree).
set -euo pipefail

ADDR="${1:-tubutree@gmail.com}"
[[ "$ADDR" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Địa chỉ email không hợp lệ: $ADDR" >&2; exit 1; }
SSH_CMD="${TUBU_SSH:-ssh -i $HOME/.ssh/chodeli_vietnix_vps -o ConnectTimeout=15 root@14.225.207.177}"
DIR="${TUBU_DIR:-/opt/tubutree}"

read -rsp "Mật khẩu ứng dụng Gmail cho $ADDR: " P; echo
P="${P// /}"
[[ "$P" =~ ^[a-zA-Z]{16}$ ]] || { echo "Mật khẩu ứng dụng Gmail phải đúng 16 chữ cái (bỏ dấu cách)." >&2; exit 1; }

REMOTE=$(cat <<EOF
set -euo pipefail
cd '$DIR'
DC="docker compose -f docker-compose.vietnix.yml"
TS=\$(date +%Y%m%d-%H%M%S)-\$\$
cp -p .env ".env.bak-smtp-\$TS"
KEYS='OPS_ALERT_EMAIL_TO|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASS|SMTP_FROM'
{
  grep -vE "^(\$KEYS)=" ".env.bak-smtp-\$TS" || true
  printf '%s\n' 'OPS_ALERT_EMAIL_TO=$ADDR' 'SMTP_HOST=smtp.gmail.com' 'SMTP_PORT=465' 'SMTP_SECURE=true' 'SMTP_USER=$ADDR'
  printf 'SMTP_PASS=%s\n' "\$P"
  printf '%s\n' 'SMTP_FROM=$ADDR'
} > .env.smtp-new
# Ghi đè nội dung thay vì mv để giữ quyền và chủ sở hữu của .env.
cat .env.smtp-new > .env; rm -f .env.smtp-new
unset P
wait_healthy() {
  local s=unknown
  for _ in \$(seq 1 40); do
    s=\$(docker inspect -f '{{.State.Health.Status}}' "\$(\$DC ps -q api </dev/null)" 2>/dev/null || echo unknown)
    [ "\$s" = healthy ] && return 0; sleep 3
  done
  echo "api=\$s"; return 1
}
\$DC up -d --no-build --no-deps api </dev/null 2>&1 | tail -1
if ! wait_healthy; then
  echo "API không healthy sau 120 giây: trả .env cũ (.env.bak-smtp-\$TS) và tạo lại API."
  cat ".env.bak-smtp-\$TS" > .env
  \$DC up -d --no-build --no-deps api </dev/null 2>&1 | tail -1
  wait_healthy && echo "API đã chạy lại với .env cũ." || echo "API vẫn chưa healthy: làm theo docs/launch/deploy-rollback-runbook.md."
  exit 1
fi
echo "API healthy. Bản .env cũ: $DIR/.env.bak-smtp-\$TS"
grep -E "^(\$KEYS)=" .env | sed -E 's/^(SMTP_PASS=).*/\1***/'
EOF
)

{ printf '%s\n' "$P"; printf '%s\n' "$REMOTE"; } | $SSH_CMD 'IFS= read -r P; export P; exec bash -s'
echo "Xong. Kiểm: Quản trị > Sức khoẻ hệ thống, mục Báo động qua email phải đổi sang đã bật."
