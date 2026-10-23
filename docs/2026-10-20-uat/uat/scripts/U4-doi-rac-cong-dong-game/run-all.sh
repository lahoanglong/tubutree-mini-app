#!/usr/bin/env bash
# Chạy lại toàn bộ ca U4 trên lane sạch: dựng lại lane (DB chép từ mẫu, có web), chạy 00 → 50 theo thứ tự, dựng bảng báo cáo.
# Lane để nguyên sau khi chạy để soi DB; tắt bằng: bash ../../../tools/uat-harness/lane-down.sh <lane>
# Dùng: bash run-all.sh [lane]   (mặc định 4)
set -u
export PATH="$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
H="$HERE/../../../tools/uat-harness"
LANE="${1:-4}"

# Các trần theo ngày (thưởng đăng bài, lượt quay, điểm danh, trần món/ngày) tính theo ngày giờ Việt Nam: chạy vắt qua nửa đêm
# thì nửa sau thấy trần mới và ca sai. Dừng nếu còn dưới 15 phút tới 00:00.
now_min=$((10#$(TZ=Asia/Ho_Chi_Minh date +%H) * 60 + 10#$(TZ=Asia/Ho_Chi_Minh date +%M)))
if [ "$now_min" -ge $((23 * 60 + 45)) ]; then
  echo "Còn dưới 15 phút tới nửa đêm giờ Việt Nam, chạy lại sau 00:00." >&2
  exit 2
fi

load=$(sysctl -n vm.loadavg | awk '{print int($2)}')
if [ "$load" -gt 40 ]; then
  echo "Tải máy $load > 40, đợi tải giảm rồi chạy lại." >&2
  exit 3
fi

bash "$H/lane-down.sh" "$LANE"
bash "$H/lane-up.sh" "$LANE" --fresh --web || exit 1
rm -f "$HERE"/results/*.json
for s in 00-setup 10-recycle-customer 20-recycle-desk 30-community 40-game 50-notifications; do
  node "$HERE/$s.mjs" "$LANE" || echo "$s thoát mã $?" >&2
done
node "$HERE/report.mjs"
