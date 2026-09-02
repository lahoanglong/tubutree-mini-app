#!/usr/bin/env bash
# Tạo/xoá index CONCURRENTLY trên prod để KHÔNG khoá writes trên `orders`/`commissions`/
# `points_transactions` (bảng lớn, tăng dần theo đơn hàng).
# Phải chạy TRƯỚC khi `prisma migrate deploy` lần đầu apply
# migration 20260902010000_phase5_infra_indexes.
#
# Sau khi chạy xong → mark migration đã applied:
#   docker compose -f docker-compose.prod.yml exec api \
#     npx prisma migrate resolve --applied 20260902010000_phase5_infra_indexes
#
# CONCURRENTLY:
# - Không lấy SHARE lock → writes vẫn chạy.
# - KHÔNG được nằm trong transaction (vì sao Prisma migrate không dùng được).
# - Có thể fail giữa chừng → index ở trạng thái INVALID; chạy lại lệnh giống nhau là OK
#   (psql sẽ báo lỗi "already exists" — drop INVALID trước rồi rerun).
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-tubu}"
POSTGRES_DB="${POSTGRES_DB:-tubutree}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

run_sql() {
  local sql="$1"
  echo "→ $sql"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$sql"
}

run_sql 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt");'
run_sql 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "commissions_orderId_idx" ON "commissions"("orderId");'
run_sql 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "points_transactions_expiresAt_idx" ON "points_transactions"("expiresAt");'
run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "game_quiz_attempts_userId_idx";'

echo "✔ Done. Đừng quên: prisma migrate resolve --applied 20260902010000_phase5_infra_indexes"
