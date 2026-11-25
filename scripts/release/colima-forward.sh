# shellcheck shell=bash
# Chỉ để `source` (apps/e2e/scripts/web-gate.sh, bước race của scripts/release/pre-submit-check.sh), không chạy riêng.
#
# Colima có lúc không chuyển tiếp cổng container mới ra máy (từ 24/11/2026): container `-p 127.0.0.1:X` sống nhưng máy không tới được X
# (Prisma P1001). Sau một khoảng chờ hostagent, cổng nào vẫn chưa nghe thì mở ssh -L riêng tới VM Colima.
# Chỉ kill PID ssh do chính hàm này mở ($!), KHÔNG BAO GIỜ kill theo cổng: tiến trình nghe cổng có thể là hostagent / ssh mux của Colima,
# kill nó làm hỏng Docker của mọi phiên.
#
# Biến:
#   GATE_COLIMA_TUNNEL         auto (mặc định) | off  — off: chỉ chờ, không mở đường hầm (để chứng minh đường hầm có tác dụng)
#   GATE_COLIMA_FORWARD_WAIT_S số giây chờ hostagent tự chuyển tiếp trước khi mở đường hầm (mặc định 5)
#   GATE_COLIMA_SSH_CONFIG     tệp ssh của VM (mặc định ~/.colima/_lima/colima/ssh.config)

COLIMA_TUNNEL_PIDS="${COLIMA_TUNNEL_PIDS:-}"

colima_port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# $@ = các cổng 127.0.0.1 của container vừa mở. Trả 0 khi mọi cổng đều nghe; 9 khi một cổng không lên được.
colima_forward_ports() {
  local cfg="${GATE_COLIMA_SSH_CONFIG:-$HOME/.colima/_lima/colima/ssh.config}" wait_s="${GATE_COLIMA_FORWARD_WAIT_S:-5}" p i pid
  for p in "$@"; do
    for ((i = 0; i < wait_s * 2; i++)); do
      colima_port_listening "$p" && break
      sleep 0.5
    done
    colima_port_listening "$p" && continue
    if [[ "${GATE_COLIMA_TUNNEL:-auto}" == off ]]; then
      echo "colima: cổng $p không nghe sau ${wait_s} giây (GATE_COLIMA_TUNNEL=off, không mở đường hầm)" >&2
      return 9
    fi
    [[ -f "$cfg" ]] || { echo "colima: cổng $p không nghe và không có $cfg (không phải Colima?)" >&2; return 9; }
    ssh -F "$cfg" -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
      -n -N -L "127.0.0.1:$p:127.0.0.1:$p" lima-colima &
    pid=$!
    for ((i = 0; i < 20; i++)); do
      colima_port_listening "$p" && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      COLIMA_TUNNEL_PIDS="$COLIMA_TUNNEL_PIDS $pid"
      colima_port_listening "$p" || { echo "colima: đường hầm cổng $p không lên" >&2; return 9; }
      echo "colima: đường hầm cổng $p (pid $pid)"
    else
      # ssh thoát (ExitOnForwardFailure): hostagent vừa kịp chuyển tiếp cổng, hoặc ssh hỏng. Không giữ PID đã chết.
      colima_port_listening "$p" || { echo "colima: đường hầm cổng $p không lên (ssh thoát)" >&2; return 9; }
      echo "colima: cổng $p đã được Colima tự chuyển tiếp"
    fi
  done
}

# Đóng các đường hầm do colima_forward_ports mở (gọi trong trap EXIT của script gọi).
colima_forward_cleanup() {
  local t
  for t in $COLIMA_TUNNEL_PIDS; do kill "$t" >/dev/null 2>&1 || true; done
  COLIMA_TUNNEL_PIDS=""
}
