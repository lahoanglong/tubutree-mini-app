#!/usr/bin/env bash
# Dọn thẻ :prev-<sha8> cũ của image api và web trên VPS, chỉ giữ KEEP_PREV bản gần nhất (mặc định 3) để quay lại.
# Mỗi deploy gắn thêm một cặp :prev-* (dep1-prepare.sh, runbook mục 5 bước 2); không dọn thì đĩa đầy dần.
#
#   bash tools/deploy/prune-prev-images.sh            # chỉ in kế hoạch, không xoá gì
#   bash tools/deploy/prune-prev-images.sh --apply    # xoá thật
#   KEEP_PREV=5 REPO_DIR=/opt/tubutree bash tools/deploy/prune-prev-images.sh --apply
#
# Chỉ động tới thẻ đúng dạng prev-<8 ký tự hex> của tubutree-api và tubutree-web. KHÔNG động tới :latest, :rollback hay thẻ khác.
# "Gần nhất" theo giờ commit của SHA trong thẻ (thứ tự deploy), không theo giờ build image: hai bản liền nhau có thể trùng giờ build.
# Cả hai image giữ cùng một bộ SHA, nên quay api và web về cùng một bản luôn được.
# "Bản" = một cặp image (id api + id web) khác nhau, không phải một thẻ: nhiều SHA cùng trỏ vào một cặp image (commit không đổi nội dung
# image, hoặc thẻ dán nhầm sau rollback) chỉ tính MỘT bản, để "giữ 3 bản" luôn là 3 image khác nhau. Thẻ phụ của bản được giữ ở lại (không tốn đĩa).
# `docker rmi <repo>:<thẻ>` chỉ gỡ thẻ khi image còn thẻ khác; gỡ thẻ cuối thì xoá image, và Docker từ chối nếu có container đang dùng.
set -euo pipefail

KEEP="${KEEP_PREV:-3}"
REPO_DIR="${REPO_DIR:-/opt/tubutree}"
REPOS=(tubutree-api tubutree-web)
APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  '') ;;
  *) echo "dùng: $0 [--apply]" >&2; exit 2 ;;
esac
case "$KEEP" in
  '' | *[!0-9]*) echo "KEEP_PREV phải là số nguyên dương" >&2; exit 2 ;;
esac
[ "$KEEP" -ge 1 ] || { echo "KEEP_PREV phải >= 1: không giữ bản nào thì không quay lại được" >&2; exit 2; }

# Giờ của một bản (epoch giây): giờ commit nếu SHA còn trong repo, không thì giờ build image.
deploy_epoch() {
  local sha="$1" t r
  if t="$(git -C "$REPO_DIR" show -s --format=%ct "${sha}^{commit}" 2>/dev/null)" && [ -n "$t" ]; then
    echo "$t"
    return
  fi
  for r in "${REPOS[@]}"; do
    if t="$(docker image inspect -f '{{.Created}}' "$r:prev-$sha" 2>/dev/null)"; then
      date -d "$t" +%s 2>/dev/null || echo 0
      return
    fi
  done
  echo 0
}

all_tags="$(docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}')"
listing="$({ grep -E '^tubutree-(api|web):prev-[0-9a-f]{8} ' <<<"$all_tags" || true; })"
if [ -z "$listing" ]; then
  echo "Không có thẻ :prev-* nào."
  exit 0
fi
shas="$(sed -E 's/^tubutree-(api|web):prev-([0-9a-f]{8}) .*$/\2/' <<<"$listing" | sort -u)"
image_id() { awk -v r="$1" '$1==r {print $2; exit}' <<<"$listing"; }
# Cặp image :rollback (bản vừa chạy, dep1 vừa gắn thẻ prev cho nó) luôn là bản giữ đầu tiên: nhãn theo id image không có commit, giờ build
# của image có thể cũ hơn mọi bản khác (api không đổi qua nhiều deploy), nên xếp theo giờ sẽ gỡ ngay thẻ vừa gắn.
rollback_key="$(awk '$1=="tubutree-api:rollback" {print $2; exit}' <<<"$all_tags")/$(awk '$1=="tubutree-web:rollback" {print $2; exit}' <<<"$all_tags")"
# Mỗi dòng: giờ-deploy sha khoá-bản (id api / id web); mới nhất trước, nên lần đầu gặp một khoá là bản mới nhất của cặp image đó.
rows="$(while read -r s; do
  key="$(image_id "tubutree-api:prev-$s")/$(image_id "tubutree-web:prev-$s")"
  epoch="$(deploy_epoch "$s")"
  if [ "$key" = "$rollback_key" ]; then epoch=9999999999; fi
  echo "$epoch $s $key"
done <<<"$shas" | sort -rn)"
keep_lines=""
kept_map=""
drop=""
kept=0
while read -r _ sha key; do
  first="$(awk -v k="$key" '$1==k {print $2; exit}' <<<"$kept_map")"
  if [ -n "$first" ]; then
    keep_lines="${keep_lines}  prev-${sha} (cùng image với prev-${first})"$'\n'
  elif [ "$kept" -lt "$KEEP" ]; then
    kept=$((kept + 1))
    kept_map="${kept_map}${key} ${sha}"$'\n'
    keep_lines="${keep_lines}  prev-${sha}"$'\n'
  else
    drop="${drop}${sha}"$'\n'
  fi
done <<<"$rows"
drop="${drop%$'\n'}"

echo "Giữ $KEEP bản gần nhất:"
printf '%s' "$keep_lines"
if [ -z "$drop" ]; then
  echo "Không có gì để xoá."
  exit 0
fi
echo "$([ "$APPLY" = 1 ] && echo Xoá || echo 'Sẽ xoá (chạy lại với --apply)'):"
removed=0
failed=0
while read -r sha; do
  for r in "${REPOS[@]}"; do
    ref="$r:prev-$sha"
    docker image inspect "$ref" >/dev/null 2>&1 || continue
    if [ "$APPLY" = 1 ]; then
      if docker rmi "$ref" >/dev/null 2>&1; then
        echo "  đã gỡ $ref"
        removed=$((removed + 1))
      else
        echo "  KHÔNG gỡ được $ref (container đang dùng?)" >&2
        failed=$((failed + 1))
      fi
    else
      echo "  $ref"
    fi
  done
done <<<"$drop"

if [ "$APPLY" = 1 ]; then
  echo "Đã gỡ $removed thẻ, lỗi $failed."
  docker system df
  df -h / | tail -1
fi
