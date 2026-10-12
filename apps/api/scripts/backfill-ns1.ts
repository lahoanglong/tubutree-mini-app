// apps/api/scripts/backfill-ns1.ts
// Chạy 1 LẦN sau khi áp migration retention_ns1_columns: điền NS-1 (ns1CohortSize/ns1RepeatCount) cho các
// retention_daily_snapshot cũ còn NULL. Chỉ ghi hai cột đó, không tính lại các số khác, không tạo dòng mới.
// KHÔNG chạy trong CI/migrate deploy. Chạy lại an toàn (chỉ đụng dòng còn NULL).
// Usage: cd apps/api && npx tsx scripts/backfill-ns1.ts
import { PrismaClient } from '@prisma/client';
import { AnalyticsAggregationService } from '../src/modules/analytics/analytics-aggregation.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

async function main() {
  const service = new AnalyticsAggregationService(prisma as unknown as PrismaService);
  const pending = await prisma.retentionDailySnapshot.findMany({
    where: { ns1CohortSize: null },
    select: { date: true },
    orderBy: { date: 'asc' },
  });
  console.log(`${pending.length} snapshot cần điền NS-1.`);
  let filled = 0;
  for (const { date } of pending) {
    const dateKey = date.toISOString().slice(0, 10);
    if (await service.backfillNs1(dateKey)) filled++;
  }
  console.log(`Đã điền NS-1 cho ${filled}/${pending.length} snapshot.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
