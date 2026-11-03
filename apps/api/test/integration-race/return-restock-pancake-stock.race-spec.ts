import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createDealer, createOrder, deleteItData, randCode, warmPool } from './helpers';

/**
 * TK-01 trên Postgres THẬT: hàng trả về SAU khi giao không được cộng vào `stock` của biến thể mà Pancake là nguồn tồn (pancakeStock
 * khác NULL), và không động tới `reservedStock` (giữ chỗ của đơn KHÁC). Biến thể tự quản (pancakeStock NULL) cộng như cũ. Huỷ đơn
 * trước khi giao (kể cả đã đẩy Pancake) vẫn nhả giữ chỗ; đơn giao tay chưa lên Pancake cũng cộng như cũ.
 */
describe('Cộng kho hàng trả về sau giao theo nguồn tồn (real Postgres)', () => {
  let prisma: PrismaService;
  let reversal: OrderReversalService;
  const created = { userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await prisma?.$disconnect();
  });

  async function scenario(
    variation: { stock: number; reservedStock: number; pancakeStock: number | null },
    order: { status: 'DELIVERED' | 'CONFIRMED' } = { status: 'DELIVERED' },
  ) {
    const user = await createDealer(prisma);
    created.userIds.push(user.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `ittk1-p-${tag}`, brand: 'IT', slug: `ittk1-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 50_000 },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `ittk1-v-${tag}`, productId: product.id, sku: `ITTK1-${tag}`, name: 'Chai', attributes: {}, retailPrice: 50_000, ...variation },
    });
    const o = await createOrder(prisma, {
      userId: user.id,
      status: order.status,
      items: { create: [{ variationId: v.id, productName: 'SP', variationName: 'Chai', unitPrice: 50_000, quantity: 1, total: 50_000 }] },
    });
    const full = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    return { v, order: full };
  }

  const stockOf = (id: string) => prisma.variation.findUniqueOrThrow({ where: { id }, select: { stock: true, reservedStock: true, pancakeStock: true } });

  const receive = (order: Awaited<ReturnType<typeof scenario>>['order']) =>
    prisma.$transaction((tx) => reversal.restockReturnedItems(tx, order, [{ orderItemId: order.items[0]!.id, quantity: 1 }], new Map()));

  it('(a) Pancake là nguồn tồn: pancakeStock=0, nhận trả 1 → stock không đổi', async () => {
    const { v, order } = await scenario({ stock: 0, reservedStock: 0, pancakeStock: 0 });
    await receive(order);
    expect(await stockOf(v.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
  });

  it('(b) reservedStock=3 của đơn khác: nhận trả 1 → reservedStock vẫn 3, stock không đổi', async () => {
    const { v, order } = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 });
    await receive(order);
    expect(await stockOf(v.id)).toEqual({ stock: 2, reservedStock: 3, pancakeStock: 5 });
  });

  it('(c) biến thể tự quản (pancakeStock NULL): cộng 1 như cũ', async () => {
    const { v, order } = await scenario({ stock: 4, reservedStock: 0, pancakeStock: null });
    await receive(order);
    expect(await stockOf(v.id)).toEqual({ stock: 5, reservedStock: 0, pancakeStock: null });
  });

  it('(d) huỷ đơn TRƯỚC khi giao vẫn nhả giữ chỗ: stock +1, reservedStock -1', async () => {
    const { v, order } = await scenario({ stock: 4, reservedStock: 3, pancakeStock: 7 }, { status: 'CONFIRMED' });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, order));
    expect(await stockOf(v.id)).toEqual({ stock: 5, reservedStock: 2, pancakeStock: 7 });
  });

  const pushed = (orderId: string) =>
    prisma.order.update({
      where: { id: orderId },
      data: { pancakeOrderId: `ittk1-po-${randCode(6)}`, pancakePushStatus: 'SYNCED', pancakeLastAttemptAt: new Date('2026-11-04T08:00:00.000Z') },
    });
  const reload = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });

  it('huỷ đơn CONFIRMED đã đẩy Pancake (kể cả đã có mốc đồng bộ tồn sau lúc đẩy): vẫn nhả giữ chỗ như mã gốc', async () => {
    const s = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 }, { status: 'CONFIRMED' });
    await pushed(s.order.id);
    await prisma.variation.update({ where: { id: s.v.id }, data: { pancakeStockSyncReadAt: new Date('2026-11-04T09:00:00.000Z') } });
    const o = await reload(s.order.id);
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, o));
    expect(await stockOf(s.v.id)).toMatchObject({ stock: 3, reservedStock: 2 });
  });

  it('đơn SHIPPING đã đẩy Pancake bị huỷ: nhả giữ chỗ', async () => {
    const s = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 }, { status: 'SHIPPING' });
    await pushed(s.order.id);
    const o = await reload(s.order.id);
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, o));
    expect(await stockOf(s.v.id)).toMatchObject({ stock: 3, reservedStock: 2 });
  });

  it('đơn DELIVERED có pancakeOrderId, đảo cả đơn: không đụng stock/reservedStock biến thể Pancake', async () => {
    const s = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 });
    await pushed(s.order.id);
    const o = await reload(s.order.id);
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, o));
    expect(await stockOf(s.v.id)).toEqual({ stock: 2, reservedStock: 3, pancakeStock: 5 });
  });

  it('đơn DELIVERED giao tay (pancakeOrderId null): cộng như cũ, nhả giữ chỗ của chính đơn', async () => {
    const s = await scenario({ stock: 4, reservedStock: 1, pancakeStock: 5 });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, s.order));
    expect(await stockOf(s.v.id)).toEqual({ stock: 5, reservedStock: 0, pancakeStock: 5 });
  });

  it('nhận hàng trả: restocked chỉ đếm biến thể thật sự được cộng', async () => {
    const pk = await scenario({ stock: 0, reservedStock: 0, pancakeStock: 0 });
    expect(await receive(pk.order)).toBe(0);
    const own = await scenario({ stock: 4, reservedStock: 0, pancakeStock: null });
    expect(await receive(own.order)).toBe(1);
  });
});
