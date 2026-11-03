import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createDealer, createOrder, deleteItData, randCode, warmPool } from './helpers';

/**
 * TK-01 trên Postgres THẬT: hàng trả về SAU khi giao không được cộng vào `stock` của biến thể mà Pancake là nguồn tồn (pancakeStock
 * khác NULL), và không động tới `reservedStock` (giữ chỗ của đơn KHÁC). Biến thể tự quản (pancakeStock NULL) cộng như cũ. Huỷ đơn
 * trước khi giao vẫn nhả giữ chỗ.
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

  it('Pancake 5 trên đơn đã giao (DELIVERED): đảo cả đơn không cộng stock/reservedStock biến thể Pancake', async () => {
    const { v, order } = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, order));
    expect(await stockOf(v.id)).toEqual({ stock: 2, reservedStock: 3, pancakeStock: 5 });
  });

  it('đơn đã lên Pancake và đã đồng bộ tồn sau lúc đẩy: huỷ không cộng; chưa đồng bộ thì nhả giữ chỗ', async () => {
    const pushedAt = new Date('2026-11-04T08:00:00.000Z');
    const synced = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 }, { status: 'CONFIRMED' });
    await prisma.order.update({ where: { id: synced.order.id }, data: { pancakeOrderId: `ittk1-po-${randCode(6)}`, pancakePushStatus: 'SYNCED', pancakeLastAttemptAt: pushedAt } });
    await prisma.variation.update({ where: { id: synced.v.id }, data: { pancakeStockSyncReadAt: new Date('2026-11-04T09:00:00.000Z') } });
    const o1 = await prisma.order.findUniqueOrThrow({ where: { id: synced.order.id }, include: { items: true } });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, o1));
    expect(await stockOf(synced.v.id)).toMatchObject({ stock: 2, reservedStock: 3 });

    const notYet = await scenario({ stock: 2, reservedStock: 3, pancakeStock: 5 }, { status: 'CONFIRMED' });
    await prisma.order.update({ where: { id: notYet.order.id }, data: { pancakeOrderId: `ittk1-po-${randCode(6)}`, pancakePushStatus: 'SYNCED', pancakeLastAttemptAt: pushedAt } });
    await prisma.variation.update({ where: { id: notYet.v.id }, data: { pancakeStockSyncReadAt: new Date('2026-11-04T07:00:00.000Z') } });
    const o2 = await prisma.order.findUniqueOrThrow({ where: { id: notYet.order.id }, include: { items: true } });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, o2));
    expect(await stockOf(notYet.v.id)).toMatchObject({ stock: 3, reservedStock: 2 });
  });
});
