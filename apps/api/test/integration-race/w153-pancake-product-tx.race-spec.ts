import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogSyncBusyError, PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { randCode, warmPool } from './helpers';

/**
 * W153: các lệnh ghi lên hàng `products` của sản phẩm đã có (update chính + mô tả/nhãn có điều kiện) nằm trong MỘT giao dịch Postgres thật.
 * Mock Prisma không chứng minh được hoàn tác; ở đây lệnh ghi nhãn bị ép ném GIỮA giao dịch (sau khi update chính và lệnh mô tả đã chạy trong
 * giao dịch), rồi đọc lại hàng từ DB: tên, giá gốc, mô tả, nhãn phải còn nguyên, còn biến thể vẫn được đồng bộ giá.
 */
describe('Đồng bộ Pancake ghi hàng sản phẩm trong một giao dịch (real Postgres)', () => {
  const SINCE = '2026-11-14T00:00:00.000Z';
  const PANCAKE_120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';
  let prisma: PrismaService;
  const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      const products = await prisma.product.findMany({ where: { pancakeId: { startsWith: 'w153-' } }, select: { id: true } });
      const productIds = products.map((p) => p.id);
      await prisma.variation.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    await prisma?.$disconnect();
  });

  /** `$transaction` thật, nhưng lệnh `product.updateMany` có `brand` trong `data` ném ở giữa giao dịch. */
  function failBrandInsideTransaction(real: PrismaService): PrismaService {
    const guardedProduct = (model: Prisma.TransactionClient['product']) =>
      new Proxy(model, {
        get(target, prop) {
          if (prop === 'updateMany') {
            return (args: Prisma.ProductUpdateManyArgs) => {
              if (args.data && 'brand' in args.data) throw new Error('mô phỏng: kết nối rớt giữa giao dịch');
              return target.updateMany(args);
            };
          }
          return Reflect.get(target, prop);
        },
      });
    const guardedTx = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          return prop === 'product' ? guardedProduct(value as Prisma.TransactionClient['product']) : value;
        },
      });
    return new Proxy(real, {
      get(target, prop) {
        if (prop === '$transaction') {
          return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) => target.$transaction((tx) => fn(guardedTx(tx)), options as never);
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async function seed() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `w153-p-${tag}`,
        brand: 'Tubu Tree',
        slug: `xit-tram-cho-be-pineboo-150ml-w153-${tag.toLowerCase()}`,
        name: 'Xịt tràm cho bé Pineboo 150ml',
        description: 'Xoài',
        basePrice: 1000,
        categoryIds: ['w153-cat'],
        forSegment: ['MOM_BABY'],
      },
    });
    const variation = await prisma.variation.create({
      data: { pancakeId: `w153-v-${tag}`, productId: product.id, sku: `w153-s-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 1000, stock: 5, pancakeStock: 5 },
    });
    return { tag, product, variation };
  }

  const payload = (tag: string) => ({
    id: `w153-p-${tag}`,
    name: 'Xịt tràm cho bé Pineboo 150ml mới',
    description: PANCAKE_120,
    variations: [{ id: `w153-v-${tag}`, sku: `w153-s-${tag}`, retail_price: 2000, remain_quantity: 5, fields: {}, images: [] }],
  });

  async function sync(db: PrismaService, rows: unknown[]): Promise<number> {
    const client = {
      isConfigured: () => true,
      fetchProducts: jest
        .fn()
        .mockResolvedValueOnce({ success: true, data: rows, total_pages: 1, total_entries: rows.length })
        .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: rows.length }),
    } as unknown as PancakeClient;
    for (let attempt = 0; ; attempt++) {
      try {
        return await new PancakeSyncService(db, client, lifecycle).syncProducts(SINCE);
      } catch (e) {
        if (!(e instanceof CatalogSyncBusyError) || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  it('không lỗi: tên, giá gốc, mô tả và nhãn đổi trọn trong cùng một lượt', async () => {
    const { tag, product } = await seed();
    expect(await sync(prisma, [payload(tag)])).toBe(1);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after).toMatchObject({ name: 'Xịt tràm cho bé Pineboo 150ml mới', basePrice: 2000, description: PANCAKE_120, brand: 'Pineboo' });
  });

  it('lệnh ghi nhãn ném giữa giao dịch: Postgres hoàn tác cả update chính lẫn lệnh mô tả, biến thể vẫn được đồng bộ giá', async () => {
    const { tag, product, variation } = await seed();
    expect(await sync(failBrandInsideTransaction(prisma), [payload(tag)])).toBe(0);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after).toMatchObject({ name: 'Xịt tràm cho bé Pineboo 150ml', basePrice: 1000, description: 'Xoài', brand: 'Tubu Tree' });
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: variation.id } });
    expect(v.retailPrice).toBe(2000);
  });
});
