/**
 * Đối soát users.walletBalance (Ví Tubu, VND thật) với sổ cái wallet_transactions — C-060.
 *
 * Dùng:
 *   pnpm --filter @tubutree/api reconcile:wallet
 *
 * CHỈ BÁO CÁO, không sửa gì (xem lý do trong src/modules/wallet/wallet-reconcile.ts). Thoát mã 1
 * khi có user lệch để cron/giám sát cảnh báo được.
 */
import { PrismaClient } from '@prisma/client';
import { findWalletLedgerDrift } from '../src/modules/wallet/wallet-reconcile';

const prisma = new PrismaClient();

async function main() {
  const report = await findWalletLedgerDrift(prisma);

  console.log('\n=== ĐỐI SOÁT Ví Tubu vs sổ cái wallet_transactions ===');
  console.log(`User bị lệch   : ${report.affectedCount}`);
  console.log(`Chênh ròng     : ${report.totalDrift}đ (dương = ví nhiều hơn sổ ghi nhận)`);
  console.log(`Chênh tuyệt đối: ${report.totalAbsDrift}đ\n`);

  if (report.affectedCount === 0) {
    console.log('Không có user nào lệch.');
    return;
  }

  for (const d of report.drifts.slice(0, 50)) {
    const sign = d.drift > 0 ? '+' : '';
    console.log(`  user=${d.userId}  ví=${d.walletBalance}  sổ=${d.ledgerSum} (${d.entries} dòng)  lệch ${sign}${d.drift}`);
  }
  if (report.drifts.length > 50) console.log(`  … và ${report.drifts.length - 50} user khác`);
  console.log('\nTra nguyên nhân từng user trước khi điều chỉnh; điều chỉnh bằng dòng ADJUST qua applyWalletDelta.');
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('Đối soát thất bại:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
