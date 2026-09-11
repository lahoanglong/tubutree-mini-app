import { PancakeSyncService } from './pancake-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';

const notifyPriceDrop = jest.fn().mockResolvedValue(undefined);
const lifecycle = { notifyWishlistPriceDrop: notifyPriceDrop } as unknown as LifecycleService;
beforeEach(() => notifyPriceDrop.mockClear());

function makeClient(pages: unknown[][], configured = true): PancakeClient {
  let call = 0;
  return {
    isConfigured: () => configured,
    fetchProducts: jest.fn(async () => {
      const data = pages[call] ?? [];
      call++;
      return { data };
    }),
  } as unknown as PancakeClient;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    product: {
      findUnique: jest.fn().mockResolvedValue(null), // mặc định: tạo mới
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: `prod-${data.pancakeId}`, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'existing', ...data })),
    },
    variation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null), // mặc định: chưa có giá cũ → không drop
    },
    wishlist: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

// Pancake POS trả product với field `id` (KHÔNG phải product_id) — phản ánh API thật.
const prod = (id: string, name = 'Tinh dầu') => ({
  id,
  name,
  variations: [
    { id: `v-${id}`, sku: 's', retail_price: 1000, remain_quantity: 5, fields: { size: '10ml' }, images: [`https://img/${id}.jpg`] },
  ],
});

describe('PancakeSyncService.syncProducts', () => {
  it('chưa cấu hình → trả 0, không fetch', async () => {
    const client = makeClient([], false);
    const n = await new PancakeSyncService(makePrisma(), client, lifecycle).syncProducts();
    expect(n).toBe(0);
    expect(client.fetchProducts).not.toHaveBeenCalled();
  });

  it('upsert hết sản phẩm 1 trang ngắn → dừng', async () => {
    const prisma = makePrisma();
    const n = await new PancakeSyncService(prisma, makeClient([[prod("a"), prod("b")]]), lifecycle).syncProducts();
    expect(n).toBe(2);
    expect((prisma as unknown as { product: { create: jest.Mock } }).product.create).toHaveBeenCalledTimes(2);
    expect((prisma as unknown as { variation: { upsert: jest.Mock } }).variation.upsert).toHaveBeenCalledTimes(2);
  });

  it('cô lập lỗi từng sản phẩm — 1 SP hỏng không làm hỏng cả batch', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => {
          if (data.pancakeId === 'bad') throw Object.assign(new Error('slug trùng'), { code: 'P2002' });
          return { id: `prod-${data.pancakeId}`, ...data };
        }),
        update: jest.fn(),
      },
    });
    const n = await new PancakeSyncService(prisma, makeClient([[prod("bad"), prod("good")]]), lifecycle).syncProducts();
    expect(n).toBe(1); // chỉ 'good' thành công, 'bad' bị bỏ qua chứ không ném
  });

  it('SP đã tồn tại → update KHÔNG đụng slug/brand (giữ trường Tubu tự quản)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'existing' });
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 'cu-slug', brand: 'Tubu Tree' }),
        create: jest.fn(),
        update,
      },
    });
    await new PancakeSyncService(prisma, makeClient([[prod("a")]]), lifecycle).syncProducts();
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('slug');
    expect(data).not.toHaveProperty('brand');
    expect(data.name).toBe('Tinh dầu');
  });

  it('giá biến thể GIẢM → báo wishlist (Price Drop Alert §6.14.10)', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 's', brand: 'b' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
      },
      variation: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ retailPrice: 2000, salePrice: null }), // giá cũ 2000 > mới 1000
      },
      wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts();
    expect(notifyPriceDrop).toHaveBeenCalledWith('existing', 'Tinh dầu');
  });

  it('giá KHÔNG giảm (tăng/bằng) → không báo', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 's', brand: 'b' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
      },
      variation: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ retailPrice: 500, salePrice: null }), // giá cũ 500 < mới 1000
      },
      wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts();
    expect(notifyPriceDrop).not.toHaveBeenCalled();
  });
});

describe('PancakeSyncService.slugify', () => {
  const slug = (name: string, suffix: string) =>
    (new PancakeSyncService(makePrisma(), makeClient([]), lifecycle) as unknown as {
      slugify(n: string, s: string): string;
    }).slugify(name, suffix);

  it('bỏ dấu tiếng Việt + đ→d + suffix 6 ký tự cuối', () => {
    expect(slug('Tinh Dầu Tràm', 'abcdef123456')).toBe('tinh-dau-tram-123456');
    expect(slug('Đậu Đỏ', 'XYZ999')).toBe('dau-do-xyz999');
  });
});

// P0-3 (docs/2026-09-08-review-progress.md): sync ghi đè TUYỆT ĐỐI `stock` bằng
// remain_quantity của Pancake. Nguy hiểm nhất là cú quét TOÀN BỘ catalog lúc boot
// (onModuleInit, không có updatedSince): mỗi lần restart/deploy là đè lại tồn kho của MỌI
// sản phẩm — kể cả sản phẩm Pancake không hề đụng tới nhiều tháng, và kể cả khi đơn cục bộ
// vừa trừ kho mà Pancake chưa kịp phản ánh → hồi sinh hàng đã bán hết (oversell).
// Sửa an toàn (KHÔNG phụ thuộc câu hỏi chưa chốt "Pancake có tự trừ tồn khi tạo đơn không"):
// lần quét lúc boot chỉ đồng bộ giá/metadata, KHÔNG đụng cột stock. Biến thể tăng dần 15 phút
// (updatedSince, phạm vi hẹp hơn nhiều) và webhook vẫn cập nhật tồn kho như cũ.
describe('PancakeSyncService — quét toàn bộ lúc boot không ghi đè tồn kho', () => {
  it('syncProducts({ skipStock: true }) → update variation KHÔNG chứa field stock', async () => {
    const prisma = makePrisma();
    (prisma.variation.findUnique as jest.Mock).mockResolvedValue({ retailPrice: 1000, salePrice: null });
    await new PancakeSyncService(prisma, makeClient([[prod('p1')]]), lifecycle).syncProducts(undefined, {
      skipStock: true,
    });
    const call = (prisma.variation.upsert as jest.Mock).mock.calls[0][0];
    expect(call.update).not.toHaveProperty('stock');
    // Vẫn phải đồng bộ giá như thường.
    expect(call.update).toMatchObject({ retailPrice: 1000 });
    // Variation MỚI vẫn cần stock ban đầu (chưa từng có đơn cục bộ nào để mất).
    expect(call.create).toMatchObject({ stock: 5 });
  });

  it('sync định kỳ (mặc định) vẫn ghi stock như cũ', async () => {
    const prisma = makePrisma();
    await new PancakeSyncService(prisma, makeClient([[prod('p1')]]), lifecycle).syncProducts('2026-09-11T00:00:00Z');
    expect((prisma.variation.upsert as jest.Mock).mock.calls[0][0].update).toMatchObject({ stock: 5 });
  });

  it('onModuleInit → gọi sync ở chế độ skipStock (bảo vệ tồn kho khi restart/deploy)', async () => {
    const prisma = makePrisma();
    const svc = new PancakeSyncService(prisma, makeClient([[prod('p1')]]), lifecycle);
    const spy = jest.spyOn(svc, 'syncProducts').mockResolvedValue(0);
    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(spy).toHaveBeenCalledWith(undefined, { skipStock: true });
  });
});
