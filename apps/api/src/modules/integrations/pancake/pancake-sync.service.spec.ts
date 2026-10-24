import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CronAwareLogger } from '../../../common/cron-run/cron-aware-logger';
import { setCronRunSink, type CronRunReport } from '../../../common/cron-run/track-cron';
import { CATALOG_SYNC_LEASE, CATALOG_SYNC_RUNNING, CatalogSyncBusyError, PancakeSyncService } from './pancake-sync.service';
import { PancakeClient as RealPancakeClient } from './pancake.client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';

const notifyPriceDrop = jest.fn().mockResolvedValue(undefined);
const lifecycle = { notifyWishlistPriceDrop: notifyPriceDrop } as unknown as LifecycleService;
beforeEach(() => notifyPriceDrop.mockClear());

// Pancake POS kèm thông tin phân trang ở mọi trang — mock tính từ các trang có dữ liệu.
function makeClient(pages: unknown[][], configured = true): PancakeClient {
  let call = 0;
  const filled = pages.filter((p) => p.length > 0);
  return {
    isConfigured: () => configured,
    fetchProducts: jest.fn(async () => {
      const data = pages[call] ?? [];
      call++;
      return { success: true, data, total_pages: filled.length, total_entries: filled.flat().length };
    }),
  } as unknown as PancakeClient;
}

/** PancakeClient thật, chỉ thay lớp HTTP — để phản hồi thô của Pancake đi qua đúng đường kiểm tra của client. */
function realClient(bodies: unknown[]): PancakeClient {
  const config = { get: (k: string) => ({ PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's', PANCAKE_BASE_URL: 'http://pancake.invalid' })[k] };
  const client = new RealPancakeClient(config as never);
  const get = jest.fn();
  for (const b of bodies) get.mockResolvedValueOnce({ data: b });
  get.mockResolvedValue({ data: { success: true, data: [] } });
  (client as unknown as { http: { get: jest.Mock } }).http.get = get;
  return client;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    product: {
      findUnique: jest.fn().mockResolvedValue(null), // mặc định: tạo mới
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: `prod-${data.pancakeId}`, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'existing', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    variation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null), // mặc định: chưa có giá cũ → không drop
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    // Tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — mock nhận (strings, ...values).
    $executeRaw: jest.fn().mockResolvedValue(1),
    // Khoá đồng bộ chung (cron_leases): mặc định giành/gia hạn/nhả đều được.
    $queryRaw: jest.fn().mockResolvedValue([{ holder: 'this-run' }]),
  };
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    merged[k] = b && typeof b === 'object' && v && typeof v === 'object' ? { ...b, ...v } : v;
  }
  return merged as unknown as PrismaService;
}

// Pancake POS trả product với field `id` (KHÔNG phải product_id) — phản ánh API thật.
const prod = (id: string, name = 'Tinh dầu') => ({
  id,
  name,
  variations: [
    { id: `v-${id}`, sku: 's', retail_price: 1000, remain_quantity: 5, fields: { size: '10ml' }, images: [`https://img/${id}.jpg`] },
  ],
});

describe('PancakeSyncService — đồng bộ lúc khởi động chỉ trên instance chạy cron (R2-PLATFORM-8)', () => {
  function leader() {
    const hooks: (() => void)[] = [];
    return { onLeadership: jest.fn((fn: () => void) => hooks.push(fn)), become: () => hooks.forEach((h) => h()) };
  }

  it('chưa giành được lease → không quét; vừa thành leader → quét toàn bộ một lần', async () => {
    const client = makeClient([[prod('a')]]);
    const l = leader();
    const svc = new PancakeSyncService(makePrisma(), client, lifecycle, l as never);
    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(client.fetchProducts).not.toHaveBeenCalled();
    l.become();
    await new Promise((r) => setImmediate(r));
    const calls = (client.fetchProducts as jest.Mock).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    l.become();
    await new Promise((r) => setImmediate(r));
    expect(client.fetchProducts).toHaveBeenCalledTimes(calls);
  });

  it('Pancake chưa cấu hình → không đăng ký gì', () => {
    const l = leader();
    new PancakeSyncService(makePrisma(), makeClient([], false), lifecycle, l as never).onModuleInit();
    expect(l.onLeadership).not.toHaveBeenCalled();
  });
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

  it('% hoa hồng CTV, chặn CTV và giá sỉ do Tubu đặt: đồng bộ không ghi — cả SP/biến thể mới, cũ lẫn quét toàn bộ (D1-01)', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockImplementation(async ({ where }) =>
          where.pancakeId === 'a' ? { id: 'existing', slug: 'cu', brand: 'Tubu Tree', basePrice: 1000, isActive: true, pancakeHold: null } : null,
        ),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'gone-p', pancakeId: 'gone' }]),
      },
      variation: {
        findUnique: jest.fn().mockImplementation(async ({ where }) =>
          where.pancakeId === 'v-a' ? { retailPrice: 1200, salePrice: null, isActive: true, pancakeHold: null } : null,
        ),
        findMany: jest.fn().mockResolvedValue([{ id: 'gone-v', pancakeId: 'v-gone' }]),
      },
    });
    await new PancakeSyncService(prisma, makeClient([[prod('a'), prod('b')]]), lifecycle).syncProducts();

    const m = prisma as unknown as {
      variation: Record<'upsert' | 'updateMany', jest.Mock>;
      product: Record<'update' | 'create' | 'updateMany', jest.Mock>;
    };
    const writes = [
      ...m.variation.upsert.mock.calls.flatMap(([a]) => [a.update, a.create]),
      ...m.variation.updateMany.mock.calls.map(([a]) => a.data),
      ...m.product.update.mock.calls.map(([a]) => a.data),
      ...m.product.create.mock.calls.map(([a]) => a.data),
      ...m.product.updateMany.mock.calls.map(([a]) => a.data),
    ];
    expect(m.variation.upsert).toHaveBeenCalledTimes(2);
    expect(writes.length).toBeGreaterThanOrEqual(6);
    for (const data of writes) {
      expect(data).not.toHaveProperty('affiliateRate');
      expect(data).not.toHaveProperty('affiliateBlocked');
      expect(data).not.toHaveProperty('dealerPrices');
    }
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
    expect(notifyPriceDrop).toHaveBeenCalledWith('existing', 'Tinh dầu', { oldPrice: 2000, newPrice: 1000 });
  });

  it('nhiều biến thể cùng giảm → báo mức giảm theo % sâu nhất, kèm giá cũ/mới của biến thể đó (ENGAGE-18)', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ retailPrice: 1100, salePrice: null }) // 1100 → 1000: ~9%
      .mockResolvedValueOnce({ retailPrice: 2000, salePrice: null }); // 2000 → 1000: 50%
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 's', brand: 'b' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
      },
      variation: { upsert: jest.fn().mockResolvedValue({}), findUnique },
      wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const p2 = {
      id: 'a',
      name: 'Tinh dầu',
      variations: [
        { id: 'v1', sku: 's1', retail_price: 1000, remain_quantity: 5, fields: {}, images: [] },
        { id: 'v2', sku: 's2', retail_price: 1000, remain_quantity: 5, fields: {}, images: [] },
      ],
    };
    await new PancakeSyncService(prisma, makeClient([[p2]]), lifecycle).syncProducts();
    expect(notifyPriceDrop).toHaveBeenCalledWith('existing', 'Tinh dầu', { oldPrice: 2000, newPrice: 1000 });
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
    (prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw.mock.calls.map((c) => {
      const [strings, ...values] = c as [string[], ...Prisma.Sql[]];
      const q = Prisma.sql(strings, ...values);
      return { sql: q.sql, args: q.values };
    });

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

  describe('mốc tồn kho của lượt đồng bộ (R5-SYNC-3)', () => {
    const T0 = new Date('2026-10-15T03:00:00.000Z');

    /** Mỗi trang Pancake trả lời sau 5 giây — mốc phải là lúc BẮT ĐẦU đọc trang, không phải lúc nhận xong hay lúc ghi. */
    function slowClient(pages: unknown[][]): PancakeClient {
      let call = 0;
      const filled = pages.filter((p) => p.length > 0);
      return {
        isConfigured: () => true,
        fetchProducts: jest.fn(async () => {
          const data = pages[call] ?? [];
          call++;
          jest.setSystemTime(Date.now() + 5_000);
          return { success: true, data, total_pages: filled.length, total_entries: filled.flat().length };
        }),
      } as unknown as PancakeClient;
    }

    beforeEach(() => jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
    afterEach(() => jest.useRealTimers());

    it('áp tồn kho kèm lúc bắt đầu đọc trang chứa biến thể (giờ máy chủ), không so với updated_at Pancake', async () => {
      const prisma = existingProduct();
      await new PancakeSyncService(prisma, slowClient([[prod('a')], [prod('b')]]), lifecycle).syncProducts('2026-10-15T02:45:00.000Z');
      const stock = rawSql(prisma).filter((c) => c.sql.includes('"pancakeStock" ='));
      expect(stock).toHaveLength(2);
      expect(stock[0]!.args).toContain('v-a');
      expect(stock[0]!.args).toContainEqual(T0);
      expect(stock[1]!.args).toContain('v-b');
      expect(stock[1]!.args).toContainEqual(new Date(T0.getTime() + 5_000));
      for (const c of stock) {
        expect(c.sql).toContain('"pancakeStockSyncReadAt" = ?');
        expect(c.sql).toContain('("pancakeStockWebhookReceivedAt" IS NULL OR "pancakeStockWebhookReceivedAt" <= ?)');
        expect(c.sql).not.toContain('pancakeStockEventAt');
      }
    });

    it('forceStock cũng đẩy mốc đọc lên lúc đọc (không lùi), để webhook nhận trước lần đọc mà xử lý sau không ghi đè số admin vừa đặt lại', async () => {
      const prisma = existingProduct();
      await new PancakeSyncService(prisma, slowClient([[prod('a')], []]), lifecycle).syncProducts(undefined, { forceStock: true });
      const [force] = rawSql(prisma).filter((c) => c.sql.includes('"reservedStock" = 0'));
      expect(force!.sql).toContain('"pancakeStockSyncReadAt" = GREATEST("pancakeStockSyncReadAt", ?)');
      expect(force!.sql).not.toContain('pancakeStockEventAt');
      expect(force!.args).toContainEqual(T0);
    });
  });

  it('không dừng phân trang theo giả định page size = 20 (Pancake đổi sang 10 là mất sạch trang sau)', async () => {
    const client = makeClient([[prod('a'), prod('b')], [prod('c')], []]);
    const n = await new PancakeSyncService(makePrisma(), client, lifecycle).syncProducts('2026-09-12T00:00:00.000Z');
    expect(n).toBe(3);
  });

});

type Model = { findMany: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock; create: jest.Mock; update: jest.Mock };
type M = { variation: Model; product: Model };
const mk = (prisma: PrismaService) => prisma as unknown as M;
const variation = (id: string, over: Record<string, unknown> = {}) => ({ id, sku: id, retail_price: 1000, fields: {}, ...over });
const product = (id: string, variations: unknown[], over: Record<string, unknown> = {}) => ({ id, name: 'Nước rửa chén', variations, ...over });

describe('PANCAKE-11: hàng bị xoá khỏi Pancake thì ngừng bán trên Tubu', () => {
  const dbVars = [
    { id: 'db-a', pancakeId: 'v-a' },
    { id: 'db-b', pancakeId: 'v-b' },
    { id: 'db-gone', pancakeId: 'v-gone' },
  ];
  const dbProds = [
    { id: 'p-a', pancakeId: 'a' },
    { id: 'p-b', pancakeId: 'b' },
    { id: 'p-gone', pancakeId: 'gone' },
  ];
  const sweepPrisma = () =>
    makePrisma({
      variation: { findMany: jest.fn().mockResolvedValue(dbVars) },
      product: { findMany: jest.fn().mockResolvedValue(dbProds) },
    });
  const catalog = () => [[product('a', [variation('v-a')]), product('b', [variation('v-b')])]];

  it('quét toàn bộ: biến thể/SP không còn trên Pancake → isActive=false, pancakeHold=REMOVED; bỏ qua hàng không có mã Pancake (đối tác tự giao, MCH_ cũ)', async () => {
    const prisma = sweepPrisma();
    await new PancakeSyncService(prisma, makeClient(catalog()), lifecycle).syncProducts();
    const m = mk(prisma);
    const onPancake = { isActive: true, pancakeId: { not: null }, NOT: { pancakeId: { startsWith: 'MCH_' } } };
    expect(m.variation.findMany.mock.calls[0][0].where).toEqual(onPancake);
    expect(m.product.findMany.mock.calls[0][0].where).toEqual(onPancake);
    expect(m.variation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['db-gone'] }, isActive: true },
      data: { isActive: false, pancakeHold: 'REMOVED' },
    });
    expect(m.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p-gone'] }, isActive: true },
      data: { isActive: false, pancakeHold: 'REMOVED' },
    });
  });

  it('lượt 15 phút (updated_since) không biết thứ gì đã biến mất → không tắt gì', async () => {
    const prisma = sweepPrisma();
    await new PancakeSyncService(prisma, makeClient(catalog()), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
    expect(mk(prisma).variation.findMany).not.toHaveBeenCalled();
    expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
  });

  it('Pancake trả rỗng hoặc mất quá nửa danh mục → nghi trả thiếu, KHÔNG tắt', async () => {
    const empty = sweepPrisma();
    await new PancakeSyncService(empty, makeClient([[]]), lifecycle).syncProducts();
    expect(mk(empty).variation.updateMany).not.toHaveBeenCalled();

    const half = sweepPrisma();
    await new PancakeSyncService(half, makeClient([[product('a', [variation('v-a')])]]), lifecycle).syncProducts();
    expect(mk(half).variation.updateMany).not.toHaveBeenCalled();
    expect(mk(half).product.updateMany).not.toHaveBeenCalled();
  });

  it('fetch lỗi giữa chừng → ném lỗi, không tắt gì', async () => {
    const prisma = sweepPrisma();
    const client = {
      isConfigured: () => true,
      fetchProducts: jest.fn().mockResolvedValueOnce({ data: catalog()[0] }).mockRejectedValueOnce(new Error('timeout')),
    } as unknown as PancakeClient;
    await expect(new PancakeSyncService(prisma, client, lifecycle).syncProducts()).rejects.toThrow('timeout');
    expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
  });

  describe('quét toàn bộ chỉ tắt hàng khi chứng minh được đã đi hết danh mục', () => {
    const page = (data: unknown[], extra: Record<string, unknown> = {}) => ({
      success: true,
      data,
      total_pages: 3,
      total_entries: 3,
      ...extra,
    });
    const p1 = [product('a', [variation('v-a')])];
    const p2 = [product('b', [variation('v-b')])];
    const p3 = [product('gone', [variation('v-gone')])];
    const svc = (prisma: PrismaService, bodies: unknown[]) => new PancakeSyncService(prisma, realClient(bodies), lifecycle);

    it('trang 2/3 trả HTTP 200 kèm success:false → ném lỗi, không tắt gì', async () => {
      const prisma = sweepPrisma();
      await expect(svc(prisma, [page(p1), { success: false, message: 'rate limited' }]).syncProducts()).rejects.toThrow();
      expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
      expect(mk(prisma).product.updateMany).not.toHaveBeenCalled();
    });

    it('trang 2/3 trả rỗng dù Pancake báo 3 trang → coi là quét dở: ném lỗi, không tắt gì', async () => {
      const prisma = sweepPrisma();
      await expect(svc(prisma, [page(p1), page([])]).syncProducts()).rejects.toThrow(/chưa hết danh mục/);
      expect(mk(prisma).variation.findMany).not.toHaveBeenCalled();
      expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
      expect(mk(prisma).product.updateMany).not.toHaveBeenCalled();
    });

    it('đủ số trang nhưng thiếu bản ghi so với total_entries (danh mục xê dịch giữa chừng) → không tắt gì', async () => {
      const prisma = sweepPrisma();
      const bodies = [page(p1, { total_entries: 4 }), page(p2, { total_entries: 4 }), page(p3, { total_entries: 4 }), page([])];
      await expect(svc(prisma, bodies).syncProducts()).rejects.toThrow(/chưa hết danh mục/);
      expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
    });

    it('lượt sync dở không dời mốc updated_since — lượt 15 phút sau không bỏ sót trang chưa đọc', async () => {
      const s = svc(makePrisma(), [page(p1), page([])]);
      const state = s as unknown as { lastRunAt: string | null };
      state.lastRunAt = '2026-10-13T00:00:00.000Z';
      await expect(s.syncProducts(state.lastRunAt)).rejects.toThrow(/chưa hết danh mục/);
      expect(state.lastRunAt).toBe('2026-10-13T00:00:00.000Z');
    });

    it('đi hết 3/3 trang khớp total_entries → mới tắt hàng không còn trên Pancake', async () => {
      const prisma = makePrisma({
        variation: { findMany: jest.fn().mockResolvedValue([...dbVars, { id: 'db-x', pancakeId: 'v-x' }]) },
        product: { findMany: jest.fn().mockResolvedValue([...dbProds, { id: 'p-x', pancakeId: 'x' }]) },
      });
      await svc(prisma, [page(p1), page(p2), page(p3), page([])]).syncProducts();
      expect(mk(prisma).variation.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['db-x'] }, isActive: true },
        data: { isActive: false, pancakeHold: 'REMOVED' },
      });
    });

    it('Pancake không kèm total_pages/total_entries → không chứng minh được đã hết danh mục: đồng bộ bình thường nhưng không tắt gì', async () => {
      const prisma = sweepPrisma();
      const n = await svc(prisma, [{ success: true, data: catalog()[0] }, { success: true, data: [] }]).syncProducts();
      expect(n).toBe(2);
      expect(mk(prisma).variation.updateMany).not.toHaveBeenCalled();
      expect(mk(prisma).product.updateMany).not.toHaveBeenCalled();
    });
  });

  it('biến thể is_removed → tắt; quay lại (đồng bộ đã giữ) → bật lại; admin tự tắt (pancakeHold NULL) → giữ nguyên', async () => {
    const run = async (prev: unknown, v: Record<string, unknown>) => {
      const prisma = makePrisma({ variation: { findUnique: jest.fn().mockResolvedValue(prev) } });
      await new PancakeSyncService(prisma, makeClient([[product('a', [v])]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
      return mk(prisma).variation.upsert.mock.calls[0][0];
    };
    const active = { retailPrice: 1000, salePrice: null, isActive: true, pancakeHold: null };
    expect((await run(active, variation('v-a', { is_removed: true }))).update).toMatchObject({ isActive: false, pancakeHold: 'REMOVED' });
    expect((await run(null, variation('v-a', { is_removed: true }))).create).toMatchObject({ isActive: false, pancakeHold: 'REMOVED' });

    const held = { ...active, isActive: false, pancakeHold: 'REMOVED' };
    expect((await run(held, variation('v-a'))).update).toMatchObject({ isActive: true, pancakeHold: null });

    const adminOff = { ...active, isActive: false };
    const upd = (await run(adminOff, variation('v-a'))).update;
    expect(upd).not.toHaveProperty('isActive');
    expect(upd).not.toHaveProperty('pancakeHold');
  });

  it('sản phẩm đã bị quét tắt mà Pancake trả lại → bật lại; is_removed ở cấp SP → tắt', async () => {
    const run = async (existing: unknown, p: unknown) => {
      const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(existing) } });
      await new PancakeSyncService(prisma, makeClient([[p]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
      return mk(prisma).product.update.mock.calls[0][0].data;
    };
    const base = { id: 'p-a', pancakeId: 'a', forSegment: ['eco'] };
    expect(await run({ ...base, isActive: false, pancakeHold: 'REMOVED' }, product('a', [variation('v-a')]))).toMatchObject({
      isActive: true,
      pancakeHold: null,
    });
    expect(await run({ ...base, isActive: true, pancakeHold: null }, product('a', [variation('v-a')], { is_removed: true }))).toMatchObject({
      isActive: false,
      pancakeHold: 'REMOVED',
    });
  });
});

describe('PANCAKE-12: biến thể thiếu giá không bao giờ thành hàng 0đ', () => {
  const runWith = async (prev: unknown, v: Record<string, unknown>) => {
    const prisma = makePrisma({ variation: { findUnique: jest.fn().mockResolvedValue(prev) } });
    await new PancakeSyncService(prisma, makeClient([[product('a', [v])]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
    return { call: mk(prisma).variation.upsert.mock.calls[0][0], prisma };
  };
  const prev = { retailPrice: 125000, salePrice: 99000, isActive: true, pancakeHold: null };

  it.each([[undefined], [0], [-5], [Number.NaN]])('đã có giá, Pancake trả retail_price=%p → giữ nguyên giá cũ, vẫn bán', async (retail) => {
    const { call } = await runWith(prev, variation('v-a', { retail_price: retail }));
    expect(call.update).not.toHaveProperty('retailPrice');
    expect(call.update).not.toHaveProperty('salePrice');
    expect(call.update).not.toHaveProperty('isActive');
  });

  it('biến thể MỚI thiếu giá → tạo nhưng ngừng bán (NO_PRICE); có giá ở lượt sau → mở bán', async () => {
    const { call } = await runWith(null, variation('v-new', { retail_price: undefined }));
    expect(call.create).toMatchObject({ retailPrice: 0, isActive: false, pancakeHold: 'NO_PRICE' });

    const held = { retailPrice: 0, salePrice: null, isActive: false, pancakeHold: 'NO_PRICE' };
    expect((await runWith(held, variation('v-new', { retail_price: undefined }))).call.update).not.toHaveProperty('isActive');
    expect((await runWith(held, variation('v-new', { retail_price: 50000 }))).call.update).toMatchObject({
      retailPrice: 50000,
      isActive: true,
      pancakeHold: null,
    });
  });

  it('sale_price 0/âm → null (không bán 0đ); basePrice lấy giá dương đầu tiên', async () => {
    const { call } = await runWith(prev, variation('v-a', { retail_price: 130000, sale_price: 0 }));
    expect(call.update).toMatchObject({ retailPrice: 130000, salePrice: null });

    const prisma = makePrisma();
    const p = product('z', [variation('v-0', { retail_price: undefined }), variation('v-1', { retail_price: 70000 })]);
    await new PancakeSyncService(prisma, makeClient([[p]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
    expect(mk(prisma).product.create.mock.calls[0][0].data.basePrice).toBe(70000);
  });

  it('sản phẩm MỚI mà không biến thể nào có giá → tạo nhưng ngừng bán (NO_PRICE), không hiện 0đ; có giá lượt sau → mở bán (R2-PANCAKE-6)', async () => {
    const prisma = makePrisma();
    await new PancakeSyncService(prisma, makeClient([[product('np', [variation('v-np', { retail_price: undefined })])]]), lifecycle).syncProducts(
      '2026-10-13T00:00:00.000Z',
    );
    expect(mk(prisma).product.create.mock.calls[0][0].data).toMatchObject({ basePrice: 0, isActive: false, pancakeHold: 'NO_PRICE' });

    const held = { id: 'prod-np', pancakeId: 'np', basePrice: 0, isActive: false, pancakeHold: 'NO_PRICE', forSegment: ['x'], images: [] };
    const again = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(held) } });
    await new PancakeSyncService(again, makeClient([[product('np', [variation('v-np', { retail_price: 45000 })])]]), lifecycle).syncProducts(
      '2026-10-13T00:00:00.000Z',
    );
    expect(mk(again).product.update.mock.calls[0][0].data).toMatchObject({ basePrice: 45000, isActive: true, pancakeHold: null });
  });

  it('sản phẩm đang bán, Pancake tạm trả thiếu giá → vẫn bán theo giá cũ (không tự ngừng)', async () => {
    const selling = { id: 'prod-a', pancakeId: 'a', basePrice: 125000, isActive: true, pancakeHold: null, forSegment: ['x'], images: [] };
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(selling) } });
    await new PancakeSyncService(prisma, makeClient([[product('a', [variation('v-a', { retail_price: 0 })])]]), lifecycle).syncProducts(
      '2026-10-13T00:00:00.000Z',
    );
    expect(mk(prisma).product.update.mock.calls[0][0].data).not.toHaveProperty('isActive');
  });

  it('thiếu giá không bị tính là giảm giá (không báo wishlist)', async () => {
    await runWith(prev, variation('v-a', { retail_price: 0 }));
    expect(notifyPriceDrop).not.toHaveBeenCalled();
  });
});

/**
 * R4-SYNC-6: bấm đồng bộ khi một lượt khác đang chạy từng trả 201 {synced:0} như thành công (admin tưởng Pancake không có gì
 * đổi), và cờ chặn chỉ nằm trong bộ nhớ từng replica nên hai replica vẫn quét chồng nhau. Nay: khoá chung trong cron_leases,
 * lượt bị chặn là 409 CATALOG_SYNC_RUNNING có lời giải thích.
 */
describe('PancakeSyncService — một lượt đồng bộ một lúc trên cả cụm (R4-SYNC-6)', () => {
  const leaseSql = (prisma: PrismaService) =>
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));

  it('hai lượt bấm chồng nhau trên cùng replica → lượt sau 409 CATALOG_SYNC_RUNNING, không phải {synced:0}', async () => {
    const svc = new PancakeSyncService(makePrisma(), makeClient([[prod('a')], []]), lifecycle);
    const [first, second] = await Promise.allSettled([svc.syncProducts(), svc.syncProducts()]);
    expect(first).toEqual({ status: 'fulfilled', value: 1 });
    expect(second.status).toBe('rejected');
    const err = (second as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(CatalogSyncBusyError);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: CATALOG_SYNC_RUNNING, message: expect.stringContaining('đang chạy') });
  });

  it('replica khác đang giữ khoá đồng bộ → 409, không gọi Pancake, không ghi trạng thái danh mục thành lỗi', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({ $queryRaw: jest.fn().mockResolvedValue([]), opsHealthState: { upsert } });
    const client = makeClient([[prod('a')]]);
    await expect(new PancakeSyncService(prisma, client, lifecycle).syncProducts()).rejects.toBeInstanceOf(CatalogSyncBusyError);
    expect(client.fetchProducts).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('giành khoá chung trước khi gọi Pancake, nhả khoá khi xong — kể cả khi lượt lỗi', async () => {
    const prisma = makePrisma();
    const client = { isConfigured: () => true, fetchProducts: jest.fn().mockRejectedValue(new Error('timeout')) } as unknown as PancakeClient;
    await expect(new PancakeSyncService(prisma, client, lifecycle).syncProducts()).rejects.toThrow('timeout');
    const sql = leaseSql(prisma);
    expect(sql[0]).toContain('INSERT INTO cron_leases');
    expect(sql.at(-1)).toMatch(/UPDATE cron_leases SET "expiresAt"/);
    const holder = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw.mock.calls[0]!.slice(1);
    expect(holder).toContain(CATALOG_SYNC_LEASE);

    await expect(new PancakeSyncService(makePrisma(), makeClient([[prod('a')]]), lifecycle).syncProducts()).resolves.toBe(1);
  });

  it('gia hạn khoá mỗi trang; khoá đã sang lượt khác giữa chừng → dừng, không ghi tiếp trang sau', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ holder: 'this-run' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const prisma = makePrisma({ $queryRaw: queryRaw });
    const client = makeClient([[prod('a')], [prod('b')], []]);
    await expect(new PancakeSyncService(prisma, client, lifecycle).syncProducts('2026-10-14T00:00:00.000Z')).rejects.toThrow(
      /khoá đồng bộ/,
    );
    expect(client.fetchProducts).toHaveBeenCalledTimes(1);
    expect((prisma.variation.upsert as jest.Mock).mock.calls.map((c) => c[0].where.pancakeId)).toEqual(['v-a']);
  });

  describe('lượt cron gặp lượt khác đang chạy', () => {
    const reports: CronRunReport[] = [];
    beforeEach(() => setCronRunSink({ record: (r) => void reports.push(r) }));
    afterEach(() => {
      setCronRunSink(undefined);
      reports.length = 0;
    });
    const quiet = () => ({
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    });

    it('cron 15 phút gặp khoá của replica khác: chỉ cảnh báo, BUSY (bỏ qua)', async () => {
      const { warn, error } = quiet();
      const prisma = makePrisma({ $queryRaw: jest.fn().mockResolvedValue([]) });
      await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).scheduledSync();
      expect(error).not.toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toContain('đang chạy');
      expect(reports[0]).toMatchObject({ outcome: 'SKIPPED', skipReason: 'BUSY' });
      warn.mockRestore();
      error.mockRestore();
    });

    it('cờ chạy cục bộ kẹt: cron 15 phút báo RUNNING để phát hiện treo áp dụng', async () => {
      const { warn, error } = quiet();
      const svc = new PancakeSyncService(makePrisma(), makeClient([[prod('a')]]), lifecycle);
      (svc as unknown as { running: boolean }).running = true;
      await svc.scheduledSync();
      expect(reports[0]).toMatchObject({ outcome: 'SKIPPED', skipReason: 'RUNNING' });
      warn.mockRestore();
      error.mockRestore();
    });

    it('quét đêm gặp lượt đang chạy: là lỗi (ERRORS), không phải bỏ qua, để lần bỏ lỡ có báo động', async () => {
      const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      Logger.overrideLogger(new CronAwareLogger());
      try {
        const prisma = makePrisma({ $queryRaw: jest.fn().mockResolvedValue([]) });
        await new PancakeSyncService(prisma, makeClient([[prod('a')]]), lifecycle).nightlyFullSync();
        expect(reports[0]).toMatchObject({ outcome: 'ERRORS', errorLine: expect.stringContaining('Quét đêm') });
      } finally {
        Logger.overrideLogger(['error']);
        write.mockRestore();
      }
    });

    it('quét đêm không trùng mốc lưới 15 phút của cron thường', () => {
      const meta = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', PancakeSyncService.prototype.nightlyFullSync) as { cronTime: string };
      expect(meta.cronTime).toBe('0 37 3 * * *');
    });
  });
});

describe('PancakeSyncService — ánh xạ nhóm hàng Pancake sang danh mục Tubu', () => {
  const withCats = (id: string, cats: number[]) => ({ ...prod(id), category_ids: cats });
  const config = (map: unknown) => ({ get: jest.fn().mockResolvedValue(map) }) as never;
  const catPrisma = (over: Record<string, unknown> = {}) =>
    makePrisma({ category: { findMany: jest.fn().mockResolvedValue([{ id: 'catA' }]) }, ...over });

  it('sản phẩm mới: ghi categoryIds theo bản đồ, bỏ id Tubu không tồn tại', async () => {
    const prisma = catPrisma();
    const svc = new PancakeSyncService(prisma, makeClient([[withCats('a', [11, 12])]]), lifecycle, undefined, config({ '11': 'catA', '12': 'ghost' }));
    await svc.syncProducts();
    expect((prisma.product.create as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual(['catA']);
  });

  it('sản phẩm đã có danh mục (admin gán) thì không bị đè', async () => {
    const prisma = catPrisma({ product: { findUnique: jest.fn().mockResolvedValue({ id: 'e', categoryIds: ['adminCat'], forSegment: ['x'] }) } });
    const svc = new PancakeSyncService(prisma, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'catA' }));
    await svc.syncProducts();
    expect((prisma.product.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty('categoryIds');
  });

  it('sản phẩm có sẵn nhưng chưa có danh mục thì được điền; bản đồ rỗng/không có cấu hình thì không đụng', async () => {
    const existing = { id: 'e', categoryIds: [], forSegment: ['x'] };
    const p1 = catPrisma({ product: { findUnique: jest.fn().mockResolvedValue(existing) } });
    await new PancakeSyncService(p1, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'catA' })).syncProducts();
    expect((p1.product.update as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual(['catA']);
    const p2 = catPrisma();
    await new PancakeSyncService(p2, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({})).syncProducts();
    expect((p2.product.create as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual([]);
  });
});
