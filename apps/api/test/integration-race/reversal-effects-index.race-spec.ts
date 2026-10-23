import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReversalEffectsResyncCron } from '../../src/modules/orders/reversal-effects-resync.cron';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { createOrder, createUser, randCode, sleep, warmPool } from './helpers';

const INDEX = 'orders_reversal_effects_pending_idx';
const MIGRATION = '20261020120000_q19_reversal_effects_marker';
const SEEDED = 20_000;

/**
 * Cron chạy lại phần đảo sau huỷ/trả (5 phút một lượt) chỉ tìm đơn huỷ/trả chưa có mốc — tập rất nhỏ trong bảng orders lớn mà mọi
 * đơn chưa đóng đều có mốc null. Câu SQL của cron phải đi qua index từng phần, không quét cả bảng (đo bằng idx_scan của chính index).
 * Và câu UPDATE điền sẵn mốc trong migration phải đúng: đơn đã huỷ/trả có mốc = updatedAt, đơn chưa đóng vẫn null.
 */
describe('Mốc phần đảo sau huỷ/trả: index và điền sẵn của migration (real Postgres)', () => {
  let prisma: PrismaService;
  let cron: ReversalEffectsResyncCron;
  const prefix = `RX${randCode(6)}`;
  let userId = '';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    userId = (await createUser(prisma)).id;
    // Như production sau migration: gần hết đơn huỷ/trả có mốc; vài đơn huỷ chưa xong (quá 5 phút) để cron có việc.
    await prisma.$executeRaw`
      INSERT INTO "orders" ("id", "code", "userId", "type", "status", "subtotal", "total", "paymentMethod", "paymentStatus",
                            "shippingAddress", "updatedAt", "reversalEffectsAt")
      SELECT ${prefix} || g, ${prefix} || g, ${userId}, 'RETAIL',
             (CASE WHEN g % 10 < 7 THEN 'DELIVERED' WHEN g % 10 < 9 THEN 'CONFIRMED' ELSE 'CANCELLED' END)::"OrderStatus",
             1000, 1000, 'COD', 'UNPAID', '{}', now() - make_interval(mins => 20 + g % 60),
             CASE WHEN g % 10 = 9 AND g % 1000 <> 9 THEN now() END
        FROM generate_series(1, ${SEEDED}::int) g`;
    await prisma.$executeRawUnsafe('ANALYZE "orders"');
    const orderStatus = { resyncReversalEffects: jest.fn().mockResolvedValue({ outcome: 'ALREADY_DONE' }) };
    cron = new ReversalEffectsResyncCron(prisma, orderStatus as unknown as OrderStatusService);
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

  it('Cron: trang keyset quét index từng phần và thấy đúng các đơn huỷ chưa xong', async () => {
    const before = await idxScans();
    const res = await cron.resyncPending();
    expect(res).toMatchObject({ scanned: expect.any(Number) });
    expect((res as { scanned: number }).scanned).toBeGreaterThanOrEqual(SEEDED / 10 / 1000);
    expect(await scansAfter(before, 1)).toBeGreaterThanOrEqual(1);
  });

  it('câu UPDATE điền sẵn của migration: đơn huỷ/trả chưa có mốc nhận mốc = updatedAt, đơn chưa đóng và đơn đã có mốc giữ nguyên, chạy lại không đổi gì', async () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations', MIGRATION, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    const update = sql.split(/;\s*\n/).find((st) => /^\s*UPDATE\s+"orders"/i.test(st));
    expect(update).toBeDefined();
    const mk = (n: string, status: 'CANCELLED' | 'RETURNED' | 'CONFIRMED' | 'DELIVERED', marker: Date | null) =>
      createOrder(prisma, { code: `${prefix}M${n}`, userId, status, total: 1000, subtotal: 1000, reversalEffectsAt: marker });
    const old = new Date('2026-09-01T03:00:00.000Z');
    const keep = new Date('2026-09-02T04:00:00.000Z');
    const rows = [await mk('1', 'CANCELLED', null), await mk('2', 'RETURNED', null), await mk('3', 'CONFIRMED', null), await mk('4', 'DELIVERED', null), await mk('5', 'CANCELLED', keep)];
    for (const r of rows) await prisma.$executeRaw`UPDATE "orders" SET "updatedAt" = ${old} WHERE "id" = ${r.id}`;

    await prisma.$executeRawUnsafe(update!);
    await prisma.$executeRawUnsafe(update!);

    const after = await prisma.order.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { code: true, reversalEffectsAt: true }, orderBy: { code: 'asc' } });
    expect(after.map((r) => r.reversalEffectsAt)).toEqual([old, old, null, null, keep]);
  });
});
