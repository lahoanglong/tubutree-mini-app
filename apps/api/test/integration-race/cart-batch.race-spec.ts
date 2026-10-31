import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * POST /cart/items/batch (CartService.addItemsBatch) trên Postgres thật: tất cả hoặc không món nào, kể cả khi hai batch của
 * cùng một khách chạy song song (khoá dòng carts), và /flash-sales/upcoming công khai (listUpcoming không phiên).
 */
describe('Batch thêm giỏ + upcoming công khai (real Postgres)', () => {
  let prisma: PrismaService;
  let cart: CartService;
  let flash: FlashSaleService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const flashSaleIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const config = new SystemConfigService(prisma);
    flash = new FlashSaleService(prisma, config, {} as never, {} as never);
    cart = new CartService(prisma, {} as CouponsService, config, flash, new AnalyticsEventsService(prisma), new ComboService(prisma, config));
  });

  afterAll(async () => {
    await prisma.flashSaleReminder.deleteMany({ where: { userId: { in: userIds } } });
    await deleteItData(prisma, { userIds, productIds, flashSaleIds });
    await prisma?.$disconnect();
  });

  async function product(stock: number, retailPrice = 50_000, salePrice: number | null = null) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itcb-p-${tag}`, brand: 'IT', slug: `itcb-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: retailPrice,
        variations: { create: { pancakeId: `itcb-v-${tag}`, sku: `ITCB-${tag}`, name: 'Mặc định', attributes: {}, retailPrice, salePrice, stock } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return { productId: p.id, variationId: p.variations[0]!.id, name: p.name };
  }

  async function buyer() {
    const u = await createUser(prisma, { zaloId: `z-${randCode(10)}` });
    userIds.push(u.id);
    return u.id;
  }

  const lines = async (userId: string) =>
    (await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { variationId: true, quantity: true } })).sort((a, b) =>
      a.variationId < b.variationId ? -1 : 1,
    );
  const qty = async (userId: string, variationId: string) => (await lines(userId)).find((l) => l.variationId === variationId)?.quantity ?? 0;
  const rejection = (r: PromiseSettledResult<unknown>) => {
    expect(r.status).toBe('rejected');
    const err = (r as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  };

  it('hai batch song song, mỗi batch +2 trên món còn 3 tồn: đúng một batch thành công, batch kia STOCK và dòng khác của nó không vào giỏ', async () => {
    const a = await product(3);
    const b = await product(50);
    const u = await buyer();
    const batch = () => cart.addItemsBatch(u, [{ variationId: a.variationId, quantity: 2 }, { variationId: b.variationId, quantity: 1 }], 'ctv_sheet');
    const results = await Promise.allSettled([batch(), batch()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const body = rejection(results.find((r) => r.status === 'rejected')!);
    expect(body).toMatchObject({ code: 'CART_BATCH_REJECTED', reason: 'STOCK', variationId: a.variationId });
    expect(await lines(u)).toEqual(expect.arrayContaining([{ variationId: a.variationId, quantity: 2 }, { variationId: b.variationId, quantity: 1 }]));
    expect(await lines(u)).toHaveLength(2);
  });

  it('năm batch song song +1 trên món đủ tồn: số lượng đúng 5, một dòng, không mất cộng dồn', async () => {
    const a = await product(10);
    const u = await buyer();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => cart.addItemsBatch(u, [{ variationId: a.variationId, quantity: 1 }], 'pdp')));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await lines(u)).toEqual([{ variationId: a.variationId, quantity: 5 }]);
  });

  it('batch song song với updateItem đặt số lượng tuyệt đối: số lượng cuối là một trong hai thứ tự hợp lệ, vẫn một dòng', async () => {
    const a = await product(50);
    const u = await buyer();
    await cart.addItemsBatch(u, [{ variationId: a.variationId, quantity: 1 }], 'pdp');
    const item = (await prisma.cartItem.findFirstOrThrow({ where: { cart: { userId: u }, variationId: a.variationId } })).id;
    const results = await Promise.allSettled([
      cart.addItemsBatch(u, [{ variationId: a.variationId, quantity: 2 }], 'pdp'),
      cart.updateItem(u, item, 5),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // update trước rồi batch cộng thêm = 7; batch trước rồi update ghi đè = 5. Không có giá trị nào khác (không nhân đôi, không mất batch).
    expect([5, 7]).toContain(await qty(u, a.variationId));
    expect(await lines(u)).toHaveLength(1);
  });

  it('khách chưa có giỏ: batch tạo giỏ và thêm đủ món; số đang có trong giỏ được tính vào tồn ở lần sau', async () => {
    const a = await product(3);
    const b = await product(5);
    const u = await buyer();
    expect(await prisma.cart.findUnique({ where: { userId: u } })).toBeNull();
    await cart.addItemsBatch(u, [{ variationId: a.variationId, quantity: 2 }, { variationId: b.variationId, quantity: 1 }], undefined);
    expect(await lines(u)).toHaveLength(2);
    const err = await cart.addItemsBatch(u, [{ variationId: b.variationId, quantity: 1 }, { variationId: a.variationId, quantity: 2 }], undefined).catch((e: unknown) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({ reason: 'STOCK', variationId: a.variationId });
    expect(await qty(u, b.variationId)).toBe(1);
    expect(await qty(u, a.variationId)).toBe(2);
  });

  it('món hết hàng ở giữa batch: lỗi nêu variationId, không dòng nào vào giỏ', async () => {
    const a = await product(5);
    const gone = await product(0);
    const c = await product(5);
    const u = await buyer();
    const err = await cart
      .addItemsBatch(u, [a, gone, c].map((p) => ({ variationId: p.variationId, quantity: 1 })), 'pdp')
      .catch((e: unknown) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'CART_BATCH_REJECTED', reason: 'STOCK', variationId: gone.variationId, productName: gone.name });
    expect(await lines(u)).toEqual([]);
  });

  it('getCart trả listUnitPrice = giá niêm yết: bằng unitPrice khi không giảm, cao hơn khi có salePrice', async () => {
    const plain = await product(5, 50_000);
    const sale = await product(5, 50_000, 42_000);
    const u = await buyer();
    await cart.addItemsBatch(u, [{ variationId: plain.variationId, quantity: 1 }, { variationId: sale.variationId, quantity: 2 }], 'pdp');
    const view = await cart.getCart(u);
    const byVariation = new Map(view.items.map((l) => [l.variationId, l]));
    expect(byVariation.get(plain.variationId)).toMatchObject({ unitPrice: 50_000, listUnitPrice: 50_000 });
    expect(byVariation.get(sale.variationId)).toMatchObject({ unitPrice: 42_000, listUnitPrice: 50_000 });
  });

  it('listUpcoming: không phiên thấy món sắp diễn ra với reminded=false; khách đã đặt nhắc thấy reminded=true', async () => {
    const a = await product(5, 100_000);
    const u = await buyer();
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: {
        title: 'IT sắp diễn ra', startAt: new Date(now + 3_600_000), endAt: new Date(now + 7_200_000), createdBy: 'it',
        items: { create: [{ variationId: a.variationId, flashPrice: 80_000, quota: 5, perUserLimit: 1 }] },
      },
      include: { items: true },
    });
    flashSaleIds.push(sale.id);
    await flash.setReminder(u, sale.items[0]!.id);
    const mine = (list: Awaited<ReturnType<FlashSaleService['listUpcoming']>>) => list.find((i) => i.variationId === a.variationId);
    expect(mine(await flash.listUpcoming(undefined))).toMatchObject({ itemId: sale.items[0]!.id, reminded: false });
    expect(mine(await flash.listUpcoming(u))).toMatchObject({ itemId: sale.items[0]!.id, reminded: true });
    const other = await buyer();
    expect(mine(await flash.listUpcoming(other))).toMatchObject({ reminded: false });
  });
});
