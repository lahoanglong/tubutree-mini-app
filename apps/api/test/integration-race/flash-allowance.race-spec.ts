import { PrismaService } from '../../src/prisma/prisma.service';
import { FlashAllowanceService } from '../../src/modules/flash-sale/flash-allowance.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { priceFlashLine } from '../../src/modules/flash-sale/flash-line-price';
import { createUser, randCode, warmPool } from './helpers';

/** Số suất Giờ vàng theo khách (GET /flash-sales/me/allowance) phải ra đúng số mà giỏ và đặt đơn tính (priceFlashLine). */
describe('Số suất Giờ vàng khách còn mua được (real Postgres)', () => {
  let prisma: PrismaService;
  let flash: FlashSaleService;
  let allowances: FlashAllowanceService;
  const saleIds: string[] = [];
  const STANDING = 35_000;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    flash = new FlashSaleService(prisma, {} as never, {} as never, {} as never);
    allowances = new FlashAllowanceService(prisma, flash);
  });

  afterAll(async () => {
    await prisma.flashSale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma?.$disconnect();
  });

  async function setup(item: { quota: number; soldCount?: number; perUserLimit: number }, window: { startMs: number; endMs: number } = { startMs: -3_600_000, endMs: 3_600_000 }) {
    const tag = randCode(8);
    const product = await prisma.product.create({ data: { pancakeId: `fa-p-${tag}`, brand: 'FA', slug: `fa-${tag.toLowerCase()}`, name: 'Gạo', description: 'IT', basePrice: STANDING } });
    const variation = await prisma.variation.create({
      data: { pancakeId: `fa-v-${tag}`, productId: product.id, sku: `FA-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: STANDING, stock: 50 },
    });
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: {
        title: 'IT Giờ vàng', startAt: new Date(now + window.startMs), endAt: new Date(now + window.endMs), createdBy: 'it',
        items: { create: [{ variationId: variation.id, flashPrice: 26_000, quota: item.quota, soldCount: item.soldCount ?? 0, perUserLimit: item.perUserLimit }] },
      },
      include: { items: true },
    });
    saleIds.push(sale.id);
    return { variationId: variation.id, itemId: sale.items[0]!.id };
  }

  const buy = (userId: string, flashSaleItemId: string, quantity: number) => prisma.flashSalePurchase.create({ data: { flashSaleItemId, userId, quantity } });

  /** Số máy chủ tính cho dòng `qty` của khách: một lần qua đường giỏ/đặt đơn thật. */
  async function serverUnit(userId: string, variationId: string, qty: number) {
    const offer = (await flash.resolveEffective([variationId], new Date(), userId)).get(variationId);
    return priceFlashLine(STANDING, qty, offer).unitPrice;
  }

  it('mỗi khách một số theo đơn đã mua; vượt allowance thì máy chủ tính cả dòng giá thường', async () => {
    const { variationId, itemId } = await setup({ quota: 10, perUserLimit: 3 });
    const a = await createUser(prisma);
    const b = await createUser(prisma);
    const c = await createUser(prisma);
    await buy(a.id, itemId, 2);
    await buy(b.id, itemId, 3);

    const entry = async (userId: string) => (await allowances.forUser(userId, [itemId])).items[itemId];
    expect(await entry(a.id)).toEqual({ perUserLeft: 1, allowance: 1 });
    expect(await entry(b.id)).toEqual({ perUserLeft: 0, allowance: 0 });
    expect(await entry(c.id)).toEqual({ perUserLeft: 3, allowance: 3 });

    for (const [user, allowance] of [[a, 1], [b, 0], [c, 3]] as const) {
      if (allowance > 0) expect(await serverUnit(user.id, variationId, allowance)).toBe(26_000);
      expect(await serverUnit(user.id, variationId, allowance + 1)).toBe(STANDING);
    }
  });

  it('đợt sắp hết suất: allowance bị suất còn lại của đợt chặn, perUserLeft vẫn là của riêng khách', async () => {
    const { variationId, itemId } = await setup({ quota: 10, soldCount: 9, perUserLimit: 3 });
    const c = await createUser(prisma);
    expect((await allowances.forUser(c.id, [itemId])).items[itemId]).toEqual({ perUserLeft: 3, allowance: 1 });
    expect(await serverUnit(c.id, variationId, 1)).toBe(26_000);
    expect(await serverUnit(c.id, variationId, 2)).toBe(STANDING);
  });

  it('suất hết (soldCount = quota), đợt hết giờ, id lạ: vắng mặt, không lỗi', async () => {
    const soldOut = await setup({ quota: 5, soldCount: 5, perUserLimit: 3 });
    const ended = await setup({ quota: 5, perUserLimit: 3 }, { startMs: -7_200_000, endMs: -3_600_000 });
    const c = await createUser(prisma);
    await expect(allowances.forUser(c.id, [soldOut.itemId, ended.itemId, 'khong-ton-tai'])).resolves.toEqual({ items: {} });
  });

  it('chỉ trả số của khách được hỏi, không lẫn số của khách khác trong cùng một suất', async () => {
    const { itemId } = await setup({ quota: 10, perUserLimit: 4 });
    const a = await createUser(prisma);
    const b = await createUser(prisma);
    await buy(a.id, itemId, 4);
    expect((await allowances.forUser(b.id, [itemId])).items[itemId]).toEqual({ perUserLeft: 4, allowance: 4 });
    expect((await allowances.forUser(a.id, [itemId])).items[itemId]).toEqual({ perUserLeft: 0, allowance: 0 });
  });
});
