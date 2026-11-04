import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { randCode } from './helpers';

type Captured = { query: string };

/**
 * Trên Postgres THẬT: tìm ứng viên hết hạn bằng SELECT DISTINCT ... LIMIT trả đúng tập user và đúng thứ tự trang
 * như cách cũ (`findMany({ distinct, orderBy })` rồi cắt trang ở bộ nhớ), và LIMIT thật sự nằm trong câu SQL.
 */
describe('LoyaltyExpiryService: ứng viên hết hạn phân trang bằng SQL (real Postgres)', () => {
  const USERS = 1_300; // > BATCH (500) để có nhiều trang
  const prefix = `itcd${randCode(6).toLowerCase()}`;
  const now = new Date('2026-07-05T01:00:00.000Z');
  const floor = new Date('2026-06-15T00:00:00.000Z');
  let prisma: PrismaClient;
  let svc: LoyaltyExpiryService;
  let captured: Captured[] = [];
  let expected: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    (prisma as unknown as { $on: (e: 'query', cb: (q: Captured) => void) => void }).$on('query', (q) => captured.push(q));
    await prisma.$connect();
    await prisma.user.createMany({
      data: Array.from({ length: USERS }, (_, i) => ({ id: `${prefix}-u${String(i).padStart(5, '0')}`, referralCode: `${prefix}${i}`, fullName: 'IT' })),
    });
    // Mỗi khách 1-3 lô. Lô CONVERTED (không hạn), delta <= 0, hết hạn sau now, hết hạn trước mốc dưới phải bị loại.
    await prisma.$executeRawUnsafe(
      `INSERT INTO points_transactions (id, "userId", delta, reason, "refType", "refId", "expiresAt", lot, "createdAt")
       SELECT '${prefix}-t'||u||'-'||k, '${prefix}-u'||lpad(u::text, 5, '0'),
              CASE WHEN (u+k) % 11 = 0 THEN -5 ELSE 10 END, 'IT'||k, 'ORDER', 'r'||u||'-'||k,
              CASE WHEN (u+k) % 5 = 0 THEN NULL
                   WHEN (u+k) % 7 = 0 THEN '2026-08-01'::timestamp
                   WHEN (u+k) % 13 = 0 THEN '2026-06-01'::timestamp
                   ELSE '2026-07-04'::timestamp END,
              CASE WHEN (u+k) % 5 = 0 THEN 'CONVERTED'::"PointsLot" ELSE 'STANDARD'::"PointsLot" END,
              now()
       FROM generate_series(0, ${USERS - 1}) u, generate_series(1, 1 + (u % 3)) k`,
    );
    svc = new LoyaltyExpiryService(prisma as unknown as PrismaService, {} as never, {} as never);
    const old = await prisma.pointsTransaction.findMany({
      where: { id: { startsWith: `${prefix}-t` }, lot: 'STANDARD', delta: { gt: 0 }, expiresAt: { gt: floor, lte: now } },
      select: { userId: true },
      distinct: ['userId'],
      orderBy: { userId: 'asc' },
    });
    expected = old.map((r) => r.userId);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DELETE FROM points_transactions WHERE id LIKE '${prefix}-t%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE '${prefix}-u%'`);
    await prisma.$disconnect();
  });

  it('phân trang theo cursor cho ra đúng danh sách của cách cũ, mỗi trang tối đa BATCH và có LIMIT trong SQL', async () => {
    expect(expected.length).toBeGreaterThan(600);
    const page = (cursor?: string) =>
      (svc as unknown as { candidateUserIds: (r: { gt?: Date; lte: Date }, c?: string) => Promise<{ userId: string }[]> }).candidateUserIds(
        { gt: floor, lte: now },
        cursor,
      );
    const got: string[] = [];
    let cursor: string | undefined;
    captured = [];
    for (let i = 0; i < 20; i++) {
      const rows = await page(cursor);
      if (rows.length === 0) break;
      expect(rows.length).toBeLessThanOrEqual(500);
      // Khách của test khác trong cùng DB có thể lọt vào trang: chỉ so phần của prefix này.
      got.push(...rows.map((r) => r.userId).filter((id) => id.startsWith(`${prefix}-u`)));
      cursor = rows[rows.length - 1]!.userId;
      if (rows.length < 500) break;
    }
    expect(got).toEqual(expected);
    const sqls = captured.map((c) => c.query).filter((q) => /points_transactions/.test(q) && /DISTINCT/.test(q));
    expect(sqls.length).toBeGreaterThanOrEqual(2);
    for (const q of sqls) expect(q).toMatch(/LIMIT \$\d+/);
  });
});
