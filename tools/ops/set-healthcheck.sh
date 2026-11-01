#!/usr/bin/env bash
# Gắn HEALTHCHECK_URL (healthchecks.io) vào dòng cron backup-db.sh trên VPS, để backup lỗi hoặc cron ngừng chạy thì có người được báo.
# Đường tay thay cho `ops.yml` hành động crontab khi workflow VM chưa bật. Chạy trên máy người vận hành:
#   bash tools/ops/set-healthcheck.sh
# Trên healthchecks.io đặt Period 6 giờ, Grace 1 giờ (cron backup 6 giờ/lần, ops/crontab.backup.example). URL ping được hỏi ẩn
# và đi qua stdin của ssh. Crontab phải có đúng một dòng đang chạy (không phải comment) gọi backup-db.sh; dòng có dạng lạ thì
# dừng để sửa tay. Bản cũ lưu ở /root/crontab.bak-hc-<giờ>; kiểm sau khi cài không đạt thì cài lại bản cũ.
# Lưu ý: chạy lại `ops.yml` hành động crontab sau này sẽ ghi lại dòng cron từ secret BACKUP_HEALTHCHECK_URL, đè URL đặt tay.
# Biến môi trường: TUBU_SSH (lệnh ssh tới VPS).
set -euo pipefail

SSH_CMD="${TUBU_SSH:-ssh -i $HOME/.ssh/chodeli_vietnix_vps -o ConnectTimeout=15 root@14.225.207.177}"

read -rsp "URL ping healthchecks.io (https://hc-ping.com/...): " U; echo
U="${U%/}"
[[ "$U" =~ ^https://hc-ping\.com/[A-Za-z0-9_/-]+$ ]] || { echo "URL phải có dạng https://hc-ping.com/<uuid> hoặc https://hc-ping.com/<ping-key>/<slug>." >&2; exit 1; }

REMOTE=$(cat <<'EOF'
set -euo pipefail
umask 077
CUR=$(crontab -l 2>/dev/null || true)
N=$(printf '%s\n' "$CUR" | grep -v '^[[:space:]]*#' | grep -c 'backup-db\.sh' || true)
[ "$N" -eq 1 ] || { echo "DỪNG: crontab có $N dòng đang chạy gọi backup-db.sh, cần đúng 1 (xem ops/crontab.backup.example)."; exit 1; }
BAK=${TUBU_BAK_DIR:-/root}/crontab.bak-hc-$(date +%Y%m%d-%H%M%S)-$$
NEW=$(mktemp)
trap 'rm -f "$NEW"' EXIT
printf '%s\n' "$CUR" > "$BAK"
# Tách dòng theo khoảng trắng (cả tab) nhưng giữ nguyên khoảng trắng gốc khi ghép lại. Biến môi trường phải đứng ngay trước lệnh
# chạy backup-db.sh: trước `bash`/`sh` nếu có, và chỉ sau lịch cron, sau một biến khác hoặc sau &&, ||, ;. Dạng khác thì dừng.
printf '%s\n' "$CUR" | U="$U" awk '
  function isAssign(t) { return t ~ /^[A-Za-z_][A-Za-z0-9_]*=/ }
  function isSep(t) { return t == "&&" || t == "||" || t == ";" }
  /^[ \t]*#/ || !/backup-db\.sh/ { print; next }
  {
    s = $0; lead = ""; n = 0
    if (match(s, /^[ \t]+/)) { lead = substr(s, 1, RLENGTH); s = substr(s, RLENGTH + 1) }
    while (length(s) > 0) {
      n++
      if (match(s, /[ \t]+/)) { tok[n] = substr(s, 1, RSTART - 1); gap[n] = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) }
      else { tok[n] = s; gap[n] = ""; s = "" }
    }
    k = 0
    for (i = 1; i <= n; i++) if (tok[i] ~ /(^|\/)backup-db\.sh$/) { if (k) { print "nhiều lệnh backup-db.sh trên một dòng" > "/dev/stderr"; bad = 1; exit 3 } k = i }
    sched = (tok[1] ~ /^@/) ? 1 : 5
    if (k <= sched) { print "không thấy đường dẫn backup-db.sh sau lịch cron" > "/dev/stderr"; bad = 1; exit 3 }
    h = 0
    for (i = sched + 1; i < k; i++) if (tok[i] ~ /^HEALTHCHECK_URL=/) { if (!h) h = i; else drop[i] = 1 }
    for (i = k + 1; i <= n; i++) if (tok[i] ~ /^HEALTHCHECK_URL=/) { print "HEALTHCHECK_URL nằm sau backup-db.sh" > "/dev/stderr"; bad = 1; exit 3 }
    j = k
    if (!h) {
      if (j - 1 > sched && tok[j - 1] ~ /^(\/usr)?(\/bin\/)?(ba|da)?sh$/) j--
      p = j - 1
      if (!(p == sched || isAssign(tok[p]) || isSep(tok[p]))) { print "trước lệnh backup có \"" tok[p] "\", không chèn được biến an toàn" > "/dev/stderr"; bad = 1; exit 3 }
    }
    out = lead
    for (i = 1; i <= n; i++) {
      if (drop[i]) continue
      if (!h && i == j) out = out "HEALTHCHECK_URL=" ENVIRON["U"] " "
      out = out (i == h ? "HEALTHCHECK_URL=" ENVIRON["U"] : tok[i]) gap[i]
    }
    print out
  }
  END { if (bad) exit 3 }
' > "$NEW" || { echo "DỪNG: dòng cron backup-db.sh có dạng lạ, sửa tay theo ops/crontab.backup.example. Crontab chưa đổi."; exit 1; }
crontab "$NEW"
LINE=$(crontab -l | grep -v '^[[:space:]]*#' | grep 'backup-db\.sh' || true)
if ! printf ' %s \n' "$LINE" | tr '\t' ' ' | grep -qF -- " HEALTHCHECK_URL=$U "; then
  echo "DỪNG: kiểm sau khi cài không thấy HEALTHCHECK_URL đúng trên dòng backup, cài lại crontab cũ ($BAK)."; crontab "$BAK"; exit 1
fi
echo "Đã cập nhật crontab (bản cũ: $BAK):"
printf '%s\n' "$LINE" | sed -E 's#HEALTHCHECK_URL=[^[:space:]]+#HEALTHCHECK_URL=***#'
if curl -fsS -m 10 --retry 3 -o /dev/null "$U"; then echo "Ping thử: OK (healthchecks.io sẽ hiện lần ping này)."; else echo "Ping thử LỖI: kiểm lại URL hoặc mạng ra ngoài của VPS."; exit 1; fi
EOF
)

{ printf '%s\n' "$U"; printf '%s\n' "$REMOTE"; } | $SSH_CMD 'IFS= read -r U; export U; exec bash -s'
