import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { randCode, warmPool } from './helpers';

/** Giá thẻ có Giờ vàng (dữ liệu kiểu Pancake: giá chỉ nằm ở phân loại) khi sắp, lọc giá và liệt kê suất đang chạy. */
describe('Giá thẻ có Giờ vàng khi sắp và lọc (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  let flash: FlashSaleService;
  const saleIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    catalog = new CatalogService(prisma);
    flash = new FlashSaleService(prisma, {} as never, {} as never, {} as never);
  });

  afterAll(async () => {
    await prisma.flashSale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma?.$disconnect();
  });

  async function product(brand: string, name: string, vars: { sku: string; name: string; retailPrice: number }[]) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `fcp-p-${tag}`, brand, slug: `fcp-${tag.toLowerCase()}`, name, description: 'IT', basePrice: vars[0]!.retailPrice },
    });
    const created = [];
    for (const v of vars) {
      created.push(
        await prisma.variation.create({
          data: { pancakeId: `fcp-v-${tag}-${v.sku}`, productId: p.id, sku: `FCP-${tag}-${v.sku}`, name: v.name, attributes: {}, retailPrice: v.retailPrice, stock: 5 },
        }),
      );
    }
    return { p, vars: created };
  }

  async function sale(items: { variationId: string; flashPrice: number }[]) {
    const now = Date.now();
    const s = await prisma.flashSale.create({
      data: {
        title: 'IT Giờ vàng', startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it',
        items: { create: items.map((i) => ({ ...i, quota: 10, perUserLimit: 2 })) },
      },
    });
    saleIds.push(s.id);
  }

  it('hai suất cùng sản phẩm: thẻ theo suất thắng, lọc "dưới 125k" và "giá tăng dần" khớp, listActive có thứ tự và tên phân loại', async () => {
    const brand = `FCP${randCode(6)}`;
    const rice = await product(brand, 'Gạo', [{ sku: '1KG', name: '1kg', retailPrice: 300_000 }, { sku: '500', name: '500g', retailPrice: 150_000 }]);
    const other = await product(brand, 'Hạt điều', [{ sku: 'A', name: 'Mặc định', retailPrice: 130_000 }]);
    const cheap = await product(brand, 'Mè', [{ sku: 'A', name: 'Mặc định', retailPrice: 110_000 }]);
    const [kg, g500] = rice.vars as [typeof rice.vars[number], typeof rice.vars[number]];
    await sale([{ variationId: kg.id, flashPrice: 250_000 }, { variationId: g500.id, flashPrice: 120_000 }]);

    const asc = await catalog.list({ page: 1, limit: 10, sort: 'price_asc', brand });
    expect(asc.data.map((c) => c.id)).toEqual([cheap.p.id, rice.p.id, other.p.id]);

    const under = await catalog.list({ page: 1, limit: 10, sort: 'newest', brand, maxPrice: 125_000 });
    expect(under.data.map((c) => c.id).sort()).toEqual([cheap.p.id, rice.p.id].sort());
    expect(under.meta.total).toBe(2);

    const active = (await flash.listActive()).filter((i) => i.productSlug === rice.p.slug);
    expect(active.map((i) => [i.variationId, i.variationName])).toEqual([[g500.id, '500g'], [kg.id, '1kg']]);
  });
});
