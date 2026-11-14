#!/usr/bin/env bash
# Kiểm và (khi được yêu cầu rõ) đưa bản Mini App (ZMP) lên kênh TEST của Zalo. Không bao giờ nộp bản production: việc đó làm tay trên trang quản lý Mini App của Zalo.
#
#   bash scripts/ops/publish-zmp-release.sh                      # chỉ kiểm: API khoẻ, build production, ngân sách bundle, zmp CLI + đăng nhập. KHÔNG đẩy gì lên Zalo.
#   bash scripts/ops/publish-zmp-release.sh --testing "<mô tả>"  # như trên, rồi `zmp deploy -t -e -m "<mô tả>"` ở apps/miniapp (kênh test). Chỉ cờ --testing mới gọi zmp deploy.
#   bash scripts/ops/publish-zmp-release.sh --help
#
# Các bước, dừng ở bước đầu tiên lỗi:
#   1. GET https://api.tubutree.com/api/health phải trả 200 và có "db":"up" + "redis":"up" (thứ tự bắt buộc: API ổn trước, Mini App sau; docs/launch/deploy-rollback-runbook.md).
#   2. (chỉ với --testing) có zmp CLI và đã đăng nhập (ZMP_TOKEN trong môi trường, hoặc dòng ZMP_TOKEN=... ở apps/miniapp/.env, hoặc ~/.zmp), để khỏi build xong mới biết thiếu.
#   3. Node >= 22; pnpm --filter @tubutree/shared-types build; typecheck; test; VITE_API_BASE_URL=https://api.tubutree.com/api ... build; bundle-budget.cjs ở chế độ strict
#      (vượt ngưỡng cảnh báo của dự án thì dừng; đặt MINIAPP_ENTRY_WARN_KB / MINIAPP_TOTAL_WARN_KB nếu chủ chấp nhận bản lớn hơn). apps/miniapp/www nằm trong .gitignore, không commit.
#   4. Không có zmp hoặc chưa đăng nhập: in hướng dẫn 2 dòng rồi thoát 3 (bản build vẫn đã kiểm xong).
#   5. (chỉ với --testing) zmp deploy -t -e -m "<mô tả>".
# Giá trị ZMP_TOKEN và nội dung ~/.zmp KHÔNG BAO GIỜ được in.
# Mã thoát: 0 mọi thứ xong (kiểm xong; hoặc đã đẩy lên test nếu có --testing), 1 một bước kiểm lỗi, 2 sai tham số, 3 thiếu zmp CLI hoặc chưa đăng nhập.
#
# Biến môi trường, chủ yếu để diễn tập/kiểm thử: API_HEALTH_URL (https://api.tubutree.com/api/health), ZMP_HOME (~/.zmp), CURL_TIMEOUT (15).
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
API_BASE_URL="https://api.tubutree.com/api"
API_HEALTH_URL="${API_HEALTH_URL:-$API_BASE_URL/health}"
ZMP_HOME="${ZMP_HOME:-${HOME:-/root}/.zmp}"
ZMP_ENV_FILE="$REPO_ROOT/apps/miniapp/.env"
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"

usage() { sed -n '2,/^set -u/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

TESTING=0
MESSAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --testing)
      TESTING=1
      if [ $# -lt 2 ] || [ -z "$2" ] || [ "${2#--}" != "$2" ]; then
        echo "--testing cần mô tả phiên bản đi sau, ví dụ: --testing \"W153-W157 sync cart, cancel refund, zero-price & variation labels\"" >&2
        exit 2
      fi
      MESSAGE="$2"
      shift
      ;;
    *) echo "Tham số lạ: $1 (xem --help)" >&2; exit 2 ;;
  esac
  shift
done
case "$CURL_TIMEOUT" in '' | *[!0-9]*) echo "CURL_TIMEOUT phải là số nguyên không âm" >&2; exit 2 ;; esac

TOTAL=$((5 + TESTING))
STEP=0
say() { printf '== %s\n' "$*"; }
fail() { printf 'DỪNG: %s\n' "$*" >&2; exit 1; }

# ── 1. API phải khoẻ ──
check_api_health() {
  local body_file code body
  body_file="$(mktemp)"
  code="$(curl -s -o "$body_file" -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$API_HEALTH_URL" 2>/dev/null || true)"
  body="$(cat "$body_file" 2>/dev/null)"
  rm -f "$body_file"
  [ "$code" = 200 ] || fail "$API_HEALTH_URL trả '${code:-không kết nối được}' (cần 200). Đừng phát hành Mini App khi API chưa ổn."
  case "$body" in *'"db":"up"'*) ;; *) fail "health trả 200 nhưng thiếu \"db\":\"up\": $(printf '%s' "$body" | cut -c1-200)" ;; esac
  case "$body" in *'"redis":"up"'*) ;; *) fail "health trả 200 nhưng thiếu \"redis\":\"up\": $(printf '%s' "$body" | cut -c1-200)" ;; esac
  say "API khoẻ: $API_HEALTH_URL → 200, db up, redis up"
}

# ── zmp CLI + đăng nhập: đặt ZMP_CMD và ZMP_REASON (gọi trực tiếp, không qua $(...), để biến còn ở shell này). Không bao giờ in giá trị token. ──
ZMP_CMD=()
ZMP_REASON=""
zmp_status() { # trả 0 khi đủ CLI và phiên đăng nhập
  ZMP_CMD=()
  ZMP_REASON=""
  if command -v zmp >/dev/null 2>&1; then
    ZMP_CMD=(zmp)
  elif command -v npx >/dev/null 2>&1 && (cd "$REPO_ROOT/apps/miniapp" && npx --no-install zmp --version >/dev/null 2>&1); then
    ZMP_CMD=(npx --no-install zmp)
  else
    ZMP_REASON="chưa cài zmp CLI"
    return 1
  fi
  # zmp đọc ZMP_TOKEN từ môi trường hoặc từ .env ở thư mục nó chạy (apps/miniapp, nơi `zmp login` ghi); grep -q để không bao giờ in giá trị.
  if [ -n "${ZMP_TOKEN:-}" ] || [ -e "$ZMP_HOME" ]; then return 0; fi
  if [ -f "$ZMP_ENV_FILE" ] && grep -q '^ZMP_TOKEN=.' "$ZMP_ENV_FILE" 2>/dev/null; then return 0; fi
  ZMP_REASON="chưa đăng nhập zmp (không có ZMP_TOKEN trong môi trường hay $ZMP_ENV_FILE, không có $ZMP_HOME)"
  return 1
}

print_zmp_help() { # $1 = dòng mở đầu (build đã xong hay chưa chạy)
  echo "$1 CHƯA thể đưa lên Zalo: $ZMP_REASON" >&2
  echo "  1) Chạy một lần mỗi máy:  cd apps/miniapp && zmp login   (cài zmp CLI nếu chưa có: npm i -g zmp-cli; token lưu ở apps/miniapp/.env, đã nằm trong .gitignore)" >&2
  echo "  2) Rồi chạy lại:          bash scripts/ops/publish-zmp-release.sh --testing \"W153-W157 sync cart, cancel refund, zero-price & variation labels\"" >&2
}

# ── 3. build + ngân sách bundle ──
run_step() { # nhãn lệnh...
  local label="$1"
  shift
  STEP=$((STEP + 1))
  say "[$STEP/$TOTAL] $label"
  (cd "$REPO_ROOT" && "$@") || fail "bước '$label' lỗi (mã $?)"
}

node_ok() { node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; }

check_api_health

if [ "$TESTING" = 1 ] && ! zmp_status; then
  print_zmp_help "Chưa build gì (kiểm zmp trước để khỏi mất thời gian)."
  exit 3
fi

node_ok || fail "cần Node >= 22 (đang $(node -v 2>/dev/null || echo 'không có node')). Đặt: export PATH=\$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:\$PATH"
run_step "shared-types build" pnpm --filter @tubutree/shared-types build
run_step "miniapp typecheck" pnpm --filter @tubutree/miniapp typecheck
run_step "miniapp test" pnpm --filter @tubutree/miniapp test
run_step "miniapp build (VITE_API_BASE_URL=$API_BASE_URL)" env VITE_API_BASE_URL="$API_BASE_URL" pnpm --filter @tubutree/miniapp build
run_step "bundle-budget (strict)" env BUNDLE_BUDGET_STRICT=1 node scripts/ci/bundle-budget.cjs apps/miniapp/www

if [ "$TESTING" != 1 ]; then
  say "Kiểm xong, KHÔNG đẩy gì lên Zalo (không có --testing)."
  if zmp_status; then
    echo "zmp CLI và phiên đăng nhập đã sẵn sàng. Để đẩy lên kênh test: bash scripts/ops/publish-zmp-release.sh --testing \"<mô tả phiên bản>\""
    exit 0
  fi
  print_zmp_help "Bản build đã kiểm xong nhưng"
  exit 3
fi

say "[$TOTAL/$TOTAL] zmp deploy -t -e -m \"$MESSAGE\" (kênh TEST, ở apps/miniapp)"
(cd "$REPO_ROOT/apps/miniapp" && "${ZMP_CMD[@]}" deploy -t -e -m "$MESSAGE") || fail "zmp deploy lỗi (mã $?)"
say "Đã đẩy lên kênh test. Việc còn lại là của người: quét QR kiểm trên Zalo thật (docs/launch/zmp-miniapp-release.md mục 4), rồi gửi duyệt/phát hành production TAY trên trang quản lý Mini App."
