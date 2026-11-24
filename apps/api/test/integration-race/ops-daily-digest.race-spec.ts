import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DailyDigestService, DIGEST_STATE_KEY } from '../../src/modules/ops/daily-digest.service';
import type { DailyDigest } from '../../src/modules/ops/daily-digest';
import { ServerErrorCounterService, serverErrorStateKey } from '../../src/modules/ops/server-error-counter.service';
import { createOrder, createUser, randCode } from './helpers';
import './setup-env';

/**
 * Bản tin sáng của chủ shop trên Postgres THẬT: SQL doanh thu (cùng định nghĩa báo cáo Doanh thu), đơn kẹt theo lần vào trạng thái, hàng sắp
 * hết kho Tubu, từ khoá tìm không ra, bộ đếm 5xx cộng dồn giữa hai instance, và chốt ngày đã gửi. Ngày tóm tắt 10/03/2034 (spec khác không dùng);
 * đơn chờ chuyển khoản và đơn kẹt là trạng thái toàn DB nên đơn của spec đặt mốc năm 2001 để luôn đứng đầu danh sách "cũ nhất".
 */
const DAY = '2034-03-10';
// 08:00 giờ VN ngày 11/03/2034.
const NOW = new Date('2034-03-11T01:00:00.000Z');
const t = (iso: string) => new Date(iso);

describe('DailyDigestService — Postgres thật', () => {
  let prisma: PrismaService;
  const tag = randCode(6).replace(/[^A-Za-z]/g, 'q');
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const eventPrefix = `it-digest-${tag}-`;
  const codes: Record<string, string> = {};

  async function order(name: string, data: Parameters<typeof createOrder>[1]) {
    const o = await createOrder(prisma, data);
    orderIds.push(o.id);
    codes[name] = o.code;
    return o;
  }

  async function product(name: string, over: Record<string, unknown>, variations: Array<{ stock: number; isActive?: boolean; pancake?: boolean }>) {
    const p = await prisma.product.create({
      data: { brand: 'IT', slug: `it-digest-${tag.toLowerCase()}-${name}`, name: `SP ${name} ${tag}`, description: 'IT', basePrice: 100_000, ...over },
    });
    productIds.push(p.id);
    for (const [i, v] of variations.entries()) {
      await prisma.variation.create({
        data: {
          productId: p.id,
          pancakeId: v.pancake === false ? null : `it-digest-${tag}-${name}-${i}`,
          sku: `ITDG-${tag}-${name}-${i}`,
          name: `Loại ${i}`,
          attributes: {},
          retailPrice: 100_000,
          stock: v.stock,
          isActive: v.isActive ?? true,
        },
      });
    }
  }

  async function zeroSearch(q: string, at: Date, who = randomUUID()) {
    await prisma.analyticsEvent.create({
      data: { eventId: `${eventPrefix}${randomUUID()}`, eventName: 'search_zero_result', occurredAt: at, receivedAt: at, sessionId: who, platform: 'web', props: { q } },
    });
  }

  async function cleanup() {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.variation.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.$executeRaw`DELETE FROM "analytics_events" WHERE "eventId" LIKE ${`${eventPrefix}%`}`;
    await prisma.opsHealthState.deleteMany({ where: { key: { in: [serverErrorStateKey(DAY), serverErrorStateKey('2034-03-11'), DIGEST_STATE_KEY] } } });
    await prisma.$executeRaw`DELETE FROM cron_leases WHERE name = 'ops.daily-digest'`;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  it('gom đủ sáu mục với số đúng cho ngày VN, gửi một lần, lượt gửi bù sau không gửi lại', async () => {
    const svc0 = new DailyDigestService(prisma, {} as never, new ServerErrorCounterService(prisma));
    const before = await svc0.collect(DAY, NOW);
    const u = await createUser(prisma);

    // Đơn của ngày 10/03 giờ VN: [2034-03-09T17:00Z, 2034-03-10T17:00Z).
    await order('codDelivered', { userId: u.id, total: 100_000, status: 'DELIVERED', deliveredAt: t('2034-03-10T05:00:00Z'), createdAt: t('2034-03-09T17:00:00Z') });
    await order('paidTransfer', { userId: u.id, total: 200_000, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', paidAt: t('2034-03-10T03:00:00Z'), createdAt: t('2034-03-10T02:00:00Z') });
    await order('cancelled', { userId: u.id, total: 50_000, status: 'CANCELLED', createdAt: t('2034-03-10T04:00:00Z') });
    await order('pendingLate', { userId: u.id, total: 70_000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', createdAt: t('2034-03-10T16:59:00Z') });
    await order('nextDay', { userId: u.id, total: 999_000, createdAt: t('2034-03-10T17:00:00Z') });

    // Chuyển khoản chờ tiền rất cũ: đứng đầu danh sách. ZaloPay còn chờ thanh toán không phải chuyển khoản.
    await order('pendingOld', { userId: u.id, total: 33_000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', createdAt: t('2001-01-01T00:00:00Z') });
    await order('pendingZalo', { userId: u.id, total: 44_000, status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY', createdAt: t('2001-01-01T00:00:01Z') });

    // Đơn kẹt: S1 chưa có lịch sử (tính từ lúc tạo); S2 vừa đóng gói 13 giờ trước nên không kẹt; S3 đóng gói từ 2001, dòng ghi chú
    // cùng trạng thái hôm qua không làm mới mốc.
    const s1 = await order('stuckNoHistory', { userId: u.id, status: 'CONFIRMED', createdAt: t('2001-01-02T00:00:00Z') });
    const s2 = await order('packedRecently', { userId: u.id, status: 'PACKED', createdAt: t('2001-01-03T00:00:00Z') });
    const s3 = await order('packedLongAgo', { userId: u.id, status: 'PACKED', createdAt: t('2001-01-04T00:00:00Z') });
    await prisma.orderStatusHistory.createMany({
      data: [
        { orderId: s2.id, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'ADMIN', createdAt: t('2034-03-10T12:00:00Z') },
        { orderId: s3.id, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'ADMIN', createdAt: t('2001-01-05T00:00:00Z') },
        { orderId: s3.id, fromStatus: 'PACKED', toStatus: 'PACKED', actorType: 'PANCAKE', note: 'ghi chú', createdAt: t('2034-03-10T20:00:00Z') },
      ],
    });
    expect(s1.status).toBe('CONFIRMED');

    // Hàng sắp hết: chỉ biến thể đang bán, kho Tubu (Pancake), sản phẩm đã duyệt; tồn 0 và 5 tính, 6 không.
    await product('tubu', { pancakeId: `it-digest-p-${tag}` }, [{ stock: 0 }, { stock: 5 }, { stock: 6 }, { stock: 1, isActive: false }]);
    await product('merchant', { fulfilment: 'MERCHANT' }, [{ stock: 1, pancake: false }]);
    await product('pending', { pancakeId: `it-digest-pp-${tag}`, approvalStatus: 'PENDING_REVIEW' }, [{ stock: 0 }]);

    // Từ khoá tìm không ra: SĐT bị lọc, sự kiện 00:30 ngày 11/03 giờ VN ngoài ngày.
    for (let i = 0; i < 3; i++) await zeroSearch('Dầu gội bồ kết', t(`2034-03-10T0${i + 1}:00:00Z`));
    await zeroSearch('nước giặt', t('2034-03-10T05:00:00Z'));
    for (let i = 0; i < 5; i++) await zeroSearch('0912345678', t('2034-03-10T06:00:00Z'));
    await zeroSearch('ngoai ngay', t('2034-03-10T17:30:00Z'));

    // 5xx: hai instance cùng ghi dồn vào một dòng; instance đọc cộng thêm phần chưa ghi của nó.
    const a = new ServerErrorCounterService(prisma);
    const b = new ServerErrorCounterService(prisma);
    a.record(t('2034-03-10T01:00:00Z'));
    a.record(t('2034-03-10T16:59:59Z'));
    b.record(t('2034-03-10T09:00:00Z'));
    b.record(t('2034-03-10T17:00:00Z'));
    await Promise.all([a.flush(), b.flush()]);
    a.record(t('2034-03-10T10:00:00Z'));

    const email = { isReady: () => true, blockLifted: async () => true, sendDigest: jest.fn(async (_d: DailyDigest) => 'SENT' as const) };
    const svc = new DailyDigestService(prisma, email as never, a);
    const d = await svc.collect(DAY, NOW);

    expect(d.orders).toEqual({ placed: 4, cancelled: 1, paidOrders: 2, revenue: 300_000, gmv: 300_000 });
    expect(d.unpaidTransfers!.count).toBe(before.unpaidTransfers!.count + 2);
    expect(d.unpaidTransfers!.amount).toBe(before.unpaidTransfers!.amount + 103_000);
    expect(d.unpaidTransfers!.oldest[0]).toEqual({ code: codes.pendingOld, createdAt: '2001-01-01T00:00:00.000Z', total: 33_000 });
    expect(d.unpaidTransfers!.oldest.map((x) => x.code)).not.toContain(codes.pendingZalo);

    expect(d.stuckOrders!.oldest.slice(0, 2)).toEqual([
      { code: codes.stuckNoHistory, status: 'CONFIRMED', since: '2001-01-02T00:00:00.000Z' },
      { code: codes.packedLongAgo, status: 'PACKED', since: '2001-01-05T00:00:00.000Z' },
    ]);
    expect(d.stuckOrders!.oldest.map((x) => x.code)).not.toContain(codes.packedRecently);
    expect(d.stuckOrders!.count).toBeGreaterThanOrEqual(2);

    expect(d.lowStock!.count - before.lowStock!.count).toBe(2);
    expect(d.lowStock!.outOfStock - before.lowStock!.outOfStock).toBe(1);

    expect(d.zeroResults).toEqual([
      { term: 'dầu gội bồ kết', count: 3 },
      { term: 'nước giặt', count: 1 },
    ]);
    expect(d.serverErrors).toBe(4);
    expect(await new ServerErrorCounterService(prisma).countForDay(DAY)).toBe(3);

    await prisma.opsHealthState.deleteMany({ where: { key: DIGEST_STATE_KEY } });
    await expect(svc.run(NOW)).resolves.toBe('SENT');
    expect(email.sendDigest).toHaveBeenCalledTimes(1);
    expect(email.sendDigest.mock.calls[0]![0]).toMatchObject({ day: DAY, orders: { placed: 4 } });
    await expect(svc.run(new Date(NOW.getTime() + 30 * 60_000))).resolves.toBe('ALREADY_SENT');
    expect(email.sendDigest).toHaveBeenCalledTimes(1);
    const state = await prisma.opsHealthState.findUnique({ where: { key: DIGEST_STATE_KEY } });
    expect(state?.detail).toEqual({ day: DAY, outcome: 'SENT' });
    // Khoá lượt gửi đã nhả: lượt sau giành được ngay.
    const lease = await prisma.$queryRaw<{ expiresAt: Date }[]>`SELECT "expiresAt" FROM cron_leases WHERE name = 'ops.daily-digest'`;
    expect(lease[0]!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
