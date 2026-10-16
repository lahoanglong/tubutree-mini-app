import { Test, type TestingModule } from '@nestjs/testing';
import type { MembershipTier } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderReturnsService, RETURNS_TO_RECEIVE } from '../../src/modules/orders/order-returns.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** Trên giới hạn 32.767 tham số bind của một câu Postgres (Prisma P2029/P2035 khi danh sách IN dài hơn). */
const BIG = 33_000;
const SMALL = 5;
const TOTAL = 100_000;
const REFUNDED = 20_000;
const EARNED = 10;
const REVERSED = 3;

type Page = { data: { id: string }[]; meta: { total: number } };

/**
 * Danh sách id đưa vào IN/NOT IN vượt giới hạn bind khi một khách có > ~32k đơn trả một phần (giao đơn → recalcTier) hoặc có
 * > ~32k yêu cầu trả chờ nhận hàng về (danh sách "Chờ nhận hàng về"). Dữ liệu lớn chèn bằng INSERT … SELECT generate_series từ
 * một dòng mẫu; kết quả so với phép tính tay, đúng như ở cỡ nhỏ (đường cũ chạy được).
 */
describe('Danh sách IN vượt giới hạn bind (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let returns: OrderReturnsService;
  const tag = randCode(6).toLowerCase();
  const tierIds = { base: `it-vol-base-${tag}`, top: `it-vol-top-${tag}` };
  const createdUsers: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReturnsService,
        { provide: OrderReversalService, useValue: {} },
        { provide: AffiliateService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma, 5);
    loyalty = moduleRef.get(LoyaltyService);
    returns = moduleRef.get(OrderReturnsService);
    await prisma.membershipTier.createMany({
      data: [
        { id: tierIds.base, name: 'IT nền', minPoints: 0, perks: {}, sortOrder: 900 },
        { id: tierIds.top, name: 'IT trên', minPoints: 2_000_000_000, minSpending: 1, perks: {}, sortOrder: 901 },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Dữ liệu khối lớn không được ở lại DB dùng chung: spec khác đếm hàng chờ nhận về / quét đơn đã giao.
      await prisma.$executeRaw`DELETE FROM "return_requests" WHERE "id" LIKE ${`itvol-${tag}-%`}`;
      await prisma.$executeRaw`DELETE FROM "points_transactions" WHERE "userId" = ANY(${createdUsers})`;
      await prisma.$executeRaw`DELETE FROM "orders" WHERE "id" LIKE ${`itvol-${tag}-%`} OR "userId" = ANY(${createdUsers})`;
      await prisma.user.updateMany({ where: { id: { in: createdUsers } }, data: { tierId: null } });
      await prisma.membershipTier.deleteMany({ where: { id: { in: Object.values(tierIds) } } });
    }
    await moduleRef?.close();
  }, 120_000);

  /** `n` đơn đã giao trong 12 tháng của khách, mỗi đơn có điểm giao và một lần trả một phần đã duyệt. */
  async function partiallyReturnedOrders(n: number) {
    const u = await createUser(prisma, { role: 'CUSTOMER', pointsBalance: n * EARNED });
    createdUsers.push(u.id);
    const prefix = `itvol-${tag}-${++seq}`;
    await prisma.$executeRaw`
      INSERT INTO "orders"
      SELECT r.*
        FROM (SELECT * FROM "orders" WHERE "id" = ${(await template(u.id)).id}) o, generate_series(1, ${n}) g,
             LATERAL jsonb_populate_record(NULL::"orders", to_jsonb(o) || jsonb_build_object('id', ${prefix} || '-o' || g, 'code', ${prefix} || '-c' || g)) r`;
    await prisma.$executeRaw`DELETE FROM "orders" WHERE "userId" = ${u.id} AND "id" NOT LIKE ${`${prefix}-%`}`;
    await prisma.$executeRaw`
      INSERT INTO "points_transactions" ("id", "userId", "delta", "lot", "reason", "refType", "refId", "createdAt")
      SELECT ${prefix} || '-p' || g, ${u.id}, ${EARNED}, 'STANDARD', 'ORDER_DELIVERED:' || ${prefix} || '-c' || g, 'ORDER', ${prefix} || '-o' || g, now()
        FROM generate_series(1, ${n}) g`;
    await prisma.$executeRaw`
      INSERT INTO "return_requests" ("id", "orderId", "userId", "reason", "status", "fullReturn", "refundAmount", "shippingRefund", "pointsReversed", "createdAt")
      SELECT ${prefix} || '-r' || g, ${prefix} || '-o' || g, ${u.id}, 'IT', 'APPROVED', false, ${REFUNDED}, 0, ${REVERSED}, now()
        FROM generate_series(1, ${n}) g`;
    await analyze();
    return u;
  }

  /** Thống kê planner như DB đang chạy thật (autovacuum chưa kịp ANALYZE ngay sau khi chèn khối). */
  async function analyze() {
    await prisma.$executeRaw`ANALYZE "orders", "points_transactions", "return_requests", "return_request_items"`;
  }

  async function template(userId: string) {
    return createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      subtotal: TOTAL,
      total: TOTAL,
      pointsEarned: EARNED,
      deliveredAt: new Date(),
    });
  }

  /** Hạng chi tiêu đặt đúng mốc `minSpending`: khách đạt khi chi tiêu 12 tháng recalcTier tính ra ≥ mốc. */
  async function qualifiesBySpending(userId: string, minSpending: number) {
    const tiers = await prisma.membershipTier.findMany({ where: { id: { in: Object.values(tierIds) } }, orderBy: { sortOrder: 'asc' } });
    const preloaded: MembershipTier[] = tiers.map((t) => (t.id === tierIds.top ? { ...t, minSpending } : t));
    await prisma.user.update({ where: { id: userId }, data: { tierId: null, tierGraceUntil: null } });
    await loyalty.recalcTier(userId, preloaded);
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tierId === tierIds.top;
  }

  for (const n of [SMALL, BIG]) {
    it(`(a) recalcTier/getOverview với ${n} đơn trả một phần: chi tiêu và điểm hạng khớp phép tính tay`, async () => {
      const u = await partiallyReturnedOrders(n);
      const spent = n * (TOTAL - REFUNDED);
      expect(await qualifiesBySpending(u.id, spent + 1)).toBe(false);
      expect(await qualifiesBySpending(u.id, spent)).toBe(true);
      expect((await loyalty.getOverview(u.id)).tierPoints).toBe(n * (EARNED - REVERSED));
      const ledger = await prisma.pointsTransaction.aggregate({ where: { userId: u.id, lot: 'STANDARD' }, _sum: { delta: true } });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(ledger._sum.delta ?? 0);
    }, 120_000);
  }

  /**
   * `n` yêu cầu trả đã duyệt chưa nhận hàng về, mỗi yêu cầu một đơn kho Tubu riêng, cộng 2 yêu cầu của đơn gian hàng tự giao
   * (không thuộc danh sách). createdAt trước 2001, ca sau cũ hơn ca trước: đứng đầu danh sách tăng dần, thứ tự xác định.
   */
  async function toReceive(n: number) {
    const u = await createUser(prisma, { role: 'CUSTOMER' });
    createdUsers.push(u.id);
    const prefix = `itvol-${tag}-${++seq}`;
    const tubu = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date() });
    const merchant = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date(), fulfiller: 'MERCHANT' });
    for (const [src, letter, count] of [[tubu.id, 'T', n], [merchant.id, 'M', 2]] as const) {
      await prisma.$executeRaw`
        INSERT INTO "orders"
        SELECT r.*
          FROM (SELECT * FROM "orders" WHERE "id" = ${src}) o, generate_series(1, ${count}) g,
               LATERAL jsonb_populate_record(NULL::"orders", to_jsonb(o) || jsonb_build_object('id', ${`${prefix}-${letter}`} || g, 'code', ${`${prefix}-c${letter}`} || g)) r`;
    }
    await prisma.$executeRaw`
      INSERT INTO "return_requests" ("id", "orderId", "userId", "reason", "status", "createdAt")
      SELECT ${prefix} || '-r-' || o."id", o."id", ${u.id}, 'IT', 'APPROVED',
             timestamp '2001-01-01' - ${seq}::int * interval '1 year' + substring(o."id" from '[0-9]+$')::int * interval '1 second'
        FROM "orders" o WHERE o."id" LIKE ${`${prefix}-%`}`;
    await prisma.$executeRaw`
      INSERT INTO "return_request_items" ("id", "returnRequestId", "orderItemId", "quantity")
      SELECT rr."id" || '-i', rr."id", 'it-item', 1 FROM "return_requests" rr WHERE rr."id" LIKE ${`${prefix}-r-%`}`;
    await analyze();
    const expected = await prisma.$queryRaw<{ id: string }[]>`
      SELECT rr."id" FROM "return_requests" rr JOIN "orders" o ON o."id" = rr."orderId"
       WHERE rr."id" LIKE ${`${prefix}-r-%`} AND o."fulfiller" <> 'MERCHANT'
       ORDER BY rr."createdAt"`;
    return expected.map((r) => r.id);
  }

  for (const n of [SMALL, BIG]) {
    it(`(b) "Chờ nhận hàng về" với ${n} yêu cầu: tổng và trang đầu đúng, bỏ đơn gian hàng tự giao`, async () => {
      const before = (await returns.listForAdmin(RETURNS_TO_RECEIVE, 1, 1)) as Page;
      const ours = await toReceive(n);
      expect(ours).toHaveLength(n);
      const page = (await returns.listForAdmin(RETURNS_TO_RECEIVE, 1, 20)) as Page;
      expect(page.meta.total).toBe(before.meta.total + n);
      // Yêu cầu của ca trước và của spec khác (mới hơn) đứng sau các yêu cầu của ca này.
      expect(page.data.map((r) => r.id).slice(0, Math.min(n, 20))).toEqual(ours.slice(0, 20));
      const second = (await returns.listForAdmin(RETURNS_TO_RECEIVE, 2, 3)) as Page;
      expect(second.data.map((r) => r.id).slice(0, Math.min(3, n - 3))).toEqual(ours.slice(3, 6));
    }, 120_000);
  }
});
