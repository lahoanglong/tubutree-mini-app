#!/usr/bin/env bash
# Dọn thẻ :prev-<sha8> cũ của image api và web trên VPS, chỉ giữ KEEP_PREV bản gần nhất (mặc định 3) để quay lại.
# Mỗi deploy gắn thêm một cặp :prev-* (dep1-prepare.sh, runbook mục 5 bước 2); không dọn thì đĩa đầy dần.
#
#   bash tools/deploy/prune-prev-images.sh            # chỉ in kế hoạch, không xoá gì
#   bash tools/deploy/prune-prev-images.sh --dry-run  # như trên, nói rõ bằng cờ (thắng --apply nếu đưa cả hai)
#   bash tools/deploy/prune-prev-images.sh --apply    # xoá thật
#   bash tools/deploy/prune-prev-images.sh --keep=5   # giữ 5 bản thay vì 3 (cờ thắng biến KEEP_PREV)
#   KEEP_PREV=5 REPO_DIR=/opt/tubutree bash tools/deploy/prune-prev-images.sh --apply
#
# Chỉ động tới thẻ đúng dạng prev-<8 ký tự hex> của tubutree-api và tubutree-web. KHÔNG động tới :latest, :rollback hay thẻ khác.
# Luôn giữ ít nhất 3 bản (hạ dưới 3 phải đặt PRUNE_ALLOW_LOW_KEEP=1). Cặp image đang gắn :latest hoặc đang được container (chạy hay đã dừng)
# dùng KHÔNG bao giờ vào danh sách xoá: giữ thêm ngoài số bản đã chọn, vì Docker từ chối gỡ image đang dùng và kế hoạch sẽ nói sai.
# "Gần nhất" theo giờ commit của SHA trong thẻ (thứ tự deploy), không theo giờ build image: hai bản liền nhau có thể trùng giờ build.
# Cả hai image giữ cùng một bộ SHA, nên quay api và web về cùng một bản luôn được.
# "Bản" = một cặp image (id api + id web) khác nhau, không phải một thẻ: nhiều SHA cùng trỏ vào một cặp image (commit không đổi nội dung
# image, hoặc thẻ dán nhầm sau rollback) chỉ tính MỘT bản, để "giữ 3 bản" luôn là 3 image khác nhau. Thẻ phụ của bản được giữ ở lại (không tốn đĩa).
# `docker rmi <repo>:<thẻ>` chỉ gỡ thẻ khi image còn thẻ khác; gỡ thẻ cuối thì xoá image, và Docker từ chối nếu có container đang dùng.
set -euo pipefail

KEEP="${KEEP_PREV:-3}"
REPO_DIR="${REPO_DIR:-/opt/tubutree}"
MIN_KEEP=3
REPOS=(tubutree-api tubutree-web)
APPLY=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) DRY=1 ;;
    --keep=*) KEEP="${1#--keep=}" ;;
    --keep)
      [ $# -ge 2 ] || { echo "--keep cần một số" >&2; exit 2; }
      KEEP="$2"
      shift
      ;;
    *) echo "dùng: $0 [--dry-run | --apply] [--keep=N]" >&2; exit 2 ;;
  esac
  shift
done
# Dry-run luôn thắng: lệnh có cả hai cờ chỉ in kế hoạch.
[ "$DRY" = 1 ] && APPLY=0
case "$KEEP" in
  '' | *[!0-9]*) echo "số bản giữ (KEEP_PREV hoặc --keep) phải là số nguyên dương" >&2; exit 2 ;;
esac
[ "$KEEP" -ge 1 ] || { echo "số bản giữ phải >= 1: không giữ bản nào thì không quay lại được" >&2; exit 2; }
if [ "$KEEP" -lt "$MIN_KEEP" ] && [ "${PRUNE_ALLOW_LOW_KEEP:-0}" != 1 ]; then
  echo "số bản giữ $KEEP < $MIN_KEEP: không cho phép (cần đủ $MIN_KEEP bản để quay lại). Chỉ khi chủ chấp nhận: PRUNE_ALLOW_LOW_KEEP=1" >&2
  exit 2
fi

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
# id image theo `docker image inspect` (cùng nguồn với `.Image` của container, xem tag-prev-images.sh): rỗng nếu không đọc được.
inspect_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
# Image bị ghim: đang gắn :latest, hoặc là image của một container nào đó (docker ps -a: Docker cũng từ chối gỡ image của container đã dừng).
pinned_ids="$({
  inspect_id tubutree-api:latest
  inspect_id tubutree-web:latest
  docker ps -aq 2>/dev/null | while read -r c; do docker inspect -f '{{.Image}}' "$c" 2>/dev/null || true; done
} | grep . || true)"
is_pinned_id() { [ -n "$1" ] && grep -qxF -- "$1" <<<"$pinned_ids"; }
# Cặp bị ghim khi MỌI image có thật của cặp (api, web) đều bị ghim, và có ít nhất một image đọc được.
is_pinned_sha() {
  local a w
  a="$(inspect_id "tubutree-api:prev-$1")"
  w="$(inspect_id "tubutree-web:prev-$1")"
  [ -n "$a$w" ] || return 1
  { [ -z "$a" ] || is_pinned_id "$a"; } && { [ -z "$w" ] || is_pinned_id "$w"; }
}
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
  elif is_pinned_sha "$sha"; then
    kept_map="${kept_map}${key} ${sha}"$'\n'
    keep_lines="${keep_lines}  prev-${sha} (đang chạy hoặc gắn :latest, giữ thêm)"$'\n'
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
