// apps/api/scripts/backfill-first-order-subtotal.ts
// Chạy 1 LẦN sau khi deploy bản đổi mốc thưởng đơn đầu sang tiền hàng (w10-02): xét lại thưởng đơn đầu cho đơn đã giao từ lúc bật cờ
// growth.referral_viral_enabled mà luật cũ (tổng trả) bỏ qua. Xem src/modules/referral/first-order-subtotal-backfill.ts.
// Mặc định CHẠY THỬ: chỉ in số đơn và id, không ghi gì. --apply mới cộng điểm, qua đúng đường thưởng thật (idempotent, giữ mọi luật).
// KHÔNG chạy trong CI/migrate deploy. Chạy lại an toàn.
// Usage: cd apps/api && npx tsx scripts/backfill-first-order-subtotal.ts [--apply] [--since=2026-11-19T16:13:49Z]
import { PrismaClient } from '@prisma/client';
import { backfillFirstOrderSubtotal, FIRST_ORDER_VIRAL_LIVE_AT } from '../src/modules/referral/first-order-subtotal-backfill';
import { readViralRules } from '../src/modules/referral/viral-config';
import { SystemConfigService } from '../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../src/modules/wallet/reward-points.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length);
  const since = sinceArg ? new Date(sinceArg) : FIRST_ORDER_VIRAL_LIVE_AT;
  if (Number.isNaN(since.getTime())) throw new Error(`--since không đọc được: ${sinceArg}`);
  const db = prisma as unknown as PrismaService;
  const config = new SystemConfigService(db);
  const rules = await readViralRules(config);
  const rewards = new RewardPointsService(db, config);
  console.log(`Thưởng đơn đầu: cờ ${rules.enabled ? 'BẬT' : 'TẮT'}, mốc tiền hàng ${rules.minOrder}đ, đơn giao từ ${since.toISOString()}.`);
  const res = await backfillFirstOrderSubtotal(
    { db: prisma, grant: (orderId) => rewards.grantReferralFirstOrderReward(orderId) },
    { since, minOrder: rules.minOrder, apply },
  );
  console.log(`${res.candidates.length} đơn tiền hàng đạt mốc mà tổng trả dưới mốc: ${res.candidates.join(', ') || '(không có)'}`);
  if (apply) console.log(`Kết quả: ${JSON.stringify(res.outcomes)}`);
  else console.log('Chạy thử, chưa ghi gì. Thêm --apply để xét thưởng.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
