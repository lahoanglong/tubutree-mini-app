import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { randCode, warmPool } from './helpers';

/** Thứ tự phân loại ổn định: không phụ thuộc thứ tự vật lý của bảng variations (UPDATE không đổi giá trị cũng làm đổi). */
describe('Thứ tự phân loại sản phẩm (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function product() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `itvo-p-${tag}`, brand: `ITVO${tag}`, slug: `itvo-${tag.toLowerCase()}`, name: `Serum ${tag}`, description: 'IT', basePrice: 289_000 },
    });
    const mk = (suffix: string, name: string, retailPrice: number, salePrice: number | null = null) =>
      prisma.variation.create({
        data: { pancakeId: `itvo-v-${tag}-${suffix}`, productId: p.id, sku: `ITVO-${tag}-${suffix}`, name, attributes: {}, retailPrice, salePrice, stock: 5 },
      });
    const v50 = await mk('50', '50ml', 460_000);
    const v30 = await mk('30', '30ml', 289_000);
    const v100 = await mk('100', '100ml', 700_000, 250_000);
    return { p, tag, v50, v30, v100 };
  }

  const touch = (sku: string) => prisma.$executeRaw`UPDATE variations SET stock = stock WHERE sku = ${sku}`;

  it('PDP: phân loại xếp theo giá đang bán tăng dần, đổi thứ tự vật lý không đổi kết quả', async () => {
    const { p, v50, v30, v100 } = await product();
    const read = async () => (await catalog.getBySlug(p.slug)).variations.map((v) => v.sku);
    const expected = [v100.sku, v30.sku, v50.sku];
    expect(await read()).toEqual(expected);
    for (const sku of [v30.sku, v100.sku, v50.sku, v30.sku]) {
      await touch(sku);
      expect(await read()).toEqual(expected);
    }
  });

  it('PDP: phân loại đầu tiên là phân loại có giá "từ" của sản phẩm', async () => {
    const { p, v30, v100 } = await product();
    await prisma.variation.update({ where: { id: v100.id }, data: { isActive: false } });
    await touch(v30.sku);
    const detail = await catalog.getBySlug(p.slug);
    const first = detail.variations[0]!;
    expect(first.sku).toBe(v30.sku);
    expect(first.salePrice ?? first.retailPrice).toBe(p.basePrice);
  });
});
