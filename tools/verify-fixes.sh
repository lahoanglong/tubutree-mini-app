#!/usr/bin/env bash
# Verify toàn bộ fix Wave A + B + C (2026-06-22).
# Chạy trên máy có Node 20+ và pnpm 9 đã cài.
#
# Mục đích: ép TS sạch + test xanh + migration khô (dry-run) trước khi deploy.
# Exit code:
#   0 = tất cả pass, sẵn sàng deploy
#   1 = pnpm/node không có
#   2 = install/generate fail
#   3 = typecheck fail
#   4 = test fail
#   5 = migration dry-run fail

set -uo pipefail
cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; NC=$'\033[0m'

step() { echo; echo "${BLUE}━━━ $1 ━━━${NC}"; }
ok()   { echo "${GREEN}✓ $1${NC}"; }
fail() { echo "${RED}✗ $1${NC}"; }

# ── 0. Prereq ──
step "0/5 Kiểm tra prereq"
command -v pnpm >/dev/null 2>&1 || { fail "pnpm không có trên PATH. Cài: 'npm i -g pnpm@9' hoặc dùng corepack."; exit 1; }
command -v node >/dev/null 2>&1 || { fail "node không có trên PATH."; exit 1; }
ok "node $(node --version) · pnpm $(pnpm --version)"

# ── 1. Install + generate Prisma ──
step "1/5 pnpm install + prisma generate"
pnpm install --frozen-lockfile 2>&1 | tail -20 || {
  echo "${YELLOW}frozen-lockfile fail (Wave A đã đổi package.json, lockfile chưa update) — thử install bình thường.${NC}"
  pnpm install 2>&1 | tail -20 || { fail "pnpm install fail"; exit 2; }
}
pnpm --filter @tubutree/api prisma:generate 2>&1 | tail -10 || { fail "prisma generate fail"; exit 2; }
ok "deps + prisma client sẵn sàng"

# ── 2. Typecheck toàn workspace ──
step "2/5 pnpm typecheck"
if pnpm typecheck 2>&1 | tee /tmp/tubutree-typecheck.log; then
  ok "TypeScript sạch"
else
  fail "Typecheck fail — xem /tmp/tubutree-typecheck.log"
  exit 3
fi

# ── 3. Test các module đã sửa ──
step "3/5 Test các module đã sửa (Wave A+B+C)"
TARGETS=(
  "coupons.service"      # A4 + B4
  "checkout.service"     # B4 + B5
  "orders.service"       # B1 + B5
  "loyalty.service"      # B2
  "admin.service"        # B3 + B5
  "game-quiz.service"    # C1
)
FAIL_TESTS=()
for t in "${TARGETS[@]}"; do
  # Dựa vào EXIT CODE của runner (0=pass), KHÔNG grep output: dưới `pipefail`, exit
  # non-zero của pnpm khi test fail làm pipeline `... | tee | grep` luôn non-zero →
  # `if` rơi vào else → báo "pass" nhầm. Ghi log riêng rồi xét $? trực tiếp.
  if pnpm --filter @tubutree/api test -- "$t" --silent >/tmp/tubutree-test-$t.log 2>&1; then
    ok "$t pass"
  else
    fail "$t có test fail"
    FAIL_TESTS+=("$t")
  fi
done
if [ ${#FAIL_TESTS[@]} -gt 0 ]; then
  fail "Test fail: ${FAIL_TESTS[*]} — xem /tmp/tubutree-test-*.log"
  exit 4
fi

# ── 4. Migration dry-run check ──
step "4/5 Migration coupon_atomic SQL syntax"
MIG="apps/api/prisma/migrations/20260622000000_coupon_atomic/migration.sql"
if [ ! -f "$MIG" ]; then
  fail "Migration không tồn tại: $MIG"
  exit 5
fi
# Kiểm syntax cơ bản (psql --syntax-check không có; dùng grep heuristic)
if grep -qE 'ADD COLUMN IF NOT EXISTS "usedCount"' "$MIG" && \
   grep -qE 'DELETE FROM "coupon_redemptions"' "$MIG" && \
   grep -qE 'ADD CONSTRAINT.*UNIQUE.*couponId.*orderId' "$MIG"; then
  ok "Migration có cả 3 bước (column, dedupe, unique)"
else
  fail "Migration thiếu bước; kiểm tay: $MIG"
  exit 5
fi

# ── 5. Lint check (best-effort, không fail script) ──
step "5/5 Lint (warning OK)"
pnpm --filter @tubutree/api lint 2>&1 | tail -20 || echo "${YELLOW}Lint có warning/error (không chặn script). Xem chi tiết ở trên.${NC}"

# ── Done ──
echo
echo "${GREEN}═══════════════════════════════════════════════════${NC}"
echo "${GREEN}✓ VERIFY PASS — sẵn sàng cho bước deploy${NC}"
echo "${GREEN}═══════════════════════════════════════════════════${NC}"
echo
echo "Bước kế tiếp:"
echo "  1. Set env prod: PANCAKE_WEBHOOK_SECRET (rotate), ACCESSTRADE_WEBHOOK_SECRET, CORS_ORIGINS"
echo "  2. Backup DB prod: docker compose exec postgres pg_dump -U tubu tubutree | gzip > backup_pre_b4_\$(date +%F).sql.gz"
echo "  3. Kiểm trùng trước migration: SELECT \"couponId\",\"orderId\",COUNT(*) FROM coupon_redemptions GROUP BY 1,2 HAVING COUNT(*)>1;"
echo "  4. Push main → workflow_run gate sẽ chờ CI xanh rồi deploy."
echo "  5. zmp deploy cho Mini App (xem DEPLOY_ZALO.md)."
