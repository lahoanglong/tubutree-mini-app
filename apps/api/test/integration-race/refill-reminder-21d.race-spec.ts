import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RefillReminderService } from '../../src/modules/notifications/refill-reminder.service';
import { loadRefillPairTable } from '../../src/modules/catalog/refill/refill-pair-table';
import { createOrder as createOrderRow, createRealUser as createRealUserRow, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Tag thương hiệu chỉ gồm chữ, không có "x": tên sản phẩm mang tag nên tag có số và "x" ("…68x 3,8L", "a3x5…") bị luật gói nhiều món
 * (`\d x \d`) đọc thành gói nhiều món, cặp rơi sang `size` và cả file đỏ cùng lúc (khoảng 1,6% số lần chạy với randCode).
 */
function letterTag(len: number): string {
  const letters = 'abcdefghjkmnpqrstuvwyz';
  return [...randomBytes(len)].map((b) => letters[b % letters.length]).join('');
}

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
  const tag = letterTag(8);
  let bottleVariation: string;
  let refillVariation: string;
  let refillSlug: string;
  const productIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];

  // Mọi khách và đơn của file đi qua hai hàm này để afterAll dọn đúng phần của mình trên DB dùng chung.
  const createRealUser = async (p: PrismaService, data: Parameters<typeof createRealUserRow>[1] = {}) => {
    const u = await createRealUserRow(p, data);
    userIds.push(u.id);
    return u;
  };
  const createOrder = async (p: PrismaService, data: Parameters<typeof createOrderRow>[1]) => {
    const o = await createOrderRow(p, data);
    orderIds.push(o.id);
    return o;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    // Thương hiệu riêng mỗi lượt: bảng cặp quét cả danh mục công khai của DB dùng chung, cặp này không trùng cặp của spec khác.
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
    productIds.push(bottle.id, refill.id);
    // Chốt trước mọi ca: cặp của file phải tự ghép. Thiếu cặp thì job không xét đơn nào và mọi ca đỏ với lý do khó đọc.
    const pairs = await loadRefillPairTable(prisma, config);
    if (pairs.get(bottle.id) !== refill.id) throw new Error(`Cặp ${bottle.name} → ${refill.name} không tự ghép: đổi tên/tag của spec`);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.refillReminder.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }] } });
      await prisma.reorderReminder.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.variation.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    // mockReset: một ca giả lập gửi lỗi mà đỏ giữa chừng không để lại hàm ném lỗi cho ca sau.
    notify.mockReset().mockResolvedValue(undefined);
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

  it('tin "Nhắc mua lại" 30 ngày đã nhắc chai này sau khi đặt đơn: không nhắc đôi, đơn dừng hẳn (NUDGED)', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await prisma.reorderReminder.create({
      data: { userId: u.id, variationId: bottleVariation, productName: 'Chai IT', lastOrderAt: new Date(now.getTime() - 24 * DAY), remindedAt: new Date(now.getTime() - 2 * DAY) },
    });

    await runOnce(service());
    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(0);
    expect((await rowsFor(u.id)).map((r) => r.outcome)).toEqual(['NUDGED']);
  });

  it('gói Refill mua cùng đơn với chai: khách đã có gói, không nhắc (REORDERED)', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await createOrder(prisma, {
      userId: u.id,
      status: 'DELIVERED',
      createdAt: new Date(now.getTime() - 24 * DAY),
      deliveredAt: new Date(now.getTime() - 22 * DAY),
      items: {
        create: [
          { variationId: bottleVariation, productName: 'Chai IT', variationName: '3,8L', unitPrice: 100_000, quantity: 1, total: 100_000 },
          { variationId: refillVariation, productName: 'Refill IT', variationName: '10L', unitPrice: 200_000, quantity: 1, total: 200_000 },
        ],
      },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(0);
    expect((await rowsFor(u.id)).map((r) => r.outcome)).toEqual(['REORDERED']);
  });

  it('đơn gói Refill còn chờ chuyển khoản không tính là đã mua lại: vẫn nhắc', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await createOrder(prisma, {
      userId: u.id,
      status: 'PENDING_PAYMENT',
      createdAt: new Date(now.getTime() - 3 * DAY),
      items: { create: { variationId: refillVariation, productName: 'Refill IT', variationName: '10L', unitPrice: 200_000, quantity: 1, total: 200_000 } },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(1);
  });

  it('khách đã mua chai đó lần nữa: tin Refill không đánh dấu chu kỳ "Nhắc mua lại" của đơn mới', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await bottleOrder(u.id, 3);

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(1);
    expect(await prisma.reorderReminder.findUnique({ where: { userId_variationId: { userId: u.id, variationId: bottleVariation } } })).toBeNull();
  });

  it('đơn chai mới còn đang giao cũng là mua lại: tin Refill không đánh dấu, chu kỳ "Nhắc mua lại" của đơn mới vẫn còn khi đơn giao xong', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);
    await createOrder(prisma, {
      userId: u.id,
      status: 'SHIPPING',
      createdAt: new Date(now.getTime() - 2 * DAY),
      items: { create: { variationId: bottleVariation, productName: 'Chai IT', variationName: '3,8L', unitPrice: 100_000, quantity: 1, total: 100_000 } },
    });

    await runOnce(service());

    expect(callsFor(u.id)).toHaveLength(1);
    expect(await prisma.reorderReminder.findUnique({ where: { userId_variationId: { userId: u.id, variationId: bottleVariation } } })).toBeNull();
  });

  it('hai lượt chạy song song (hai instance): đúng một tin và một dòng cho đơn', async () => {
    const u = await createRealUser(prisma, { notifyPromo: true });
    const order = await bottleOrder(u.id, 23);

    await Promise.all([runOnce(service()), runOnce(service()), runOnce(service())]);

    expect(callsFor(u.id)).toHaveLength(1);
    expect((await rowsFor(u.id)).map((r) => r.orderId)).toEqual([order.id]);
  });

  it('khách đã đặt lại gói Refill sau đơn chai: không nhắc, ghi REORDERED', async () => {
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

  it('ngoài cửa sổ 21–28 ngày, quà 0đ: không nhắc, không ghi; chai đã trả: không nhắc, ghi NO_PAIR để đơn không chiếm lô', async () => {
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

    for (const u of [early, old, returned, gift]) expect(callsFor(u.id)).toHaveLength(0);
    for (const u of [early, old, gift]) expect(await rowsFor(u.id)).toHaveLength(0);
    expect((await rowsFor(returned.id)).map((r) => r.outcome)).toEqual(['NO_PAIR']);
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

  it('hơn một lô đơn tới hạn cũ hơn đứng đầu hàng mà lần nào gửi cũng lỗi: đơn mới hơn vẫn tới lượt ngay trong lượt chạy đó', async () => {
    // Đơn gửi lỗi không ghi dòng (để lượt sau thử lại) nên ngày nào cũng đứng đầu hàng theo deliveredAt. Chỉ lấy một lô 300 thì đơn
    // phía sau không bao giờ tới lượt trong cả cửa sổ 7 ngày.
    const n = RefillReminderService.BATCH + 5;
    const noisy = await createRealUser(prisma, { notifyPromo: true });
    const u = await createRealUser(prisma, { notifyPromo: true });
    const ids = Array.from({ length: n }, (_, i) => `itrf-${tag}-old-${i}`);
    const address = { recipient: 'Khach IT', phone: '0900000000', street: '1 Duong IT', ward: 'Phuong IT', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' };
    // Cùng một mốc giao cho cả lô cũ: lô sau phải nối tiếp theo (deliveredAt, id), con trỏ chỉ theo deliveredAt sẽ bỏ sót 5 đơn cuối.
    const deliveredAt = new Date(now.getTime() - 27 * DAY);
    const rows: Prisma.OrderCreateManyInput[] = ids.map((id, i) => {
      return {
        id,
        code: `ITRF${tag.toUpperCase()}${i}`,
        userId: noisy.id,
        type: 'RETAIL',
        status: 'DELIVERED',
        subtotal: 100_000,
        total: 100_000,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        shippingAddress: address,
        createdAt: new Date(deliveredAt.getTime() - 2 * DAY),
        deliveredAt,
        deliveredEffectsAt: deliveredAt,
      };
    });
    orderIds.push(...ids);
    await prisma.order.createMany({ data: rows });
    await prisma.orderItem.createMany({
      data: ids.map((orderId) => ({ orderId, variationId: bottleVariation, productName: 'Chai IT', variationName: '3,8L', unitPrice: 100_000, quantity: 1, total: 100_000 })),
    });
    const order = await bottleOrder(u.id, 22);
    notify.mockImplementation(async (userId: string) => {
      if (userId === noisy.id) throw new Error('kênh gửi lỗi');
    });

    try {
      const stats = (await runOnce(service())) as { sent: number; failed: number };

      expect(callsFor(noisy.id)).toHaveLength(n);
      expect(await rowsFor(noisy.id)).toHaveLength(0);
      expect(stats.failed).toBe(n);
      expect(callsFor(u.id)).toHaveLength(1);
      expect((await rowsFor(u.id)).map((r) => [r.orderId, r.outcome])).toEqual([[order.id, 'SENT']]);
    } finally {
      // Đơn lỗi của ca này không được đứng đầu hàng của các ca sau.
      await prisma.order.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('cờ tắt: không đọc đơn, không gửi', async () => {
    values['retention.refill_21d_reminder_enabled'] = false;
    const u = await createRealUser(prisma, { notifyPromo: true });
    await bottleOrder(u.id, 22);

    expect(await service().sendDue(now)).toEqual({ skipped: 'OFF' });
    expect(callsFor(u.id)).toHaveLength(0);
  });
});
