import { PrismaService } from '../../src/prisma/prisma.service';
import { DeliveredEffectsResyncCron } from '../../src/modules/orders/delivered-effects-resync.cron';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { createUser, randCode, sleep, warmPool } from './helpers';

const INDEX = 'orders_delivered_effects_pending_idx';
const SEEDED = 20_000;

/**
 * Sức khoẻ hệ thống (mỗi 5 phút) và cron chạy lại việc sau giao (mỗi 10 phút) chỉ tìm đơn đã giao chưa có mốc — tập rất nhỏ trong
 * bảng orders lớn. Câu Prisma thật (status gửi dạng CAST($1::text AS "OrderStatus")) phải đi qua index có điều kiện, không quét
 * cả bảng: đo bằng pg_stat_user_indexes.idx_scan của chính index đó.
 */
describe('Index việc sau giao được câu Prisma thật dùng (real Postgres)', () => {
  let prisma: PrismaService;
  let health: OpsHealthService;
  let cron: DeliveredEffectsResyncCron;
  const prefix = `IX${randCode(6)}`;
  let userId = '';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    userId = (await createUser(prisma)).id;
    // Như production: gần hết đơn đã giao có mốc hoặc chưa giao; vài đơn giao chưa xong (trong cửa sổ cron và quá 14 ngày).
    await prisma.$executeRaw`
      INSERT INTO "orders" ("id", "code", "userId", "type", "status", "subtotal", "total", "paymentMethod", "paymentStatus",
                            "shippingAddress", "updatedAt", "deliveredAt", "deliveredEffectsAt")
      SELECT ${prefix} || g, ${prefix} || g, ${userId}, 'RETAIL',
             (CASE WHEN g % 10 < 7 THEN 'DELIVERED' WHEN g % 10 < 9 THEN 'CONFIRMED' ELSE 'CANCELLED' END)::"OrderStatus",
             1000, 1000, 'COD', 'UNPAID', '{}', now(),
             CASE WHEN g % 10 < 7 THEN now() - make_interval(mins => g * 2) END,
             CASE WHEN g % 10 < 7 AND g % 1000 <> 0 THEN now() END
        FROM generate_series(1, ${SEEDED}::int) g`;
    await prisma.$executeRawUnsafe('ANALYZE "orders"');

    const queue = (name: string): OpsQueue => ({
      name,
      getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
      getFailed: async () => [],
    });
    health = new OpsHealthService(
      prisma,
      { get: () => '' } as never,
      [queue('pancake-push')],
      { get: async <T,>(_key: string, fallback: T) => fallback } as never,
      { getConfig: async () => null, getHealth: () => null } as never,
      { notify: jest.fn().mockResolvedValue(undefined) } as never,
      jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never,
    );
    const orderStatus = { resyncDeliveredEffects: jest.fn().mockResolvedValue({ outcome: 'ALREADY_DONE' }) };
    cron = new DeliveredEffectsResyncCron(prisma, orderStatus as unknown as OrderStatusService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { code: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma?.$disconnect();
  });

  const idxScans = async () => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COALESCE(SUM("idx_scan"), 0)::bigint AS "n" FROM "pg_stat_user_indexes" WHERE "indexrelname" = ${INDEX}`;
    return Number(row?.n ?? 0);
  };

  /** Số liệu idx_scan của backend khác được đẩy lên trễ (~1 giây khi kết nối rảnh): đợi tới khi tăng đủ. */
  async function scansAfter(before: number, atLeast: number) {
    let now = await idxScans();
    for (let i = 0; i < 40 && now - before < atLeast; i++) {
      await sleep(500);
      now = await idxScans();
    }
    return now - before;
  }

  it('Sức khoẻ hệ thống: đếm đơn chờ, đếm đơn quá cửa sổ và danh sách kẹt đều quét index (3 lần)', async () => {
    const before = await idxScans();
    const snap = await health.snapshot();
    expect(snap.orders.deliveredEffectsPending).toBeGreaterThanOrEqual(SEEDED / 10 / 100);
    expect(snap.orders.deliveredEffectsStale).toBeGreaterThanOrEqual(1);
    expect(await scansAfter(before, 3)).toBeGreaterThanOrEqual(3);
  });

  it('Cron chạy lại: trang keyset quét index', async () => {
    const before = await idxScans();
    const res = await cron.resyncPending();
    expect(res).toMatchObject({ scanned: expect.any(Number) });
    expect((res as { scanned: number }).scanned).toBeGreaterThan(0);
    expect(await scansAfter(before, 1)).toBeGreaterThanOrEqual(1);
  });
});
