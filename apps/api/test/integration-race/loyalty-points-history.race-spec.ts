import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { createUser, warmPool } from './helpers';

/** Lịch sử điểm phân trang theo (createdAt, id): trên Postgres thật, ba trang không trùng, không sót, kể cả các dòng cùng createdAt. */
describe('LoyaltyService.getPointsTransactions phân trang (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('250 dòng (nhiều dòng cùng mili giây, có dấu ORDER_REVERSED 0 bị ẩn): trang 100/100/50 khớp danh sách đầy đủ, không trùng không sót', async () => {
    const user = await createUser(prisma, { pointsBalance: 0 });
    const base = Date.UTC(2026, 0, 1);
    const data = Array.from({ length: 250 }, (_, i) => ({
      userId: user.id,
      delta: 1,
      reason: `IT_HISTORY:${i}`,
      // Cứ 5 dòng chung một createdAt: ép phân định bằng id.
      createdAt: new Date(base + Math.floor(i / 5) * 1000),
    }));
    data.push({ userId: user.id, delta: 0, reason: 'ORDER_REVERSED:IT', createdAt: new Date(base + 500) });
    await prisma.pointsTransaction.createMany({ data });

    const all = await prisma.pointsTransaction.findMany({
      where: { userId: user.id, NOT: { delta: 0, reason: { startsWith: 'ORDER_REVERSED:' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(all).toHaveLength(250);

    const seen: string[] = [];
    let page = await loyalty.getPointsTransactions(user.id, { limit: 100 });
    const sizes: number[] = [];
    while (page.length > 0) {
      sizes.push(page.length);
      seen.push(...page.map((r) => r.id));
      const last = page[page.length - 1]!;
      page = await loyalty.getPointsTransactions(user.id, { before: last.createdAt, beforeId: last.id, limit: 100 });
    }
    expect(sizes).toEqual([100, 100, 50]);
    expect(seen).toEqual(all.map((r) => r.id));
    expect(new Set(seen).size).toBe(250);
    expect(await loyalty.getPointsTransactions(user.id)).toHaveLength(100);
  });
});
