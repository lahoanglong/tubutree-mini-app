import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { markCardPricesChanged } from '../../src/modules/catalog/card-price-signal';
import { deleteItData, randCode, warmPool } from './helpers';

/**
 * w25-01 trên Postgres thật: danh sách "Đang ưu đãi" nhớ 30 giây và bỏ ngay khi admin lưu Giờ vàng; `rankCache` vẫn nhớ khi bộ lọc
 * `id IN [...]` có hơn 200 id (khoá băm `sha256:v1:`). Mock Prisma không kiểm được hai câu `aggregate` mốc Giờ vàng hay câu SQL thật của
 * bộ lọc 200+ id.
 */
describe('w25-01: "Đang ưu đãi" nhớ 30 giây và rankCache khoá băm (real Postgres)', () => {
  let prisma: PrismaService;
  let flash: FlashSaleService;
  const productIds: string[] = [];
  const flashSaleIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    flash = new FlashSaleService(prisma, new SystemConfigService(prisma), {} as never, {} as never);
  });

  afterAll(async () => {
    await deleteItData(prisma, { productIds, flashSaleIds });
    await prisma?.$disconnect();
  });

  async function product(brand: string, salePrice: number | null = null) {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `osc-p-${t}`, brand, slug: `osc-${t.toLowerCase()}`, name: `SP ${t}`, description: 'IT', basePrice: 100_000 },
    });
    productIds.push(p.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `osc-v-${t}`, productId: p.id, sku: `OSC-${t}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice, stock: 20 },
    });
    return { p, v };
  }

  it('lượt lọc trong 30 giây dùng lại danh sách; admin thêm món, bỏ món, tắt đợt Giờ vàng thì lượt sau đổi ngay', async () => {
    const brand = `OSC${randCode(6)}`;
    const sale = await product(brand, 80_000);
    const later = await product(brand);
    const flashed = await product(brand);
    const catalog = new CatalogService(prisma);
    const ids = async () => (await catalog.list({ page: 1, limit: 10, sort: 'newest', brand, onSale: true })).data.map((c) => c.id).sort();

    expect(await ids()).toEqual([sale.p.id]);
    // Giá ghi thẳng vào DB, không qua nơi nào báo: lượt lọc trong 30 giây vẫn dùng danh sách đã nhớ.
    await prisma.variation.update({ where: { id: later.v.id }, data: { salePrice: 90_000 } });
    expect(await ids()).toEqual([sale.p.id]);

    const now = Date.now();
    const s = await flash.createSale('it-admin', { title: 'IT Giờ vàng', startAt: new Date(now - 60_000).toISOString(), endAt: new Date(now + 3600_000).toISOString() });
    flashSaleIds.push(s.id);
    const item = await flash.addItem(s.id, { variationId: flashed.v.id, flashPrice: 70_000, quota: 5 });
    expect(await ids()).toEqual([sale.p.id, later.p.id, flashed.p.id].sort());

    await flash.removeItem(item.id);
    expect(await ids()).toEqual([sale.p.id, later.p.id].sort());

    await flash.addItem(s.id, { variationId: flashed.v.id, flashPrice: 70_000, quota: 5 });
    expect(await ids()).toEqual([sale.p.id, later.p.id, flashed.p.id].sort());
    await flash.updateSale(s.id, { isActive: false });
    expect(await ids()).toEqual([sale.p.id, later.p.id].sort());
  });

  it('đợt Giờ vàng đang chạy hết giờ thì lượt sau tính lại dù chưa đủ 30 giây', async () => {
    const brand = `OSC${randCode(6)}`;
    const flashed = await product(brand);
    const now = Date.now();
    const s = await flash.createSale('it-admin', { title: 'IT Giờ vàng ngắn', startAt: new Date(now - 60_000).toISOString(), endAt: new Date(now + 1_500).toISOString() });
    flashSaleIds.push(s.id);
    await flash.addItem(s.id, { variationId: flashed.v.id, flashPrice: 70_000, quota: 5 });
    const catalog = new CatalogService(prisma);
    const ids = async () => (await catalog.list({ page: 1, limit: 10, sort: 'newest', brand, onSale: true })).data.map((c) => c.id);

    expect(await ids()).toEqual([flashed.p.id]);
    await new Promise((r) => setTimeout(r, Math.max(0, now + 1_600 - Date.now())));
    expect(await ids()).toEqual([]);
  });

  it('"Bán chạy" + "Đang ưu đãi" với 210 sản phẩm đang giảm giá: thứ hạng được nhớ (khoá sha256:v1), lượt tải trang 2 không quét lại', async () => {
    const brand = `OSC${randCode(6)}`;
    const tag = randCode(6).toLowerCase();
    const rows = await prisma.product.createManyAndReturn({
      data: Array.from({ length: 210 }, (_, i) => ({
        pancakeId: `osc-bulk-${tag}-${i}`,
        brand,
        slug: `osc-bulk-${tag}-${i}`,
        name: `SP bulk ${tag} ${i}`,
        description: 'IT',
        basePrice: 100_000,
        soldApp: i,
      })),
      select: { id: true },
    });
    productIds.push(...rows.map((r) => r.id));
    await prisma.variation.createMany({
      data: rows.map((r, i) => ({
        pancakeId: `osc-bulk-v-${tag}-${i}`,
        productId: r.id,
        sku: `OSC-BULK-${tag}-${i}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        salePrice: 85_000,
        stock: 5,
      })),
    });
    // Dữ liệu ghi thẳng vào DB như một lượt đồng bộ Pancake: báo như PancakeSyncService.
    markCardPricesChanged();

    const catalog = new CatalogService(prisma);
    const findMany = jest.spyOn(prisma.product, 'findMany');
    const rankCalls = () => findMany.mock.calls.filter(([a]) => a?.select && 'soldApp' in a.select && !('slug' in a.select));
    try {
      const page = (n: number) => catalog.list({ page: n, limit: 50, sort: 'best_seller', brand, onSale: true });
      const p1 = await page(1);
      expect(rankCalls()).toHaveLength(1);
      const p2 = await page(2);
      expect(rankCalls()).toHaveLength(1);
      const inIds = (rankCalls()[0]![0]!.where as { AND: { id: { in: string[] } }[] }).AND[0]!.id.in;
      expect(inIds.length).toBeGreaterThanOrEqual(210);

      expect([p1.meta.total, p2.meta.total]).toEqual([210, 210]);
      expect([p1.data.length, p2.data.length]).toEqual([50, 50]);
      expect(p1.data[0]!.id).toBe(rows[209]!.id);
      expect(new Set([...p1.data, ...p2.data].map((c) => c.id)).size).toBe(100);
      const keys = [...(catalog as unknown as { rankCache: Map<string, unknown> }).rankCache.keys()];
      expect(keys.some((k) => /^sha256:v1:[0-9a-f]{64}$/.test(k))).toBe(true);
    } finally {
      findMany.mockRestore();
    }
  });
});
