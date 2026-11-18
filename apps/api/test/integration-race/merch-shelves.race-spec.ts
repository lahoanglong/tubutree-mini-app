import { ConflictException } from '@nestjs/common';
import type { ProductQuery } from '../../src/modules/catalog/dto/product-query.dto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { MerchShelvesService } from '../../src/modules/merch-shelves/merch-shelves.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { PROD_CATALOG_2026_11_12 } from '../../../../packages/app-core/src/commerce/prod-catalog-full.fixture';
import { deleteItData, randCode, warmPool } from './helpers';

/**
 * Xếp kệ (tubu-w4-06) trên Postgres thật: 111 món của catalog PROD 12/11 (64 còn hàng, 47 hết, có/không ảnh như PROD) cộng dữ liệu sẵn có của DB.
 * Mock Prisma không kiểm được thứ tự xếp hạng thật, phân trang qua nhiều trang, khoá advisory giữa hai giao dịch, hay migration trên DB trống.
 */
type Values = Record<string, unknown>;
const cfg = (values: Values) => ({ get: async (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as SystemConfigService;

describe('Xếp kệ (real Postgres)', () => {
  let prisma: PrismaService;
  const t = randCode(6).toLowerCase();
  const brand = `MSR${t.toUpperCase()}`;
  const productIds: string[] = [];
  const categoryIds: string[] = [];
  const shelfKeys: string[] = [];
  let root: { id: string; slug: string };
  let child: { id: string; slug: string };
  let race: { id: string; slug: string };
  const ADMIN_A = `msr-admin-a-${t}`;
  const ADMIN_B = `msr-admin-b-${t}`;

  const onValues: Values = { 'merch.shelves_enabled': true };
  const base = () => new CatalogService(prisma);
  const off = () => new CatalogService(prisma, cfg({ 'merch.shelves_enabled': false }));
  const on = () => new CatalogService(prisma, cfg(onValues));

  /** Mọi id theo thứ tự qua từng trang 20 món. */
  async function allIds(svc: CatalogService, q: Partial<ProductQuery>) {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const r = await svc.list({ ...q, page, limit: 20 });
      ids.push(...r.data.map((c) => c.id));
      if (page * 20 >= r.meta.total || r.data.length === 0) return { ids, total: r.meta.total };
    }
  }

  const fixtureId = (i: number) => `msr-${t}-${String(i).padStart(3, '0')}`;
  const rows = PROD_CATALOG_2026_11_12.map((r, i) => ({ ...r, id: fixtureId(i) }));
  const priceOf = (id: string) => 100_000 + rows.findIndex((r) => r.id === id) * 1_000;
  /** Danh mục của món theo vị trí: 0 → gốc, 1 → con (lọc theo gốc vẫn gồm), 2 → không danh mục. */
  const slotOf = (id: string) => rows.findIndex((r) => r.id === id) % 3;
  const withImage = rows.filter((r) => r.thumbnail && r.inStock);
  const outOfStock = rows.find((r) => r.thumbnail && !r.inStock)!;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    root = await prisma.category.create({ data: { name: `Kệ gốc ${t}`, slug: `msr-goc-${t}`, sortOrder: 9100 } });
    child = await prisma.category.create({ data: { name: `Kệ con ${t}`, slug: `msr-con-${t}`, parentId: root.id, sortOrder: 1 } });
    race = await prisma.category.create({ data: { name: `Kệ đua ${t}`, slug: `msr-dua-${t}`, sortOrder: 9101 } });
    categoryIds.push(root.id, child.id, race.id);
    await prisma.product.createMany({
      data: rows.map((r, i) => ({
        id: r.id,
        pancakeId: `msr-p-${t}-${i}`,
        brand,
        slug: `${r.slug}-msr-${t}`,
        name: r.name,
        description: 'IT',
        shortDesc: i % 4 === 0 ? null : 'Mô tả ngắn',
        images: r.thumbnail ? [r.thumbnail] : [],
        categoryIds: i % 3 === 0 ? [root.id] : i % 3 === 1 ? [child.id] : [],
        basePrice: 100_000 + i * 1_000,
      })),
    });
    productIds.push(...rows.map((r) => r.id));
    await prisma.variation.createMany({
      data: rows.map((r, i) => ({
        pancakeId: `msr-v-${t}-${i}`,
        productId: r.id,
        sku: `MSR-${t}-${i}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000 + i * 1_000,
        stock: r.inStock ? 5 : 0,
      })),
    });
  });

  afterAll(async () => {
    await prisma.userAdminEvent.deleteMany({ where: { kind: 'MERCH_SHELF', userId: { in: [ADMIN_A, ADMIN_B] } } });
    await prisma.merchShelfPin.deleteMany({ where: { shelfKey: { in: shelfKeys } } });
    await deleteItData(prisma, { productIds });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds }, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma?.$disconnect();
  });

  async function savePins(svc: MerchShelvesService, key: string, pins: { productId: string; startsAt?: string; endsAt?: string }[], admin = ADMIN_A) {
    if (!shelfKeys.includes(key)) shelfKeys.push(key);
    const { version } = await svc.getShelf(key);
    return svc.save({ key, version, pins }, admin);
  }

  it('migration trên DB trống đã nạp ba khoá cấu hình, cờ TẮT', async () => {
    const cfgRows = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'merch.' } }, orderBy: { key: 'asc' } });
    expect(cfgRows.map((r) => [r.key, r.value])).toEqual([
      ['merch.best_seller_min_products', 6],
      ['merch.best_seller_min_sold', 3],
      ['merch.shelves_enabled', false],
    ]);
  });

  it('cờ tắt, hoặc bật mà chưa ghim món nào: từng id và thứ tự trùng với khi chưa có Xếp kệ, cờ tắt không đọc bảng ghim', async () => {
    const queries: Partial<ProductQuery>[] = [
      {},
      { seed: '20261118' },
      { inStock: true },
      { maxPrice: 150_000 },
      { sort: 'best_seller_30d' },
      { sort: 'best_seller' },
      { sort: 'newest' },
      { brand },
      { category: root.id },
      { category: child.id },
    ];
    const spy = jest.spyOn(prisma.merchShelfPin, 'findMany');
    for (const q of queries) {
      expect(await allIds(off(), q)).toEqual(await allIds(base(), q));
    }
    expect(spy).not.toHaveBeenCalled();
    for (const q of queries) {
      expect(await allIds(on(), q)).toEqual(await allIds(base(), q));
    }
    // Spy gắn thật: cờ bật thì có đọc bảng ghim (kệ trống).
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('ghim Trang chủ: món đang bán, còn hàng, trong khung giờ đứng đầu theo thứ tự ghim; hết hàng/hết giờ/chưa tới giờ rơi; phân trang không lặp, không sót', async () => {
    const catalog = on();
    const svc = new MerchShelvesService(prisma, catalog);
    const [g1, g2, g3, gExpired, gLater] = withImage.slice(0, 5).map((r) => r.id);
    const hour = 3_600_000;
    await savePins(svc, 'home_featured', [
      { productId: g3! },
      { productId: outOfStock.id },
      { productId: gExpired!, endsAt: new Date(Date.now() - hour).toISOString() },
      { productId: g1! },
      { productId: gLater!, startsAt: new Date(Date.now() + hour).toISOString() },
      { productId: g2! },
    ]);
    for (const q of [{}, { seed: '20261118' }]) {
      const before = await allIds(base(), q);
      const after = await allIds(catalog, q);
      expect(after.total).toBe(before.total);
      expect(new Set(after.ids).size).toBe(after.ids.length);
      expect([...after.ids].sort()).toEqual([...before.ids].sort());
      expect(after.ids.slice(0, 3)).toEqual([g3, g1, g2]);
      expect(after.ids.slice(3)).toEqual(before.ids.filter((id) => ![g1, g2, g3].includes(id)));
    }

    // Bộ lọc của khách vẫn áp lên món ghim: món ghim ngoài khoảng giá không hiện, món ghim còn lại vẫn đứng đầu.
    const cheap = await allIds(catalog, { maxPrice: priceOf(g3!) - 1 });
    expect(cheap.ids).not.toContain(g3);
    expect(cheap.ids.slice(0, 2)).toEqual([g1, g2]);
    expect(cheap.total).toBe((await allIds(base(), { maxPrice: priceOf(g3!) - 1 })).total);

    // Sắp xếp khách chọn, lọc nhãn: không ghép kệ.
    for (const q of [{ sort: 'newest' as const }, { brand }, { sort: 'best_seller' as const }]) {
      expect(await allIds(catalog, q)).toEqual(await allIds(base(), q));
    }
  });

  it('ghim đầu danh mục: chỉ món thuộc danh mục (gồm danh mục con) được đưa lên; món ngoài danh mục không lọt vào', async () => {
    const catalog = on();
    const svc = new MerchShelvesService(prisma, catalog);
    const inRoot = withImage.filter((r) => slotOf(r.id) === 0).map((r) => r.id);
    const inChild = withImage.filter((r) => slotOf(r.id) === 1).map((r) => r.id);
    const outside = withImage.filter((r) => slotOf(r.id) === 2).map((r) => r.id);
    await savePins(svc, `category:${root.slug}`, [{ productId: inChild[0]! }, { productId: outside[0]! }, { productId: inRoot[0]! }]);
    const before = await allIds(base(), { category: root.id });
    const after = await allIds(catalog, { category: root.id });
    expect(after.total).toBe(before.total);
    expect(after.ids.slice(0, 2)).toEqual([inChild[0], inRoot[0]]);
    expect(after.ids).not.toContain(outside[0]);
    expect(after.ids.slice(2)).toEqual(before.ids.filter((id) => id !== inChild[0] && id !== inRoot[0]));
    // Kệ của danh mục cha không áp cho trang danh mục con.
    expect(await allIds(catalog, { category: child.id })).toEqual(await allIds(base(), { category: child.id }));
  });

  it('lưu kệ xoá bộ nhớ ngay trên instance nhận lệnh (không chờ 60 giây)', async () => {
    const catalog = on();
    const svc = new MerchShelvesService(prisma, catalog);
    const [a, b] = withImage.slice(5, 7).map((r) => r.id);
    await savePins(svc, 'home_featured', [{ productId: a! }]);
    expect((await catalog.list({ page: 1, limit: 5 })).data[0]!.id).toBe(a);
    await savePins(svc, 'home_featured', [{ productId: b! }, { productId: a! }]);
    expect((await catalog.list({ page: 1, limit: 5 })).data.slice(0, 2).map((c) => c.id)).toEqual([b, a]);
  });

  it('Bán chạy nhất: chưa đủ số bán và có ghim thì món ghim đứng đầu (đánh dấu curated) rồi tới xếp hạng thường; đủ số thì về xếp hạng thật', async () => {
    const minSold = 3;
    const already = await prisma.product.count({ where: { isActive: true, approvalStatus: 'APPROVED', soldApp30d: { gte: minSold } } });
    onValues['merch.best_seller_min_products'] = already + 2;
    onValues['merch.best_seller_min_sold'] = minSold;
    const catalog = on();
    const svc = new MerchShelvesService(prisma, catalog);
    const [s1, s2, p1, p2] = withImage.slice(8, 12).map((r) => r.id);
    await prisma.product.update({ where: { id: s1! }, data: { soldApp30d: 5 } });

    // Chưa ghim kệ best_sellers: giữ nguyên hành vi cũ dù chưa đủ số.
    catalog.invalidateMerchShelves();
    expect(await allIds(catalog, { sort: 'best_seller_30d' })).toEqual(await allIds(base(), { sort: 'best_seller_30d' }));

    await savePins(svc, 'best_sellers', [{ productId: p2! }, { productId: outOfStock.id }, { productId: p1! }]);
    expect(await catalog.merchStatus()).toEqual({ enabled: true, curated: true });
    const marked = (r: { data: { id: string }[] }) => r.data.filter((c) => (c as { curated?: boolean }).curated === true).map((c) => c.id);
    const curated = await catalog.list({ page: 1, limit: 10, sort: 'best_seller_30d' });
    expect(curated.data.slice(0, 2).map((c) => c.id)).toEqual([p2, p1]);
    expect(marked(curated)).toEqual([p2, p1]);
    // Sau món ghim là bảng thường (bỏ món đã đứng đầu), tổng không đổi: nơi khác dùng chung danh sách (Mua xoay vòng, Story) chỉ thấy thứ tự đổi.
    const organic = await allIds(base(), { sort: 'best_seller_30d' });
    expect(await allIds(catalog, { sort: 'best_seller_30d' })).toEqual({
      ids: [p2!, p1!, ...organic.ids.filter((id) => id !== p1 && id !== p2)],
      total: organic.total,
    });
    expect(marked(await catalog.list({ page: 2, limit: 10, sort: 'best_seller_30d' }))).toEqual([]);
    // Lọc danh mục vẫn áp: món ghim ngoài danh mục không hiện và không mang dấu.
    const scoped = await catalog.list({ page: 1, limit: 10, sort: 'best_seller_30d', category: root.id });
    expect(marked(scoped)).toEqual([p2!, p1!].filter((id) => slotOf(id) !== 2));

    // Đạt ngưỡng: đúng mốc thì chuyển về xếp hạng thật, không còn dấu curated.
    await prisma.product.update({ where: { id: s2! }, data: { soldApp30d: 5 } });
    catalog.invalidateMerchShelves();
    expect(await catalog.merchStatus()).toEqual({ enabled: true, curated: false });
    expect(await allIds(catalog, { sort: 'best_seller_30d' })).toEqual(await allIds(base(), { sort: 'best_seller_30d' }));
    const first = await catalog.list({ page: 1, limit: 10, sort: 'best_seller_30d' });
    expect(first.data.some((c) => 'curated' in c)).toBe(false);
    await prisma.product.updateMany({ where: { id: { in: [s1!, s2!] } }, data: { soldApp30d: 0 } });
  });

  it('hai admin lưu cùng một kệ cùng lúc: đúng một người thắng, người kia nhận 409, không ghi đè, một dòng nhật ký', async () => {
    const svc = new MerchShelvesService(prisma, on());
    const key = `category:${race.slug}`;
    shelfKeys.push(key);
    const [a, b, c] = withImage.slice(12, 15).map((r) => r.id);
    const events = () => prisma.userAdminEvent.findMany({ where: { kind: 'MERCH_SHELF', reason: `shelf:${key}` }, orderBy: { createdAt: 'asc' } });
    for (let round = 0; round < 5; round++) {
      const { version } = await svc.getShelf(key);
      const eventsBefore = (await events()).length;
      const pinsA = [{ productId: a! }, { productId: round % 2 ? b! : c! }];
      const pinsB = [{ productId: c! }];
      const results = await Promise.allSettled([svc.save({ key, version, pins: pinsA }, ADMIN_A), svc.save({ key, version, pins: pinsB }, ADMIN_B)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const won = results.findIndex((r) => r.status === 'fulfilled');
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      const stored = await prisma.merchShelfPin.findMany({ where: { shelfKey: key }, orderBy: { position: 'asc' }, select: { productId: true } });
      expect(stored.map((s) => s.productId)).toEqual((won === 0 ? pinsA : pinsB).map((p) => p.productId));
      const after = await events();
      expect(after).toHaveLength(eventsBefore + 1);
      expect(after.at(-1)!.actorId).toBe(won === 0 ? ADMIN_A : ADMIN_B);
    }
  });
});
