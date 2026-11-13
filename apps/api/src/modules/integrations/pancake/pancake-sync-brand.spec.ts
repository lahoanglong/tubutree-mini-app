import type { PrismaService } from '../../../prisma/prisma.service';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';
import { PROD_CATALOG_2026_11_12 as ALL } from '../../../../../../packages/app-core/src/commerce/prod-catalog-full.fixture';
import { PancakeSyncService } from './pancake-sync.service';
import type { PancakeClient } from './pancake.client';

const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;

function makeClient(pages: unknown[][]): PancakeClient {
  let call = 0;
  const filled = pages.filter((p) => p.length > 0);
  return {
    isConfigured: () => true,
    fetchProducts: jest.fn(async () => {
      const data = pages[call] ?? [];
      call++;
      return { success: true, data, total_pages: filled.length, total_entries: filled.flat().length };
    }),
  } as unknown as PancakeClient;
}

type Existing = { id: string; slug: string; brand: string; description: string; images: string[]; thumbnail: string | null; basePrice: number; pancakeHold: null; categoryIds: string[]; forSegment: string[] };

function makePrisma(existing: Existing | null = null) {
  const product = {
    findUnique: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation(async ({ data }) => ({ id: `prod-${data.pancakeId}`, ...data })),
    update: jest.fn().mockImplementation(async ({ data }) => ({ id: existing?.id ?? 'x', ...data })),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    product,
    variation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ holder: 'this-run' }]),
  };
  return { prisma: prisma as unknown as PrismaService, product };
}

const pancakeProduct = (id: string, name: string) => ({
  id,
  name,
  variations: [{ id: `v-${id}`, sku: 's', retail_price: 1000, remain_quantity: 5, fields: { size: '10ml' }, images: [`https://img/${id}.jpg`] }],
});

const existingRow = (over: Partial<Existing> = {}): Existing => ({
  id: 'existing',
  slug: 'xit-tram-cho-be-pineboo-150ml-b70d1d',
  brand: 'Tubu Tree',
  description: '',
  images: ['https://img/a.jpg'],
  thumbnail: 'https://img/a.jpg',
  basePrice: 1000,
  pancakeHold: null,
  categoryIds: ['c1'],
  forSegment: ['MOM_BABY'],
  ...over,
});

const brandWrites = (product: { updateMany: jest.Mock }) =>
  product.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }).filter((a) => 'brand' in a.data);

describe('PancakeSyncService — thương hiệu suy từ tên sản phẩm', () => {
  it('sản phẩm mới có tên nhãn → tạo với brand là nhãn đó, không còn "Tubu Tree"', async () => {
    const { prisma, product } = makePrisma();
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Xịt tràm cho bé Pineboo 150ml')]]), lifecycle).syncProducts();
    expect(product.create).toHaveBeenCalledWith({ data: expect.objectContaining({ brand: 'Pineboo' }) });
  });

  it('sản phẩm mới không có tên nhãn → "Tubu Tree" như trước', async () => {
    const { prisma, product } = makePrisma();
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Cà phê muối túi 50x16g')]]), lifecycle).syncProducts();
    expect(product.create).toHaveBeenCalledWith({ data: expect.objectContaining({ brand: 'Tubu Tree' }) });
  });

  it('đồng bộ cả 111 SKU PROD → đúng số sản phẩm mới theo từng nhãn', async () => {
    const { prisma, product } = makePrisma();
    const pages: unknown[][] = [];
    ALL.forEach((r, i) => {
      if (i % 50 === 0) pages.push([]);
      pages[pages.length - 1]!.push(pancakeProduct(`id-${i}`, r.name));
    });
    expect(await new PancakeSyncService(prisma, makeClient(pages), lifecycle).syncProducts()).toBe(111);
    const created = product.create.mock.calls.map((c) => (c[0] as { data: { brand: string } }).data.brand);
    const tally: Record<string, number> = {};
    for (const b of created) tally[b] = (tally[b] ?? 0) + 1;
    expect(tally).toEqual({ Fuwa3e: 44, 'Pơ Lang': 14, 'BH.Nong': 12, Sokfram: 10, Visante: 7, Hector: 7, Pineboo: 6, 'Le Plateau Coffee': 2, 'Tubu Tree': 9 });
  });

  it('sản phẩm cũ còn "Tubu Tree" → ghi nhãn suy được, có điều kiện "vẫn chưa có nhãn thật"', async () => {
    const { prisma, product } = makePrisma(existingRow());
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Xịt tràm cho bé Pineboo 150ml')]]), lifecycle).syncProducts();
    expect(brandWrites(product)).toEqual([{ where: { id: 'existing', brand: { in: ['', 'Tubu Tree'] } }, data: { brand: 'Pineboo' } }]);
    // Lệnh cập nhật chung không đụng tới brand.
    expect((product.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data).not.toHaveProperty('brand');
  });

  it('sản phẩm cũ có brand rỗng cũng được suy', async () => {
    const { prisma, product } = makePrisma(existingRow({ brand: '' }));
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Dầu gội thảo dược PƠ LANG 300g')]]), lifecycle).syncProducts();
    expect(brandWrites(product)).toEqual([{ where: { id: 'existing', brand: { in: ['', 'Tubu Tree'] } }, data: { brand: 'Pơ Lang' } }]);
  });

  it('nhãn Admin đã gán thì KHÔNG ghi đè, kể cả khi tên nói nhãn khác', async () => {
    const { prisma, product } = makePrisma(existingRow({ brand: 'Fuwa3e' }));
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Xịt tràm cho bé Pineboo 150ml')]]), lifecycle).syncProducts();
    expect(brandWrites(product)).toEqual([]);
    expect((product.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data).not.toHaveProperty('brand');
  });

  it('sản phẩm cũ mà tên không nói nhãn nào thì không ghi gì vào brand', async () => {
    const { prisma, product } = makePrisma(existingRow({ slug: 'ca-phe-muoi-tui-50x16g-9fbabb' }));
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Cà phê muối túi 50x16g')]]), lifecycle).syncProducts();
    expect(brandWrites(product)).toEqual([]);
  });

  it('đổi tên ở Pancake không làm mất nhãn đã ghi: brand đã là nhãn thật thì giữ', async () => {
    const { prisma, product } = makePrisma(existingRow({ brand: 'Pineboo' }));
    await new PancakeSyncService(prisma, makeClient([[pancakeProduct('a', 'Xịt tràm cho bé 150ml')]]), lifecycle).syncProducts();
    expect(brandWrites(product)).toEqual([]);
  });
});
