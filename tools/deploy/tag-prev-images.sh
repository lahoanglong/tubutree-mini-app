#!/usr/bin/env bash
# Gắn thẻ :rollback và :prev-<nhãn> cho image api và web ĐANG CHẠY, trước khi build bản mới (dep1-prepare.sh, runbook mục 5 bước 2).
#
#   bash tools/deploy/tag-prev-images.sh <API_ID> <API_NAME> <WEB_ID> <WEB_NAME> <SHA_ĐÃ_GHI> [ID_IMAGE_API_ĐÃ_GHI]
#
#   SHA_ĐÃ_GHI          nội dung .last-deployed-sha (dep2 ghi sau mỗi lần deploy)
#   ID_IMAGE_API_ĐÃ_GHI nội dung .last-deployed-image (dep2 ghi cùng lúc: id image api vừa chạy); rỗng nếu chưa có
#
# Vì sao không dán thẳng :prev-<SHA_ĐÃ_GHI>: quay lại bản cũ (runbook 7.2, 7.3) KHÔNG cập nhật .last-deployed-sha, nên lần deploy kế tiếp
# image đang chạy là bản cũ mà SHA đã ghi là của bản vừa bị gỡ. Dán theo SHA đó thì thẻ trỏ sai image, và "3 bản dự phòng" thành 2 image khác nhau.
# Nhãn chọn theo thứ tự:
#   1. image đang chạy KHỚP image dep2 đã ghi (hoặc chưa có ghi chép): tin SHA đã ghi.
#   2. image khác ghi chép (đã quay lại): dùng lại thẻ :prev-<sha8> đã trỏ vào đúng image này (nhiều thẻ thì lấy commit cũ nhất); không có thẻ nào
#      thì nhãn là 8 ký tự hex đầu của id image api (không mượn SHA của bản bị gỡ).
# Không bao giờ ghi đè một thẻ :prev-<nhãn> đang trỏ image khác (api hoặc web): gặp thì rơi về nhãn theo id image.
# stdout: dòng "gắn thẻ ..." cho từng thẻ. Thoát 2 nếu thiếu tham số.
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "dùng: $0 <API_ID> <API_NAME> <WEB_ID> <WEB_NAME> <SHA_ĐÃ_GHI> [ID_IMAGE_API_ĐÃ_GHI]" >&2
  exit 2
fi
API_ID="$1"
API_NAME="$2"
WEB_ID="$3"
WEB_NAME="$4"
CUR_SHA="${5:-}"
LAST_IMAGE="${6:-}"
API_REPO="${API_NAME%%:*}"
WEB_REPO="${WEB_NAME%%:*}"
REPO_DIR="${REPO_DIR:-/opt/tubutree}"

is_label() { [[ "$1" =~ ^[0-9a-f]{8}$ ]]; }

tag_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }

# 0 nếu :prev-<nhãn> đã có ở api hoặc web mà trỏ image KHÁC image đang chạy.
conflicts() {
  local a w
  a="$(tag_id "$API_REPO:prev-$1")"
  w="$(tag_id "$WEB_REPO:prev-$1")"
  { [ -n "$a" ] && [ "$a" != "$API_ID" ]; } || { [ -n "$w" ] && [ "$w" != "$WEB_ID" ]; }
}

# Nhãn theo id image api: id đầy đủ có dạng sha256:<hex>.
id_label() {
  local hex="${API_ID#sha256:}"
  echo "${hex:0:8}"
}

# Thẻ :prev-<sha8> của api đang trỏ đúng image đang chạy (và thẻ web cùng nhãn, nếu có, cũng trỏ đúng image web), cũ nhất trước.
existing_labels() {
  local label epoch w
  docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' |
    awk -v r="$API_REPO" -v id="$API_ID" '$2==id && index($1, r ":prev-")==1 {print substr($1, length(r) + 7)}' |
    sort -u |
    while read -r label; do
      is_label "$label" || continue
      w="$(tag_id "$WEB_REPO:prev-$label")"
      if [ -n "$w" ] && [ "$w" != "$WEB_ID" ]; then continue; fi
      epoch="$(git -C "$REPO_DIR" show -s --format=%ct "${label}^{commit}" 2>/dev/null || true)"
      echo "${epoch:-9999999999} $label"
    done |
    sort -n | awk '{print $2}'
}

claimed="${CUR_SHA:0:8}"
is_label "$claimed" || claimed=""

label=""
if [ -z "$LAST_IMAGE" ] || [ "$LAST_IMAGE" = "$API_ID" ]; then
  label="$claimed"
else
  label="$(existing_labels | head -n 1)"
  if [ -z "$label" ]; then
    echo "image đang chạy khác image dep2 đã ghi và không còn thẻ :prev-* nào cho nó (đã quay lại bản cũ?): nhãn theo id image, không mượn SHA $claimed" >&2
  else
    echo "image đang chạy khác image dep2 đã ghi (đã quay lại bản cũ?): dùng lại thẻ :prev-$label" >&2
  fi
fi
[ -n "$label" ] || label="$(id_label)"
if conflicts "$label"; then
  echo "thẻ :prev-$label đang trỏ image khác: không ghi đè, nhãn theo id image" >&2
  label="$(id_label)"
fi

docker tag "$API_ID" "$API_REPO:rollback"
docker tag "$WEB_ID" "$WEB_REPO:rollback"
echo "gắn thẻ $API_REPO:rollback, $WEB_REPO:rollback"
if is_label "$label" && ! conflicts "$label"; then
  docker tag "$API_ID" "$API_REPO:prev-$label"
  docker tag "$WEB_ID" "$WEB_REPO:prev-$label"
  echo "gắn thẻ $API_REPO:prev-$label, $WEB_REPO:prev-$label"
else
  echo "CHÚ Ý: không chọn được nhãn :prev-* an toàn, chỉ gắn :rollback" >&2
fi
