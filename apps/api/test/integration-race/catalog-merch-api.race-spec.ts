import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * Gói P3a (catalog-api) trên Postgres thật: cột soldApp30d của cron 03:00, sắp "Bán chạy nhất" 30 ngày, thẻ có fulfiller +
 * isLoved, cây danh mục, trang thương hiệu phân trang, Gợi ý liên quan. Mock Prisma không kiểm được groupBy qua quan hệ
 * OrderItem → Order, `hasSome` trên mảng, hay thứ tự thật của DB.
 */
describe('catalog merch API (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const DAY = 864e5;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const categoryIds: string[] = [];
  const brandIds: string[] = [];
  const storefrontIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds }, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma?.$disconnect();
  });

  async function product(brand: string, overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `cma-p-${t}`, brand, slug: `cma-${t.toLowerCase()}`, name: `SP ${t}`, description: 'IT', basePrice: 100_000, ...overrides },
    });
    productIds.push(p.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `cma-v-${t}`, productId: p.id, sku: `CMA-${t}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 5 },
    });
    return { p, v };
  }

  it('best_seller_30d: 30 ngày giảm dần, hoà theo tổng đã bán (gồm số nhập tay), hoà nữa theo id', async () => {
    const brand = `CMA${randCode(6)}`;
    const top = await product(brand, { soldApp30d: 9 });
    const manual = await product(brand, { soldApp30d: 5, soldExternal: 100, soldApp: 10 });
    const app = await product(brand, { soldApp30d: 5, soldApp: 50 });
    const never = await product(brand);
    const r = await catalog.list({ page: 1, limit: 10, sort: 'best_seller_30d', brand });
    expect(r.data.map((c) => c.id)).toEqual([top.p.id, manual.p.id, app.p.id, never.p.id]);
    expect(r.meta.total).toBe(4);
  });

  it('thẻ: isLoved theo ngưỡng mặc định, fulfiller TUBU / MERCHANT / UNAVAILABLE theo gian hàng thật', async () => {
    const brand = `CMA${randCode(6)}`;
    const mkStore = async (ordersPausedAt: Date | null, shippingFee: number | null) => {
      const owner = await createUser(prisma, { role: 'DEALER' });
      userIds.push(owner.id);
      const t = randCode(8).toLowerCase();
      const st = await prisma.storefront.create({
        data: { type: 'MERCHANT', isPartner: true, slug: `cma-${t}`, title: `Shop ${t}`, ownerUserId: owner.id, ordersPausedAt, shippingFee, freeShipFrom: 300_000 },
      });
      storefrontIds.push(st.id);
      return st;
    };
    const open = await mkStore(null, 20_000);
    const paused = await mkStore(new Date(), null);
    const loved = await product(brand, { ratingAvg: 4.8, reviewCount: 20, soldApp: 50 });
    const almost = await product(brand, { ratingAvg: 4.8, reviewCount: 20, soldApp: 49 });
    const merchant = await product(brand, { fulfilment: 'MERCHANT', storefrontId: open.id });
    const closed = await product(brand, { fulfilment: 'MERCHANT', storefrontId: paused.id });

    const r = await catalog.list({ page: 1, limit: 10, brand });
    const by = new Map(r.data.map((c) => [c.id, c]));
    expect(by.get(loved.p.id)).toMatchObject({ isLoved: true, fulfiller: { kind: 'TUBU' } });
    expect(by.get(almost.p.id)!.isLoved).toBe(false);
    expect(by.get(merchant.p.id)!.fulfiller).toEqual({ kind: 'MERCHANT', name: open.title, shippingFee: 20_000, freeShipFrom: 300_000 });
    expect(by.get(closed.p.id)!.fulfiller).toMatchObject({ kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: paused.title });
  });

  describe('soldApp30d (cron 03:00)', () => {
    async function delivered(userId: string, variationId: string, quantity: number, deliveredAt: Date | null, status: 'DELIVERED' | 'RETURNED' = 'DELIVERED') {
      return createOrder(prisma, {
        userId, status, deliveredAt,
        total: quantity * 100_000,
        items: { create: [{ variationId, productName: 'x', variationName: 'x', unitPrice: 100_000, quantity, total: quantity * 100_000 }] },
      });
    }

    it('đơn giao 29 ngày tính, 31 ngày và đơn trả hàng không tính, đơn thiếu deliveredAt chỉ vào tổng; hết đơn thì về 0', async () => {
      const user = await createUser(prisma);
      userIds.push(user.id);
      const { p, v } = await product(`CMA${randCode(6)}`);
      await delivered(user.id, v.id, 3, new Date(Date.now() - 29 * DAY));
      await delivered(user.id, v.id, 5, new Date(Date.now() - 31 * DAY));
      await delivered(user.id, v.id, 7, new Date(Date.now() - 1 * DAY), 'RETURNED');
      await delivered(user.id, v.id, 11, null);

      await catalog.recomputeSoldCounts();
      const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { soldApp: true, soldApp30d: true } });
      expect(after).toEqual({ soldApp: 3 + 5 + 11, soldApp30d: 3 });

      await prisma.order.deleteMany({ where: { userId: user.id, deliveredAt: { gte: new Date(Date.now() - 30 * DAY) } } });
      await catalog.recomputeSoldCounts();
      const reset = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { soldApp30d: true } });
      expect(reset.soldApp30d).toBe(0);
    });
  });
});
