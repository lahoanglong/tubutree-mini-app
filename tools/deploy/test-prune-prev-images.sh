#!/usr/bin/env bash
# Chứng minh prune-prev-images.sh không bao giờ gỡ nhầm :latest, :rollback, image đang chạy hay 3 bản prev-* gần nhất.
# Không cần Docker thật: `docker` giả đọc danh sách image từ file, `rmi` chỉ ghi lại lệnh và bỏ dòng khỏi file. Repo git thật trong thư mục tạm,
# mỗi commit có giờ riêng nên thứ tự deploy khác thứ tự chữ cái của SHA. Chạy được trên macOS (bash 3.2) và Linux.
#   bash tools/deploy/test-prune-prev-images.sh [đường-dẫn-prune-prev-images.sh]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prune-prev-images.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: mong '$3', thực tế '$2'"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1: thiếu '$3'"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then fail "$1: không được có '$3'"; else pass "$1"; fi; }

cat > "$WORK/docker" <<'STUB'
#!/usr/bin/env bash
# Tệp trạng thái do test đặt: IMAGES (repo:tag giờ-build id), CONTAINERS (id-container id-image), CALLS (nhật ký), FAIL_RMI (tham chiếu rmi cố ý lỗi).
echo "docker $*" >> "$CALLS"
case "$1" in
  images) awk '{print $1" "$3}' "$IMAGES" ;;
  image)
    ref="${@: -1}"
    line="$(grep -F "$ref " "$IMAGES" | head -n1)"
    [ -n "$line" ] || exit 1
    case "$*" in
      *Created*) echo "$line" | awk '{print $2}' ;;
      *'.Id'*) echo "$line" | awk '{print $3}' ;;
    esac
    ;;
  ps) awk '{print $1}' "$CONTAINERS" ;;
  inspect) awk -v c="${@: -1}" '$1==c {print $2}' "$CONTAINERS" ;;
  rmi)
    if [ -n "${FAIL_RMI:-}" ] && [ "$2" = "$FAIL_RMI" ]; then exit 1; fi
    grep -vF "$2 " "$IMAGES" > "$IMAGES.new" || true
    mv "$IMAGES.new" "$IMAGES"
    ;;
  system) echo "TYPE TOTAL" ;;
esac
exit 0
STUB
chmod +x "$WORK/docker"

T0=1800000000
# setup <tên-kịch-bản>: tạo thư mục riêng, repo git rỗng, tệp trạng thái rỗng. Đặt biến D (thư mục) cho các bước sau.
setup() {
  D="$WORK/$1"
  rm -rf "$D"
  mkdir -p "$D/repo"
  : > "$D/images.txt"
  : > "$D/containers.txt"
  : > "$D/calls.log"
  ( cd "$D/repo" && git init -q )
}
# commit <sha8> <giờ>: commit rỗng ở giờ đó, đặt thẻ git tên sha8 (script chỉ cần `git show <sha8>^{commit}`).
commit() {
  local when="$2 +0000"
  ( cd "$D/repo" && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
      GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -q --allow-empty -m "$1" && git tag "$1" )
}
# add_pair <sha8> <giờ commit> [id-api] [id-web]: cặp prev-<sha8> của api và web (id mặc định riêng cho từng sha).
add_pair() {
  local sha="$1" api="${3:-sha256:api-$1}" web="${4:-sha256:web-$1}"
  commit "$sha" "$2"
  echo "tubutree-api:prev-$sha 2020-01-01T00:00:00Z $api" >> "$D/images.txt"
  echo "tubutree-web:prev-$sha 2020-01-01T00:00:00Z $web" >> "$D/images.txt"
}
add_fixed() {
  {
    echo "tubutree-api:latest 2026-11-07T00:00:00Z sha256:api-latest"
    echo "tubutree-web:latest 2026-11-07T00:00:00Z sha256:web-latest"
    echo "tubutree-api:rollback 2026-11-06T00:00:00Z sha256:api-rollback"
    echo "tubutree-web:rollback 2026-11-06T00:00:00Z sha256:web-rollback"
    echo "postgres:16 2024-01-01T00:00:00Z sha256:pg"
  } >> "$D/images.txt"
}
# run_prune [tham số...]: đặt OUT, RC, RMI (mỗi lệnh gỡ một dòng), REMAIN (các thẻ còn lại, xếp thứ tự). PRUNE_ENV = "BIẾN=giá-trị ..." thêm cho lần chạy.
PRUNE_ENV=""
run_prune() {
  # shellcheck disable=SC2086 # tách từ có chủ ý: PRUNE_ENV là danh sách BIẾN=giá-trị
  OUT="$(env PATH="$WORK:$PATH" HOME="$D" REPO_DIR="$D/repo" IMAGES="$D/images.txt" CONTAINERS="$D/containers.txt" CALLS="$D/calls.log" FAIL_RMI="${FAIL_RMI:-}" \
    $PRUNE_ENV bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  RMI="$(grep '^docker rmi ' "$D/calls.log" | sed 's/^docker rmi //' | sort)"
  REMAIN="$(awk '{print $1}' "$D/images.txt" | sort)"
}

# Bộ chuẩn: 6 cặp prev, c1 cũ nhất ... c6 mới nhất; 3 mới nhất = c6 c5 c4.
standard() {
  setup "$1"
  add_fixed
  add_pair c1c1c1c1 $((T0 + 100))
  add_pair c2c2c2c2 $((T0 + 200))
  add_pair c3c3c3c3 $((T0 + 300))
  add_pair c4c4c4c4 $((T0 + 400))
  add_pair c5c5c5c5 $((T0 + 500))
  add_pair c6c6c6c6 $((T0 + 600))
}
OLD="tubutree-api:prev-c1c1c1c1
tubutree-api:prev-c2c2c2c2
tubutree-api:prev-c3c3c3c3
tubutree-web:prev-c1c1c1c1
tubutree-web:prev-c2c2c2c2
tubutree-web:prev-c3c3c3c3"

echo "--- 1. mặc định (không cờ): chỉ in kế hoạch, không gọi docker rmi"
standard s1; PRUNE_ENV=""; run_prune
check "thoát 0" "$RC" 0
check "không gỡ gì" "$RMI" ""
contains "nêu số bản giữ" "$OUT" "Giữ 3 bản gần nhất:"
contains "kế hoạch có bản cũ" "$OUT" "tubutree-api:prev-c1c1c1c1"
lacks "kế hoạch không có bản mới" "$OUT" "tubutree-api:prev-c6c6c6c6"
check "mọi thẻ còn nguyên" "$(wc -l < "$D/images.txt" | tr -d ' ')" 17

echo "--- 2. --dry-run, và --apply --dry-run (dry-run thắng): không gỡ gì"
standard s2; run_prune --dry-run
check "--dry-run thoát 0" "$RC" 0
check "--dry-run không gỡ" "$RMI" ""
standard s2b; run_prune --apply --dry-run
check "--apply --dry-run không gỡ" "$RMI" ""
standard s2c; run_prune --dry-run --apply
check "--dry-run --apply (đảo thứ tự) không gỡ" "$RMI" ""

echo "--- 3. --apply: gỡ đúng bản cũ, :latest/:rollback/thẻ khác và 3 bản mới nhất còn nguyên"
standard s3; run_prune --apply
check "thoát 0" "$RC" 0
check "gỡ đúng 3 cặp cũ" "$RMI" "$OLD"
for ref in tubutree-api:latest tubutree-web:latest tubutree-api:rollback tubutree-web:rollback postgres:16 \
  tubutree-api:prev-c4c4c4c4 tubutree-web:prev-c4c4c4c4 tubutree-api:prev-c5c5c5c5 tubutree-web:prev-c5c5c5c5 tubutree-api:prev-c6c6c6c6 tubutree-web:prev-c6c6c6c6; do
  contains "còn $ref" "$REMAIN" "$ref"
done

echo "--- 4. --keep=N và --keep N đổi số bản giữ; cờ thắng biến KEEP_PREV"
standard s4; run_prune --apply --keep=4
check "--keep=4 gỡ 2 cặp" "$(grep -c . <<<"$RMI")" 4
lacks "--keep=4 giữ c3" "$RMI" "prev-c3c3c3c3"
standard s4b; run_prune --apply --keep 5
check "--keep 5 gỡ 1 cặp" "$(grep -c . <<<"$RMI")" 2
standard s4c; PRUNE_ENV="KEEP_PREV=5" run_prune --apply --keep=3
check "--keep=3 thắng KEEP_PREV=5 (gỡ 3 cặp)" "$(grep -c . <<<"$RMI")" 6
PRUNE_ENV=""

echo "--- 5. giữ dưới 3 bản bị từ chối (trừ khi PRUNE_ALLOW_LOW_KEEP=1); giá trị sai → thoát 2"
standard s5; run_prune --apply --keep=2
check "--keep=2 thoát 2" "$RC" 2
check "--keep=2 không gỡ" "$RMI" ""
standard s5b; PRUNE_ENV="KEEP_PREV=1" run_prune --apply
check "KEEP_PREV=1 thoát 2" "$RC" 2
check "KEEP_PREV=1 không gỡ" "$RMI" ""
standard s5c; PRUNE_ENV="PRUNE_ALLOW_LOW_KEEP=1" run_prune --apply --keep=2
check "PRUNE_ALLOW_LOW_KEEP=1 cho --keep=2" "$RC" 0
check "--keep=2 gỡ 4 cặp" "$(grep -c . <<<"$RMI")" 8
PRUNE_ENV=""
for bad in --keep=0 --keep=abc --keep=-1 --keep= --force --bogus; do
  standard s5d; run_prune --apply "$bad"
  check "$bad thoát 2" "$RC" 2
  check "$bad không gỡ" "$RMI" ""
done
standard s5e; run_prune --apply --keep
check "--keep thiếu giá trị thoát 2" "$RC" 2

echo "--- 6. image đang chạy: cặp cũ có container dùng KHÔNG bị gỡ, giữ thêm ngoài số bản"
standard s6
echo "cont1 sha256:api-c2c2c2c2" >> "$D/containers.txt"
echo "cont2 sha256:web-c2c2c2c2" >> "$D/containers.txt"
run_prune --apply
check "thoát 0" "$RC" 0
lacks "không gỡ api c2 đang chạy" "$RMI" "tubutree-api:prev-c2c2c2c2"
lacks "không gỡ web c2 đang chạy" "$RMI" "tubutree-web:prev-c2c2c2c2"
contains "vẫn gỡ c1" "$RMI" "tubutree-api:prev-c1c1c1c1"
contains "vẫn gỡ c3" "$RMI" "tubutree-web:prev-c3c3c3c3"
contains "kế hoạch nói rõ giữ thêm" "$OUT" "prev-c2c2c2c2 (đang chạy hoặc gắn :latest, giữ thêm)"
contains "giữ 3 bản mới nhất" "$REMAIN" "tubutree-web:prev-c6c6c6c6"

echo "--- 6b. container đã dừng cũng ghim image (docker ps -a): không gỡ"
standard s6b
echo "stopped1 sha256:api-c1c1c1c1" >> "$D/containers.txt"
echo "stopped2 sha256:web-c1c1c1c1" >> "$D/containers.txt"
run_prune --apply
lacks "không gỡ c1 có container" "$RMI" "prev-c1c1c1c1"
contains "calls dùng docker ps -aq" "$(cat "$D/calls.log")" "docker ps -aq"

echo "--- 6c. chỉ một nửa cặp bị ghim thì cặp vẫn được dọn (nửa còn lại không dùng)"
standard s6c
echo "cont1 sha256:api-c2c2c2c2" >> "$D/containers.txt"
run_prune --apply
contains "gỡ web c2" "$RMI" "tubutree-web:prev-c2c2c2c2"
contains "gỡ api c2 (chỉ bỏ thẻ, Docker giữ image đang chạy)" "$RMI" "tubutree-api:prev-c2c2c2c2"

echo "--- 7. image đang gắn :latest: cặp cũ trùng id với :latest không bị gỡ"
standard s7
# c2 trỏ đúng image đang là :latest (vd quay lại bản cũ rồi gắn lại)
sed -i.bak 's#^tubutree-api:prev-c2c2c2c2 \(.*\) sha256:api-c2c2c2c2$#tubutree-api:prev-c2c2c2c2 \1 sha256:api-latest#; s#^tubutree-web:prev-c2c2c2c2 \(.*\) sha256:web-c2c2c2c2$#tubutree-web:prev-c2c2c2c2 \1 sha256:web-latest#' "$D/images.txt"
run_prune --apply
lacks "không gỡ c2 trùng :latest" "$RMI" "prev-c2c2c2c2"
contains "kế hoạch nói rõ giữ thêm" "$OUT" "prev-c2c2c2c2 (đang chạy hoặc gắn :latest, giữ thêm)"
contains "gỡ c1" "$RMI" "prev-c1c1c1c1"

echo "--- 8. không đọc được id (container có id image rỗng): không ghim nhầm, hành vi như cũ"
standard s8
echo "cont1 " >> "$D/containers.txt"
run_prune --apply
check "gỡ đúng 3 cặp cũ" "$RMI" "$OLD"

echo "--- 9. thẻ lỗi khi gỡ: báo, không dừng, thoát 0"
standard s9; FAIL_RMI="tubutree-api:prev-c1c1c1c1" run_prune --apply
check "thoát 0" "$RC" 0
contains "báo lỗi" "$OUT" "KHÔNG gỡ được tubutree-api:prev-c1c1c1c1"
contains "vẫn gỡ thẻ khác" "$RMI" "tubutree-web:prev-c3c3c3c3"
FAIL_RMI=""

echo "--- 10. bất biến trên nhiều bố cục: thẻ không phải prev-<hex>, :latest, :rollback, 3 bản mới nhất, image đang chạy không bao giờ bị gỡ"
for n in 4 5 7 9 12; do
  setup "inv$n"
  add_fixed
  echo "tubutree-api:prev-notahex1 2020-01-01T00:00:00Z sha256:x1" >> "$D/images.txt"
  echo "other-api:prev-abcdef12 2020-01-01T00:00:00Z sha256:x2" >> "$D/images.txt"
  i=1
  while [ "$i" -le "$n" ]; do
    sha="$(printf '%02x%02x%02x%02x' "$i" "$i" "$i" "$i")"
    add_pair "$sha" $((T0 + i * 100))
    i=$((i + 1))
  done
  if [ "$n" -ge 5 ]; then
    echo "c sha256:api-02020202" >> "$D/containers.txt"
    echo "c sha256:web-02020202" >> "$D/containers.txt"
  fi
  run_prune --apply
  check "n=$n thoát 0" "$RC" 0
  bad=""
  for ref in tubutree-api:latest tubutree-web:latest tubutree-api:rollback tubutree-web:rollback tubutree-api:prev-notahex1 other-api:prev-abcdef12 postgres:16; do
    grep -qxF "$ref" <<<"$REMAIN" || bad="$bad $ref"
  done
  top=0
  j=$n
  while [ "$j" -gt 0 ] && [ "$top" -lt 3 ]; do
    sha="$(printf '%02x%02x%02x%02x' "$j" "$j" "$j" "$j")"
    for r in tubutree-api tubutree-web; do grep -qxF "$r:prev-$sha" <<<"$REMAIN" || bad="$bad $r:prev-$sha"; done
    j=$((j - 1))
    top=$((top + 1))
  done
  if [ "$n" -ge 5 ]; then
    for r in tubutree-api tubutree-web; do grep -qxF "$r:prev-02020202" <<<"$REMAIN" || bad="$bad $r:prev-02020202(đang chạy)"; done
  fi
  check "n=$n không gỡ nhầm" "$bad" ""
done

exit "$FAILED"
