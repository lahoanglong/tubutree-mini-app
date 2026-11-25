import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RepurchaseDueService } from '../../src/modules/orders/repurchase-due.service';
import { loadRefillPairTable } from '../../src/modules/catalog/refill/refill-pair-table';
import { createOrder as createOrderRow, createRealUser as createRealUserRow, warmPool } from './helpers';

const DAY = 864e5;

/** Tag chỉ gồm chữ, không có "x": tên mang số và "x" bị luật gói nhiều món đọc sai, cặp Refill không tự ghép (xem refill-reminder-21d). */
function letterTag(len: number): string {
  const letters = 'abcdefghjkmnpqrstuvwyz';
  return [...randomBytes(len)].map((b) => letters[b % letters.length]).join('');
}

/**
 * Thẻ Mua lại hàng tiêu hao (w36-01) trên Postgres THẬT: câu SQL ứng viên (đơn đã giao 25–40 ngày, loại hoàn tiền, đặt hộ, quà), cặp Refill tự ghép,
 * loại món đã đặt lại, đã trả hết, đang có gói định kỳ, đã nằm trong giỏ; gói Refill hết hàng thì mời đúng món đã mua. Chỉ đọc, không gửi tin.
 */
describe('Thẻ Mua lại hàng tiêu hao (real Postgres)', () => {
  let prisma: PrismaService;
  const values: Record<string, unknown> = { 'retention.repurchase_due_card_enabled': true };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;
  const now = new Date();
  const tag = letterTag(8);
  let bottleVariation: string;
  let refillVariation: string;
  let refillProductId: string;
  let rauVariation: string;
  let shampooVariation: string;
  const productIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];

  const createRealUser = async (data: Parameters<typeof createRealUserRow>[1] = {}) => {
    const u = await createRealUserRow(prisma, data);
    userIds.push(u.id);
    return u;
  };
  const createOrder = async (data: Parameters<typeof createOrderRow>[1]) => {
    const o = await createOrderRow(prisma, data);
    orderIds.push(o.id);
    return o;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const brand = `ITRD${tag}`;
    const mk = async (slug: string, name: string, price: number, varName: string, stock = 10) => {
      const p = await prisma.product.create({
        data: { brand, slug, name, description: 'IT', basePrice: price, variations: { create: { sku: `${slug}-v`, name: varName, attributes: {}, retailPrice: price, stock } } },
        include: { variations: true },
      });
      productIds.push(p.id);
      return p;
    };
    const bottle = await mk(`itrd-${tag}-chai`, `Nước rửa chén ${brand} 3,8L`, 100_000, '3,8L');
    const refill = await mk(`refill-itrd-${tag}`, `Refill Nước rửa chén ${brand} 10L`, 200_000, '10L');
    const rau = await mk(`itrd-${tag}-rau`, `Nước ngâm rửa rau ${brand} 1L`, 60_000, '1L');
    const shampoo = await mk(`itrd-${tag}-goi`, `Dầu gội ${brand} 500ml`, 90_000, '500ml');
    bottleVariation = bottle.variations[0]!.id;
    refillVariation = refill.variations[0]!.id;
    refillProductId = refill.id;
    rauVariation = rau.variations[0]!.id;
    shampooVariation = shampoo.variations[0]!.id;
    const pairs = await loadRefillPairTable(prisma, config);
    if (pairs.get(bottle.id) !== refill.id) throw new Error(`Cặp ${bottle.name} → ${refill.name} không tự ghép: đổi tên/tag của spec`);
    if (pairs.has(rau.id)) throw new Error('Nước rửa rau của spec không được có cặp Refill');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.variation.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    values['retention.repurchase_due_card_enabled'] = true;
  });

  const service = () => new RepurchaseDueService(prisma, config);

  async function deliveredOrder(userId: string, variationId: string, deliveredDaysAgo: number, over: Record<string, unknown> = {}) {
    return createOrder({
      userId,
      status: 'DELIVERED',
      createdAt: new Date(now.getTime() - (deliveredDaysAgo + 2) * DAY),
      deliveredAt: new Date(now.getTime() - deliveredDaysAgo * DAY),
      items: { create: { variationId, productName: 'Món IT', variationName: 'IT', unitPrice: 100_000, quantity: 1, total: 100_000 } },
      ...over,
    });
  }

  it('chai giao 30 ngày trước: mời gói Refill ghép cặp, giá đang bán, khoá đơn:phân loại; hai lượt đọc song song cùng kết quả', async () => {
    const u = await createRealUser();
    const order = await deliveredOrder(u.id, bottleVariation, 30);
    const [a, b] = await Promise.all([service().forUser(u.id, now), service().forUser(u.id, now)]);
    expect(a).toEqual(b);
    expect(a.item).toMatchObject({ key: `${order.id}:${refillVariation}`, kind: 'refill', variationId: refillVariation, productId: refillProductId, price: 200_000, listPrice: 200_000 });
    expect(a.item!.days).toBeGreaterThanOrEqual(29);
    expect(a.item!.days).toBeLessThanOrEqual(31);
    expect(a.item!.boughtName).toContain('Nước rửa chén');
  });

  it('cờ tắt: { item: null } dù có món tới hạn', async () => {
    const u = await createRealUser();
    await deliveredOrder(u.id, bottleVariation, 30);
    values['retention.repurchase_due_card_enabled'] = false;
    expect(await service().forUser(u.id, now)).toEqual({ item: null });
  });

  it('ngoài cửa sổ 25–40 ngày hay không phải hàng tiêu hao: không có thẻ', async () => {
    const early = await createRealUser();
    await deliveredOrder(early.id, bottleVariation, 20);
    const late = await createRealUser();
    await deliveredOrder(late.id, bottleVariation, 45);
    const shampoo = await createRealUser();
    await deliveredOrder(shampoo.id, shampooVariation, 30);
    for (const u of [early, late, shampoo]) expect((await service().forUser(u.id, now)).item).toBeNull();
  });

  it('đơn hoàn tiền, đơn đặt hộ khách, dòng quà tặng: không tính', async () => {
    const refunded = await createRealUser();
    await deliveredOrder(refunded.id, bottleVariation, 30, { paymentStatus: 'REFUNDED' });
    const forCustomer = await createRealUser();
    await deliveredOrder(forCustomer.id, bottleVariation, 30, { placedForCustomer: true });
    const gift = await createRealUser();
    await deliveredOrder(gift.id, bottleVariation, 30, {
      items: { create: { variationId: bottleVariation, productName: 'Quà', variationName: 'IT', unitPrice: 0, quantity: 1, total: 0, isGift: true } },
    });
    for (const u of [refunded, forCustomer, gift]) expect((await service().forUser(u.id, now)).item).toBeNull();
  });

  it('đã đặt lại gói Refill sau đơn đó (đơn chờ thanh toán cũng tính): không có thẻ; đơn đặt lại đã huỷ thì vẫn mời', async () => {
    const u = await createRealUser();
    const first = await deliveredOrder(u.id, bottleVariation, 30);
    const reorder = await createOrder({
      userId: u.id,
      status: 'PENDING_PAYMENT',
      createdAt: new Date(first.createdAt.getTime() + 5 * DAY),
      items: { create: { variationId: refillVariation, productName: 'Refill', variationName: '10L', unitPrice: 200_000, quantity: 1, total: 200_000 } },
    });
    expect((await service().forUser(u.id, now)).item).toBeNull();
    await prisma.order.update({ where: { id: reorder.id }, data: { status: 'CANCELLED' } });
    expect((await service().forUser(u.id, now)).item?.variationId).toBe(refillVariation);
  });

  it('đã trả hết món (yêu cầu trả chưa bị từ chối): không có thẻ; yêu cầu bị từ chối thì vẫn mời', async () => {
    const u = await createRealUser();
    const order = await deliveredOrder(u.id, bottleVariation, 30);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const rr = await prisma.returnRequest.create({
      data: { orderId: order.id, userId: u.id, reason: 'IT', items: { create: { orderItemId: item.id, quantity: 1 } } },
    });
    expect((await service().forUser(u.id, now)).item).toBeNull();
    await prisma.returnRequest.update({ where: { id: rr.id }, data: { status: 'REJECTED' } });
    expect((await service().forUser(u.id, now)).item).not.toBeNull();
  });

  it('đang có gói định kỳ gói Refill (chạy hay tạm dừng): không có thẻ; gói đã huỷ thì vẫn mời', async () => {
    const u = await createRealUser();
    await deliveredOrder(u.id, bottleVariation, 30);
    const addr = await prisma.address.create({
      data: { userId: u.id, recipient: 'IT', phone: '0907000000', province: 'HCM', district: 'Q1', ward: 'P1', street: '1 IT', provinceCode: '79', districtCode: '760', wardCode: '26734' },
    });
    const sub = await prisma.subscription.create({
      data: { userId: u.id, variationId: refillVariation, intervalWeeks: 4, addressId: addr.id, nextRunAt: new Date(now.getTime() + 7 * DAY), status: 'ACTIVE' },
    });
    expect((await service().forUser(u.id, now)).item).toBeNull();
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
    expect((await service().forUser(u.id, now)).item).toBeNull();
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
    expect((await service().forUser(u.id, now)).item).not.toBeNull();
  });

  it('gói Refill đã nằm trong giỏ: không lặp lại; gói hết hàng: mời đúng chai đã mua (kind same)', async () => {
    const u = await createRealUser();
    await deliveredOrder(u.id, bottleVariation, 30);
    const cart = await prisma.cart.create({ data: { userId: u.id, items: { create: { variationId: refillVariation, quantity: 1 } } } });
    expect((await service().forUser(u.id, now)).item).toBeNull();
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.variation.update({ where: { id: refillVariation }, data: { stock: 0 } });
    try {
      expect((await service().forUser(u.id, now)).item).toMatchObject({ kind: 'same', variationId: bottleVariation, price: 100_000 });
    } finally {
      await prisma.variation.update({ where: { id: refillVariation }, data: { stock: 10 } });
    }
  });

  it('nước rửa rau không có cặp Refill: mời đúng món; nhiều món tới hạn thì món nhận lâu nhất trước', async () => {
    const u = await createRealUser();
    await deliveredOrder(u.id, bottleVariation, 27);
    const rauOrder = await deliveredOrder(u.id, rauVariation, 35);
    expect((await service().forUser(u.id, now)).item).toMatchObject({ key: `${rauOrder.id}:${rauVariation}`, kind: 'same', variationId: rauVariation });
  });
});
