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
    // Tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — mock nhận (strings, ...values).
    $executeRaw: jest.fn().mockResolvedValue(1),
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
// P0-3 (docs/2026-09-08-review-progress.md + docs/2026-09-11-P0-3-pancake-stock-decision-brief.md):
// sync từng ghi đè TUYỆT ĐỐI `stock` bằng remain_quantity của Pancake, nên một lượt quét mang số
// cũ hơn đơn vừa đặt là hồi sinh hàng đã bán hết (oversell).
//
// Nay cột `stock` không còn được ghi trong `upsert`. Tồn kho đi qua một câu UPDATE nguyên tử
// (catalog/variation-stock.ts) tính theo chênh lệch số Pancake và trừ phần giữ chỗ — đúng cho CẢ
// hai khả năng: Pancake tự trừ tồn khi ta tạo đơn, hoặc không. Nhờ vậy quét toàn bộ lúc boot
// cũng an toàn và không cần chế độ "bỏ qua tồn kho" nữa.
describe('PancakeSyncService — tồn kho không còn ghi đè tuyệt đối', () => {
  const rawSql = (prisma: PrismaService) =>
    (prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw.mock.calls.map((c) => ({
      sql: (c[0] as string[]).join('?'),
      args: c.slice(1),
    }));

  function existingProduct() {
    return makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', pancakeId: 'a' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
      },
    });
  }

  it('upsert KHÔNG còn ghi field stock — kể cả nhánh sync tăng dần', async () => {
    const prisma = existingProduct();
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts(
      '2026-09-12T00:00:00.000Z',
    );
    const call = (prisma.variation.upsert as jest.Mock).mock.calls[0][0];
    expect(call.update).not.toHaveProperty('stock');
    expect(call.update).toMatchObject({ retailPrice: 1000 }); // giá vẫn đồng bộ
  });

  it('variation MỚI lấy tồn kho ban đầu và ghi luôn mốc pancakeStock', async () => {
    const prisma = existingProduct();
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts();
    const call = (prisma.variation.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create).toMatchObject({ stock: 5, pancakeStock: 5 });
  });

  it('quét TOÀN BỘ (không updatedSince) vẫn cập nhật tồn kho — qua công thức an toàn', async () => {
    const prisma = existingProduct();
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts();
    const calls = rawSql(prisma);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1); // một câu lệnh cho mỗi variation, không nhiều hơn
    // Số Pancake và id variation phải được truyền qua tham số, không nội suy vào chuỗi SQL.
    expect(calls[0]!.args).toContain(5);
    expect(calls[0]!.args).toContain('v-a');
    expect(calls[0]!.sql).toContain('reservedStock');
  });

  it('remain_quantity vắng mặt → KHÔNG đụng tồn kho (trước đây ?? 0 xoá sạch tồn)', async () => {
    const prisma = existingProduct();
    const noStock = { ...prod('a'), variations: [{ id: 'v-a', sku: 's', retail_price: 1000, fields: {} }] };
    await new PancakeSyncService(prisma, makeClient([[noStock]]), lifecycle).syncProducts();
    expect(rawSql(prisma)).toHaveLength(0);
  });

  it('onModuleInit gọi sync thường — không còn chế độ bỏ qua tồn kho', async () => {
    const prisma = makePrisma();
    const svc = new PancakeSyncService(prisma, makeClient([[prod('p1')]]), lifecycle);
    const spy = jest.spyOn(svc, 'syncProducts').mockResolvedValue(0);
    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(spy).toHaveBeenCalledWith();
  });

  it('forceStock → đặt lại tuyệt đối và xoá giữ chỗ (lối thoát có chủ đích cho admin)', async () => {
    const prisma = existingProduct();
    await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).syncProducts(undefined, {
      forceStock: true,
    });
    const sql = rawSql(prisma).map((c) => c.sql).join('\n');
    expect(sql).toContain('"reservedStock" = 0');
  });

  it('không dừng phân trang theo giả định page size = 20 (Pancake đổi sang 10 là mất sạch trang sau)', async () => {
    const client = makeClient([[prod('a'), prod('b')], [prod('c')], []]);
    const n = await new PancakeSyncService(makePrisma(), client, lifecycle).syncProducts('2026-09-12T00:00:00.000Z');
    expect(n).toBe(3);
  });

  it('hai lượt sync chồng nhau → lượt sau bỏ qua, không ghi đè lẫn nhau', async () => {
    const prisma = makePrisma();
    const svc = new PancakeSyncService(prisma, makeClient([[prod('a')], []]), lifecycle);
    const [first, second] = await Promise.all([svc.syncProducts(), svc.syncProducts()]);
    expect([first, second].filter((x) => x === 0)).toHaveLength(1);
  });
});
