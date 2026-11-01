#!/usr/bin/env bash
# Gắn HEALTHCHECK_URL (healthchecks.io) vào dòng cron backup-db.sh trên VPS, để backup lỗi hoặc cron ngừng chạy thì có người được báo.
# Đường tay thay cho `ops.yml` hành động crontab khi workflow VM chưa bật. Chạy trên máy người vận hành:
#   bash tools/ops/set-healthcheck.sh
# Trên healthchecks.io đặt Period 6 giờ, Grace 1 giờ (cron backup 6 giờ/lần, ops/crontab.backup.example). URL ping được hỏi ẩn
# và đi qua stdin của ssh. Crontab phải có đúng một dòng gọi backup-db.sh; bản cũ lưu ở /root/crontab.bak-hc-<giờ>.
# Biến môi trường: TUBU_SSH (lệnh ssh tới VPS).
set -euo pipefail

SSH_CMD="${TUBU_SSH:-ssh -i $HOME/.ssh/chodeli_vietnix_vps -o ConnectTimeout=15 root@14.225.207.177}"

read -rsp "URL ping healthchecks.io (https://hc-ping.com/...): " U; echo
U="${U%/}"
[[ "$U" =~ ^https://hc-ping\.com/[A-Za-z0-9_/-]+$ ]] || { echo "URL phải có dạng https://hc-ping.com/<uuid> hoặc https://hc-ping.com/<ping-key>/<slug>." >&2; exit 1; }

REMOTE=$(cat <<'EOF'
set -euo pipefail
CUR=$(crontab -l 2>/dev/null || true)
N=$(printf '%s\n' "$CUR" | grep -c 'backup-db\.sh' || true)
[ "$N" -eq 1 ] || { echo "DỪNG: crontab có $N dòng gọi backup-db.sh, cần đúng 1 (xem ops/crontab.backup.example)."; exit 1; }
BAK=${TUBU_BAK_DIR:-/root}/crontab.bak-hc-$(date +%Y%m%d-%H%M%S)-$$
printf '%s\n' "$CUR" > "$BAK"; chmod 600 "$BAK"
printf '%s\n' "$CUR" | U="$U" awk '
  /backup-db\.sh/ {
    if ($0 ~ /HEALTHCHECK_URL=[^ ]+/) sub(/HEALTHCHECK_URL=[^ ]+/, "HEALTHCHECK_URL=" ENVIRON["U"])
    else sub(/[^ ]*backup-db\.sh/, "HEALTHCHECK_URL=" ENVIRON["U"] " &")
  }
  { print }
' | crontab -
echo "Đã cập nhật crontab (bản cũ: $BAK):"
crontab -l | grep 'backup-db\.sh' | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'
if curl -fsS -m 10 --retry 3 -o /dev/null "$U"; then echo "Ping thử: OK (healthchecks.io sẽ hiện lần ping này)."; else echo "Ping thử LỖI: kiểm lại URL hoặc mạng ra ngoài của VPS."; exit 1; fi
EOF
)

{ printf '%s\n' "$U"; printf '%s\n' "$REMOTE"; } | $SSH_CMD 'IFS= read -r U; export U; exec bash -s'
