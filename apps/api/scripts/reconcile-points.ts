/**
 * Đối soát pointsBalance với sổ cái PointsTransaction.
 *
 * Vì sao cần: migration 20260623010000_loyalty_credit_unique dedupe các dòng ORDER_DELIVERED
 * trùng (bug double-credit) NHƯNG không tự hoàn lại pointsBalance đã cộng dư. Script này tìm
 * và (tuỳ chọn) sửa mọi user có pointsBalance lệch khỏi SUM(delta) — xem giải thích bất biến
 * trong src/modules/loyalty/points-reconcile.ts.
 *
 * Dùng:
 *   pnpm --filter @tubutree/api reconcile:points           # DRY-RUN: chỉ báo cáo, KHÔNG sửa
 *   pnpm --filter @tubutree/api reconcile:points -- --apply # SỬA: đặt pointsBalance = SUM(delta)
 *
 * An toàn: --apply chạy 1 câu UPDATE atomic (set = subquery), không TOCTOU; idempotent
 * (chạy lại = no-op). Mặc định KHÔNG sửa gì để xem trước tác động.
 */
import { PrismaClient } from '@prisma/client';
import { diffPointsBalances, type BalanceRow } from '../src/modules/loyalty/points-reconcile';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  // Chỉ lấy user LỆCH (balance ≠ Σdelta). LEFT JOIN + COALESCE để phủ cả user chưa có giao dịch
  // nào (ledgerSum = 0) mà balance vẫn > 0.
  const rows = await prisma.$queryRaw<BalanceRow[]>`
    SELECT u.id AS "userId",
           u."pointsBalance" AS "pointsBalance",
           COALESCE(s.sum, 0) AS "ledgerSum"
    FROM "users" u
    LEFT JOIN (
      SELECT "userId", SUM("delta")::int AS sum
      FROM "points_transactions"
      GROUP BY "userId"
    ) s ON s."userId" = u.id
    WHERE u."pointsBalance" <> COALESCE(s.sum, 0)
    ORDER BY ABS(u."pointsBalance" - COALESCE(s.sum, 0)) DESC
  `;

  const report = diffPointsBalances(rows);

  console.log(`\n=== ĐỐI SOÁT pointsBalance ${apply ? '(APPLY — sẽ sửa)' : '(DRY-RUN — chỉ xem)'} ===`);
  console.log(`User bị lệch : ${report.affectedCount}`);
  console.log(`Chênh ròng   : ${report.totalDrift} điểm (âm = đang cộng dư cần thu hồi)`);
  console.log(`Chênh tuyệt đối: ${report.totalAbsDrift} điểm\n`);

  if (report.affectedCount === 0) {
    console.log('✅ Không có user nào lệch — không cần đối soát.');
    return;
  }

  for (const c of report.corrections.slice(0, 50)) {
    const sign = c.drift > 0 ? '+' : '';
    console.log(`  user=${c.userId}  ${c.from} → ${c.to}  (${sign}${c.drift})`);
  }
  if (report.corrections.length > 50) {
    console.log(`  … và ${report.corrections.length - 50} user khác`);
  }

  if (!apply) {
    console.log('\n⚠️  DRY-RUN: chưa sửa gì. Chạy lại với "-- --apply" để áp dụng.');
    return;
  }

  // Sửa atomic: mỗi user đặt pointsBalance = Σdelta hiện tại (đã đúng sau dedup). Subquery
  // tương quan phủ cả user không có giao dịch (SUM rỗng → NULL → 0). WHERE chỉ chạm user lệch.
  const affected = await prisma.$executeRaw`
    UPDATE "users" u
    SET "pointsBalance" = COALESCE(
      (SELECT SUM("delta")::int FROM "points_transactions" pt WHERE pt."userId" = u.id), 0)
    WHERE u."pointsBalance" <> COALESCE(
      (SELECT SUM("delta")::int FROM "points_transactions" pt WHERE pt."userId" = u.id), 0)
  `;
  console.log(`\n✅ Đã đối soát ${affected} user. pointsBalance giờ khớp sổ cái PointsTransaction.`);
}

main()
  .catch((e) => {
    console.error('❌ Đối soát thất bại:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
