import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { deleteItData, randCode, warmPool } from './helpers';

/**
 * Tầng trưng bày (`merch-rank.ts`) trên Postgres thật: cờ "có ảnh" tính trong DB (ảnh đại diện rỗng hay mảng ảnh rỗng là chưa có ảnh),
 * hàng hết sạch mọi phân loại đang bán xếp cuối, và không sản phẩm nào bị ẩn. Mock Prisma không kiểm được `not: ''` và `isEmpty` của mảng.
 */
describe('catalog tầng trưng bày (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const productIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds: [], productIds });
    await prisma?.$disconnect();
  });

  async function product(brand: string, name: string, overrides: Partial<Prisma.ProductUncheckedCreateInput>, stocks: Array<{ stock: number; isActive?: boolean }> = [{ stock: 5 }]) {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `cmt-p-${t}`, brand, slug: `cmt-${t.toLowerCase()}`, name, description: 'IT', basePrice: 100_000, ...overrides },
    });
    productIds.push(p.id);
    for (const [i, s] of stocks.entries()) {
      await prisma.variation.create({
        data: { pancakeId: `cmt-v-${t}-${i}`, productId: p.id, sku: `CMT-${t}-${i}`, name: `PL ${i}`, attributes: {}, retailPrice: 100_000, stock: s.stock, isActive: s.isActive ?? true },
      });
    }
    return p.id;
  }

  it('mặc định: có ảnh còn hàng → chưa ảnh → hết sạch; ảnh đại diện rỗng hay mảng ảnh rỗng là chưa ảnh; không ẩn hàng nào; Bán chạy không đổi', async () => {
    const brand = `CMT${randCode(6)}`;
    const imgs = await product(brand, 'Có mảng ảnh', { images: ['https://img.example/a.jpg'], soldApp: 1 });
    const thumb = await product(brand, 'Chỉ ảnh đại diện', { thumbnail: 'https://img.example/t.jpg', soldApp: 2 });
    const blankThumb = await product(brand, 'Ảnh đại diện rỗng', { thumbnail: '', images: [], soldApp: 50 });
    const none = await product(brand, 'Không ảnh', { soldApp: 40 });
    // Phân loại còn hàng nhưng đang tắt không tính: khách không mua được.
    const soldOut = await product(brand, 'Hết sạch', { images: ['https://img.example/s.jpg'], soldApp: 99 }, [{ stock: 0 }, { stock: 9, isActive: false }]);
    const noVariation = await product(brand, 'Không phân loại', { images: ['https://img.example/n.jpg'], soldApp: 98 }, []);

    const def = await catalog.list({ page: 1, limit: 10, brand });
    const ids = def.data.map((c) => c.id);
    expect(def.meta.total).toBe(6);
    expect(new Set(ids.slice(0, 2))).toEqual(new Set([imgs, thumb]));
    expect(new Set(ids.slice(2, 4))).toEqual(new Set([blankThumb, none]));
    expect(new Set(ids.slice(4))).toEqual(new Set([soldOut, noVariation]));

    // Bán chạy giữ đúng lượt bán: thẻ ở đó mang số hạng theo vị trí.
    const best = await catalog.list({ page: 1, limit: 10, sort: 'best_seller', brand });
    expect(best.data.map((c) => c.id)).toEqual([soldOut, noVariation, blankThumb, none, thumb, imgs]);
    expect(best.meta.total).toBe(6);
  });
});
