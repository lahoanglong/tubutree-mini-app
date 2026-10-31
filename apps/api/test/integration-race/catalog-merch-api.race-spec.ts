import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { BrandService } from '../../src/modules/brand/brand.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotFoundException } from '@nestjs/common';
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

  it('danh mục hai tầng: productCount của cha cộng con (mỗi sản phẩm một lần), lọc cha gồm sản phẩm của con', async () => {
    const brand = `CMA${randCode(6)}`;
    const t = randCode(6).toLowerCase();
    const cha = await prisma.category.create({ data: { name: `Cha ${t}`, slug: `cma-cha-${t}`, sortOrder: 9000 } });
    const con = await prisma.category.create({ data: { name: `Con ${t}`, slug: `cma-con-${t}`, parentId: cha.id, sortOrder: 1 } });
    categoryIds.push(cha.id, con.id);
    const both = await product(brand, { categoryIds: [cha.id, con.id] });
    const onlyChild = await product(brand, { categoryIds: [con.id] });
    await product(brand, { categoryIds: [] });
    await product(brand, { categoryIds: [con.id], isActive: false });

    const fresh = new CatalogService(prisma);
    const tree = await fresh.categories();
    const node = tree.find((c) => c.id === cha.id)!;
    expect(node.productCount).toBe(2);
    expect(node.children.map((c) => [c.id, c.productCount])).toEqual([[con.id, 2]]);
    expect(tree.find((c) => c.id === con.id)).toBeUndefined();

    const byParent = await fresh.list({ page: 1, limit: 10, category: cha.id, brand });
    expect(byParent.data.map((c) => c.id).sort()).toEqual([both.p.id, onlyChild.p.id].sort());
    expect(byParent.meta.total).toBe(2);
  });

  it('thương hiệu: phân trang thật trên sản phẩm công khai, chưa duyệt và đã ẩn không tính, productCount khớp total', async () => {
    const t = randCode(6).toLowerCase();
    const brand = await prisma.brand.create({ data: { slug: `cma-${t}`, name: `CMA Nhãn ${t}`, isPublished: true } });
    brandIds.push(brand.id);
    const draft = await prisma.brand.create({ data: { slug: `cma-nhap-${t}`, name: `CMA Nháp ${t}`, isPublished: false } });
    brandIds.push(draft.id);
    for (let i = 0; i < 5; i++) await product(brand.name, { brandId: brand.id });
    await product(brand.name, { brandId: brand.id, approvalStatus: 'PENDING_REVIEW' });
    await product(brand.name, { brandId: brand.id, isActive: false });

    const page = (n: number) => catalog.listBrandProducts(brand.slug, { page: n, limit: 2 });
    const [p1, p2, p3, p4] = [await page(1), await page(2), await page(3), await page(4)];
    expect([p1.data.length, p2.data.length, p3.data.length, p4.data.length]).toEqual([2, 2, 1, 0]);
    expect([p1.meta.total, p4.meta.total]).toEqual([5, 5]);
    const ids = [...p1.data, ...p2.data, ...p3.data].map((c) => c.id);
    expect(new Set(ids).size).toBe(5);

    await expect(catalog.listBrandProducts(draft.slug, { page: 1, limit: 2 })).rejects.toBeInstanceOf(NotFoundException);
    const view = await new BrandService(prisma, new SystemConfigService(prisma)).getPublicBySlug(brand.slug);
    expect(view.productCount).toBe(5);
    expect(view.products).toHaveLength(5);
  });

  it('related: cùng nhãn, loại chính nó, xếp theo tổng đã bán (gồm số nhập tay), tối đa 8', async () => {
    const brand = `CMA${randCode(6)}`;
    const self = await product(brand, { soldApp: 999 });
    const sold = [5, 50, 40, 0, 30, 20, 10, 60, 1, 45];
    const made = [];
    for (const n of sold) made.push(await product(brand, n % 2 ? { soldApp: n } : { soldExternal: n }));
    await product(`${brand}-khac`, { soldApp: 5000 });
    await product(brand, { soldApp: 7000, isActive: false });

    const out = await catalog.related(self.p.slug);
    const expected = made
      .map((m, i) => ({ id: m.p.id, n: sold[i]! }))
      .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))
      .slice(0, 8)
      .map((m) => m.id);
    expect(out.map((c) => c.id)).toEqual(expected);
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
