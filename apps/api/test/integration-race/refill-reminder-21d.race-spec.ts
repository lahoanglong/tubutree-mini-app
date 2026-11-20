import { PrismaService } from '../../src/prisma/prisma.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RefillReminderService } from '../../src/modules/notifications/refill-reminder.service';
import { createOrder, createRealUser, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Nhắc đổi sang gói Refill 21 ngày (tubu-w11-03) trên Postgres THẬT: một đơn một tin kể cả hai lượt chạy song song, bỏ khách đã mua
 * lại gói Refill, bỏ khách từ chối tin, cửa sổ 21–28 ngày, mỗi khách một tin mỗi 7 ngày. Tin giả (chỉ ghi lời gọi).
 */
describe('Nhắc Refill 21 ngày (real Postgres)', () => {
  let prisma: PrismaService;
  const values: Record<string, unknown> = { 'retention.refill_21d_reminder_enabled': true, 'retention.refill_21d_zns_enabled': false };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  const now = new Date();
  let bottleVariation: string;
  let refillVariation: string;
  let refillSlug: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    // Thương hiệu riêng mỗi lượt: bảng cặp quét cả danh mục công khai của DB dùng chung, cặp này không trùng cặp của spec khác.
    const tag = randCode(6).toLowerCase();
    const brand = `ITRF${tag}`;
    const bottle = await prisma.product.create({
      data: { brand, slug: `itrf-${tag}-chai`, name: `Nước rửa chén ${brand} 3,8L`, description: 'IT', basePrice: 100_000 },
    });
    refillSlug = `refill-itrf-${tag}`;
    const refill = await prisma.product.create({
      data: { brand, slug: refillSlug, name: `Refill Nước rửa chén ${brand} 10L`, description: 'IT', basePrice: 200_000 },
    });
    bottleVariation = (
      await prisma.variation.create({ data: { productId: bottle.id, sku: `ITRF-${tag}-B`, name: '3,8L', attributes: {}, retailPrice: 100_000, stock: 10 } })
    ).id;
    refillVariation = (
      await prisma.variation.create({ data: { productId: refill.id, sku: `ITRF-${tag}-R`, name: '10L', attributes: {}, retailPrice: 200_000, stock: 10 } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notify.mockClear();
    values['retention.refill_21d_reminder_enabled'] = true;
    values['retention.refill_21d_zns_enabled'] = false;
  });

  const service = () => new RefillReminderService(prisma, notifications, config);
  const runOnce = (svc: RefillReminderService) => (svc as unknown as { runOnce(now: Date): Promise<unknown> }).runOnce(now);

  async function bottleOrder(userId: string, deliveredDaysAgo: number, over: Record<string, unknown> = {}) {
    return createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      createdAt: new Date(now.getTime() - (deliveredDaysAgo + 2) * DAY),
      deliveredAt: new Date(now.getTime() - deliveredDaysAgo * DAY),
      items: { create: { variationId: bottleVariation, productName: 'Chai IT', variationName: '3,8L', unitPrice: 100_000, quantity: 1, total: 100_000 } },
      ...over,
    });
  }

  const callsFor = (userId: string) => notify.mock.calls.filter((c: unknown[]) => c[0] === userId);
  const rowsFor = (userId: string) => prisma.refillReminder.findMany({ where: { userId } });

  it('đơn giao 22 ngày trước: một tin trong app mở trang gói Refill, khoá chống trùng theo đơn; chạy lại không nhắc lần hai', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    const order = await bottleOrder(u.id, 22);

    await runOnce(service());
    await runOnce(service());

    const calls = callsFor(u.id);
    expect(calls).toHaveLength(1);
    const [, template, data, opts] = calls[0] as [string, string, Record<string, string>, { dedupeKey: string; inAppOnly: boolean }];
    expect(template).toBe('REORDER_REMINDER_REFILL');
    expect(data.product_slug).toBe(refillSlug);
    expect(data.product).toContain('Refill');
    expect(opts).toEqual({ dedupeKey: `refill21d:${order.id}`, inAppOnly: true });
    const rows = await rowsFor(u.id);
    expect(rows.map((r) => [r.orderId, r.outcome])).toEqual([[order.id, 'SENT']]);
    // Job "Nhắc mua lại" 30 ngày coi chu kỳ của chai này là đã nhắc: không nhắc đôi cùng chai vài ngày sau.
    const generic = await prisma.reorderReminder.findUniqueOrThrow({ where: { userId_variationId: { userId: u.id, variationId: bottleVariation } } });
    expect(generic.remindedAt!.getTime()).toBeGreaterThanOrEqual(order.createdAt.getTime());
  });

  it('tin "Nhắc mua lại" đã nhắc chai này 2 ngày trước: lượt này bỏ, không ghi dòng (hết 7 ngày còn trong cửa sổ thì xét lại)', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await prisma.reorderReminder.create({
      data: { userId: u.id, variationId: bottleVariation, productName: 'Chai IT', lastOrderAt: new Date(now.getTime() - 24 * DAY), remindedAt: new Date(now.getTime() - 2 * DAY) },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(0);
    expect(await rowsFor(u.id)).toHaveLength(0);
  });

  it('hai lượt chạy song song (hai instance): đúng một tin và một dòng cho đơn', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    const order = await bottleOrder(u.id, 23);

    await Promise.all([runOnce(service()), runOnce(service()), runOnce(service())]);

    expect(callsFor(u.id)).toHaveLength(1);
    expect((await rowsFor(u.id)).map((r) => r.orderId)).toEqual([order.id]);
  });

  it('khách đã đặt lại gói Refill trong 21 ngày: không nhắc, ghi REORDERED', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await createOrder(prisma, {
      userId: u.id,
      status: 'CONFIRMED',
      createdAt: new Date(now.getTime() - 5 * DAY),
      items: { create: { variationId: refillVariation, productName: 'Refill IT', variationName: '10L', unitPrice: 200_000, quantity: 1, total: 200_000 } },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(0);
    expect((await rowsFor(u.id)).map((r) => r.outcome)).toEqual(['REORDERED']);
  });

  it('đơn đặt lại đã huỷ không tính là mua lại: vẫn nhắc', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await createOrder(prisma, {
      userId: u.id,
      status: 'CANCELLED',
      createdAt: new Date(now.getTime() - 5 * DAY),
      items: { create: { variationId: refillVariation, productName: 'Refill IT', variationName: '10L', unitPrice: 200_000, quantity: 1, total: 200_000 } },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(1);
  });

  it('khách tắt tin khuyến mãi hay MSS báo từ chối tin Zalo: không nhắc, ghi OPTED_OUT', async () => {
    const off = await createRealUser(prisma, { notifyPromo: false });
    const mss = await createRealUser(prisma, { notifyPromo: true, notifyOrderZalo: false, notifyOrderZaloSource: 'mss_opt_out' });
    await bottleOrder(off.id, 22);
    await bottleOrder(mss.id, 22);

    await runOnce(service());

    expect(callsFor(off.id)).toHaveLength(0);
    expect(callsFor(mss.id)).toHaveLength(0);
    expect((await rowsFor(off.id)).map((r) => r.outcome)).toEqual(['OPTED_OUT']);
    expect((await rowsFor(mss.id)).map((r) => r.outcome)).toEqual(['OPTED_OUT']);
  });

  it('ngoài cửa sổ 21–28 ngày, chai đã trả, quà 0đ: không nhắc, không ghi', async () => {
    const early = await createRealUser(prisma, { notifyPromo: true });
    const old = await createRealUser(prisma, { notifyPromo: true });
    const returned = await createRealUser(prisma, { notifyPromo: true });
    const gift = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(early.id, 10);
    await bottleOrder(old.id, 40);
    const r = await bottleOrder(returned.id, 22);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r.id } });
    await prisma.returnRequest.create({
      data: { orderId: r.id, userId: returned.id, reason: 'IT', status: 'REQUESTED', items: { create: { orderItemId: item.id, quantity: 1 } } },
    });
    await createOrder(prisma, {
      userId: gift.id,
      status: 'DELIVERED',
      createdAt: new Date(now.getTime() - 24 * DAY),
      deliveredAt: new Date(now.getTime() - 22 * DAY),
      items: { create: { variationId: bottleVariation, productName: 'Quà IT', variationName: '3,8L', unitPrice: 0, quantity: 1, total: 0, isGift: true } },
    });

    await runOnce(service());

    for (const u of [early, old, returned, gift]) {
      expect(callsFor(u.id)).toHaveLength(0);
      expect(await rowsFor(u.id)).toHaveLength(0);
    }
  });

  it('khách có hai đơn tới hạn: một tin; đơn kia không ghi để lượt sau xét lại', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await bottleOrder(u.id, 24);

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(1);
    expect((await rowsFor(u.id)).map((r) => r.outcome)).toEqual(['SENT']);
  });

  it('bật kênh ZNS thì tin không còn bị giữ trong app', async () => {
    values['retention.refill_21d_zns_enabled'] = true;
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);

    await runOnce(service());

    expect((callsFor(u.id)[0] as unknown[])[3]).toMatchObject({ inAppOnly: false });
  });

  it('gửi tin lỗi: bỏ dòng để lượt sau thử lại', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    notify.mockImplementation(async (userId: string) => {
      if (userId === u.id) throw new Error('boom');
    });

    await runOnce(service());
    expect(await rowsFor(u.id)).toHaveLength(0);

    notify.mockReset().mockResolvedValue(undefined);
    await runOnce(service());
    expect(callsFor(u.id)).toHaveLength(1);
    expect((await rowsFor(u.id)).map((r) => r.outcome)).toEqual(['SENT']);
  });

  it('cờ tắt: không đọc đơn, không gửi', async () => {
    values['retention.refill_21d_reminder_enabled'] = false;
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);

    expect(await service().sendDue(now)).toEqual({ skipped: 'OFF' });
    expect(callsFor(u.id)).toHaveLength(0);
  });
});
