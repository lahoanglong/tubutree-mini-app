/**
 * Đối soát số dư Điểm Xanh với sổ cái PointsTransaction, từng lô (PD-3).
 *
 * Vì sao cần: migration 20260623010000_loyalty_credit_unique dedupe các dòng ORDER_DELIVERED
 * trùng (bug double-credit) NHƯNG không tự hoàn lại pointsBalance đã cộng dư. Script này tìm
 * và (tuỳ chọn) sửa mọi user có số dư lệch khỏi SUM(delta) của lô tương ứng — xem giải thích bất
 * biến trong src/modules/loyalty/points-reconcile.ts.
 *
 * Dùng:
 *   pnpm --filter @tubutree/api reconcile:points           # DRY-RUN: chỉ báo cáo, KHÔNG sửa
 *   pnpm --filter @tubutree/api reconcile:points -- --apply # SỬA lô STANDARD: pointsBalance = SUM(delta)
 *
 * Lô CONVERTED (điểm quy từ xu — tiền trả trước của khách) chỉ BÁO, không tự sửa kể cả với --apply:
 * lệch ở lô này nghĩa là có đường ghi sai lô hoặc thiếu dòng sổ, phải tra nguyên nhân trước khi chỉnh
 * tiền của khách (giống reconcile-wallet). Có lệch lô CONVERTED thì thoát mã 1.
 *
 * An toàn: --apply chạy 1 câu UPDATE atomic (set = subquery), không TOCTOU; idempotent
 * (chạy lại = no-op). Mặc định KHÔNG sửa gì để xem trước tác động.
 */
import { PrismaClient } from '@prisma/client';
import { diffPointsBalances, findPointsLotDrift } from '../src/modules/loyalty/points-reconcile';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  const report = diffPointsBalances(await findPointsLotDrift(prisma));

  console.log(`\n=== ĐỐI SOÁT Điểm Xanh theo lô ${apply ? '(APPLY — sẽ sửa lô STANDARD)' : '(DRY-RUN — chỉ xem)'} ===`);
  for (const lot of ['STANDARD', 'CONVERTED'] as const) {
    const t = report.byLot[lot];
    console.log(`Lô ${lot.padEnd(9)}: ${t.affectedCount} user lệch, chênh ròng ${t.totalDrift} điểm, tuyệt đối ${t.totalAbsDrift} điểm`);
  }
  console.log('(chênh âm = đang cộng dư cần thu hồi)\n');

  if (report.affectedCount === 0) {
    console.log('✅ Không có user nào lệch — không cần đối soát.');
    return;
  }

  for (const c of report.corrections.slice(0, 50)) {
    const sign = c.drift > 0 ? '+' : '';
    console.log(`  user=${c.userId}  lô=${c.lot}  ${c.from} → ${c.to}  (${sign}${c.drift})`);
  }
  if (report.corrections.length > 50) {
    console.log(`  … và ${report.corrections.length - 50} dòng khác`);
  }

  if (report.byLot.CONVERTED.affectedCount > 0) {
    console.error(
      `\n❌ ${report.byLot.CONVERTED.affectedCount} user lệch lô CONVERTED (điểm quy từ xu): KHÔNG tự sửa, cần tra nguyên nhân.`,
    );
    process.exitCode = 1;
  }

  if (!apply) {
    console.log('\n⚠️  DRY-RUN: chưa sửa gì. Chạy lại với "-- --apply" để sửa lô STANDARD.');
    return;
  }
  if (report.byLot.STANDARD.affectedCount === 0) return;

  // Sửa atomic: mỗi user đặt pointsBalance = Σdelta lô STANDARD hiện tại. Subquery tương quan phủ cả
  // user không có giao dịch (SUM rỗng → NULL → 0). WHERE chỉ chạm user lệch.
  const affected = await prisma.$executeRaw`
    UPDATE "users" u
    SET "pointsBalance" = COALESCE(
      (SELECT SUM("delta")::int FROM "points_transactions" pt WHERE pt."userId" = u.id AND pt."lot" = 'STANDARD'), 0)
    WHERE u."pointsBalance" <> COALESCE(
      (SELECT SUM("delta")::int FROM "points_transactions" pt WHERE pt."userId" = u.id AND pt."lot" = 'STANDARD'), 0)
  `;
  console.log(`\n✅ Đã đối soát ${affected} user. pointsBalance giờ khớp sổ lô STANDARD.`);
}

main()
  .catch((e) => {
    console.error('❌ Đối soát thất bại:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
