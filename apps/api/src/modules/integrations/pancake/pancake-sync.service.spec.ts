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

type Model = { findMany: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock; create: jest.Mock; update: jest.Mock };
type M = { variation: Model; product: Model };
const mk = (prisma: PrismaService) => prisma as unknown as M;
/** Dữ liệu ghi vào sản phẩm đã có: lệnh `update` chính (không bao giờ mang `description`) cộng mô tả Pancake ghi qua lệnh có điều kiện `updateMany` (W151). */
const writtenData = (prisma: PrismaService): Record<string, unknown> => {
  const data = { ...(mk(prisma).product.update.mock.calls[0][0].data as Record<string, unknown>) };
  expect(data).not.toHaveProperty('description');
  const cas = mk(prisma).product.updateMany.mock.calls.map(([a]) => a as { where: Record<string, unknown>; data: Record<string, unknown> }).filter((a) => 'description' in a.data);
  expect(cas.length).toBeLessThanOrEqual(1);
  const [only] = cas;
  return only ? { ...data, description: only.data.description } : data;
};
const variation =(id: string, over: Record<string, unknown> = {}) => ({ id, sku: id, retail_price: 1000, fields: {}, ...over });
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

  it('mô tả và ảnh admin đã nhập không bị xoá khi Pancake để trống; Pancake có nội dung thật thì ghi đè', async () => {
    const mine = { id: 'prod-d', pancakeId: 'd', basePrice: 1000, isActive: true, pancakeHold: null, forSegment: ['x'], categoryIds: ['c'], images: ['https://mine/a.jpg'], thumbnail: 'https://mine/a.jpg', description: 'Mô tả của chủ shop' };
    const empty = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(mine) } });
    const noImg = product('d', [variation('v-d', { images: [] })]);
    await new PancakeSyncService(empty, makeClient([[{ ...noImg, description: '   ' }]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
    const kept = mk(empty).product.update.mock.calls[0][0].data;
    expect(kept).not.toHaveProperty('description');
    expect(kept).toMatchObject({ images: ['https://mine/a.jpg'], thumbnail: 'https://mine/a.jpg' });

    const real = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(mine) } });
    await new PancakeSyncService(real, makeClient([[{ ...noImg, description: 'Mô tả từ Pancake' }]]), lifecycle).syncProducts('2026-10-13T00:00:00.000Z');
    expect(writtenData(real)).toMatchObject({ description: 'Mô tả từ Pancake' });
  });

  it('sản phẩm đang bán, Pancake tạm trả thiếu giá → vẫn bán theo giá cũ (không tự ngừng)', async () => {
    const selling = { id: 'prod-a', pancakeId: 'a', basePrice: 125000, isActive: true, pancakeHold: null, forSegment: ['x'], images: [] };
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(selling) } });
    await new PancakeSyncService(prisma, makeClient([[product('a', [variation('v-a', { retail_price: 0 })])]]), lifecycle).syncProducts(
      '2026-10-13T00:00:00.000Z',
    );
    expect(mk(prisma).product.update.mock.calls[0][0].data).not.toHaveProperty('isActive');
  });

  it('biến thể đã tắt bán (admin) hoặc bị Pancake xoá mà hạ giá → không báo giảm giá (PNK-03)', async () => {
    await runWith({ ...prev, isActive: false }, variation('v-a', { retail_price: 50000, sale_price: undefined }));
    expect(notifyPriceDrop).not.toHaveBeenCalled();
    await runWith(prev, variation('v-a', { retail_price: 50000, sale_price: undefined, is_removed: true }));
    expect(notifyPriceDrop).not.toHaveBeenCalled();
    await runWith(prev, variation('v-a', { retail_price: 50000, sale_price: undefined }));
    expect(notifyPriceDrop).toHaveBeenCalledTimes(1);
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

  it('sản phẩm đã có danh mục (admin gán) thì không bị đè: update không mang categoryIds và không có lệnh điền', async () => {
    const prisma = catPrisma({ product: { findUnique: jest.fn().mockResolvedValue({ id: 'e', categoryIds: ['adminCat'], forSegment: ['x'] }) } });
    const svc = new PancakeSyncService(prisma, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'catA' }));
    await svc.syncProducts();
    expect((prisma.product.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty('categoryIds');
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('sản phẩm có sẵn nhưng chưa có danh mục được điền bằng lệnh có điều kiện "vẫn còn rỗng", update thường không mang categoryIds', async () => {
    const existing = { id: 'e', categoryIds: [], forSegment: ['x'] };
    const p1 = catPrisma({ product: { findUnique: jest.fn().mockResolvedValue(existing) } });
    await new PancakeSyncService(p1, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'catA' })).syncProducts();
    expect((p1.product.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty('categoryIds');
    expect(p1.product.updateMany).toHaveBeenCalledWith({ where: { id: 'e', categoryIds: { isEmpty: true } }, data: { categoryIds: ['catA'] } });
  });

  it('bản đồ rỗng hoặc không có cấu hình thì không đụng danh mục', async () => {
    const p2 = catPrisma();
    await new PancakeSyncService(p2, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({})).syncProducts();
    expect((p2.product.create as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual([]);
    const p3 = catPrisma({ product: { findUnique: jest.fn().mockResolvedValue({ id: 'e', categoryIds: [], forSegment: ['x'] }) } });
    await new PancakeSyncService(p3, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({})).syncProducts();
    expect(p3.product.updateMany).not.toHaveBeenCalled();
  });

  it('bản đồ trỏ vào danh mục có mục con bị bỏ qua (chỉ gán vào lá); trỏ vào mục con thì ghi', async () => {
    const rows = [{ id: 'cha', parentId: null }, { id: 'con', parentId: 'cha' }];
    const toCha = catPrisma({ category: { findMany: jest.fn().mockResolvedValue(rows) } });
    await new PancakeSyncService(toCha, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'cha' })).syncProducts();
    expect((toCha.product.create as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual([]);
    const toCon = catPrisma({ category: { findMany: jest.fn().mockResolvedValue(rows) } });
    await new PancakeSyncService(toCon, makeClient([[withCats('a', [11])]]), lifecycle, undefined, config({ '11': 'con' })).syncProducts();
    expect((toCon.product.create as jest.Mock).mock.calls[0][0].data.categoryIds).toEqual(['con']);
  });
});

describe('PancakeSyncService — ảnh mới vào danh sách ảnh được đổi cỡ (R-182)', () => {
  const withImg = (id: string, url: string) => ({
    id,
    name: 'Tinh dầu',
    images: [url],
    variations: [{ id: `v-${id}`, sku: 's', retail_price: 1000, remain_quantity: 5, fields: {}, images: [] }],
  });
  const stale = () => ({ markStale: jest.fn() });
  const existingWith = (images: string[], thumbnail: string | null) =>
    makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 's', brand: 'b', images, thumbnail, categoryIds: ['c'], forSegment: ['x'] }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'existing', name: 'Tinh dầu' }),
      },
    });

  it('tạo sản phẩm mới có ảnh → đánh dấu danh sách cũ', async () => {
    const s = stale();
    await new PancakeSyncService(makePrisma(), makeClient([[withImg('a', 'https://content.pancake.vn/a.jpg')]]), lifecycle, undefined, undefined, s as never).syncProducts();
    expect(s.markStale).toHaveBeenCalled();
  });

  it('cập nhật sản phẩm đổi ảnh → đánh dấu', async () => {
    const s = stale();
    const prisma = existingWith(['https://content.pancake.vn/old.jpg'], 'https://content.pancake.vn/old.jpg');
    await new PancakeSyncService(prisma, makeClient([[withImg('a', 'https://content.pancake.vn/new.jpg')]]), lifecycle, undefined, undefined, s as never).syncProducts();
    expect(s.markStale).toHaveBeenCalled();
  });

  it('cập nhật mà ảnh y nguyên → không đánh dấu', async () => {
    const s = stale();
    const url = 'https://content.pancake.vn/same.jpg';
    await new PancakeSyncService(existingWith([url], url), makeClient([[withImg('a', url)]]), lifecycle, undefined, undefined, s as never).syncProducts();
    expect(s.markStale).not.toHaveBeenCalled();
  });

  it('Pancake không trả ảnh (giữ ảnh cũ) → không đánh dấu', async () => {
    const s = stale();
    const url = 'https://content.pancake.vn/same.jpg';
    const noImg = { id: 'a', name: 'Tinh dầu', variations: [{ id: 'v', sku: 's', retail_price: 1000, remain_quantity: 5, fields: {}, images: [] }] };
    await new PancakeSyncService(existingWith([url], url), makeClient([[noImg]]), lifecycle, undefined, undefined, s as never).syncProducts();
    expect(s.markStale).not.toHaveBeenCalled();
  });
});

describe('PancakeSyncService + ImageResizeService — tích hợp (R-182)', () => {
  it('lượt đồng bộ ghi ảnh mới → /img ảnh đó không 404 ngay lần đầu, không đợi 30 giây', async () => {
    const { ImageResizeService } = await import('../../catalog/image-resize.service');
    const { ImageRegistryStale } = await import('../../catalog/image-registry-stale');
    const url = 'https://content.pancake.vn/new.jpg';
    let written = false;
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => {
          written = true;
          return { id: 'p', ...data };
        }),
      },
    });
    // Danh sách trong DB chỉ có ảnh mới sau khi lượt đồng bộ ghi xong.
    const registryDb = { $queryRaw: jest.fn(async () => (written ? [{ u: url }] : [])) };
    const stale = new ImageRegistryStale();
    const resize = new ImageResizeService({ get: jest.fn() } as never, registryDb as never, stale);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(5_000_000);
    await expect(resize.get(url, 320, 'webp')).rejects.toMatchObject({ status: 404 });
    now.mockReturnValue(5_001_000);
    await new PancakeSyncService(prisma, makeClient([[{ id: 'n', name: 'Mới', images: [url], variations: [] }]]), lifecycle, undefined, undefined, stale).syncProducts();
    expect(await (resize as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(url)).toBe(true);
    now.mockRestore();
  });

  it('/img xen vào lúc UPDATE chưa commit không làm mất đánh dấu: sau lượt đồng bộ ảnh mới được đăng ký', async () => {
    const { ImageResizeService } = await import('../../catalog/image-resize.service');
    const { ImageRegistryStale } = await import('../../catalog/image-registry-stale');
    const url = 'https://content.pancake.vn/new.jpg';
    let written = false;
    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((r) => (releaseUpdate = r));
    let updateStarted!: () => void;
    const started = new Promise<void>((r) => (updateStarted = r));
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'e', slug: 's', brand: 'b', images: ['https://content.pancake.vn/old.jpg'], thumbnail: 'https://content.pancake.vn/old.jpg', categoryIds: ['c'], forSegment: ['x'], basePrice: 1000, pancakeHold: null, isActive: true, description: 'd' }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          updateStarted();
          await updateGate;
          written = true;
          return { id: 'e', ...data };
        }),
      },
    });
    const registryDb = { $queryRaw: jest.fn(async () => (written ? [{ u: url }] : [])) };
    const stale = new ImageRegistryStale();
    const resize = new ImageResizeService({ get: jest.fn() } as never, registryDb as never, stale);
    const isReg = (u: string) => (resize as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(u);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(5_000_000);
    expect(await isReg(url)).toBe(false);
    now.mockReturnValue(5_001_000);
    const sync = new PancakeSyncService(prisma, makeClient([[{ id: 'n', name: 'Mới', images: [url], variations: [] }]]), lifecycle, undefined, undefined, stale).syncProducts();
    await started;
    expect(await isReg('https://content.pancake.vn/other.jpg')).toBe(false);
    releaseUpdate();
    await sync;
    now.mockReturnValue(5_002_000);
    expect(await isReg(url)).toBe(true);
    now.mockRestore();
  });
});


describe('PancakeSyncService — tên và phân loại biến thể từ payload Pancake', () => {
  const PANCAKE_FIELDS = [{ id: 'ecbe456a-1111-4222-8333-444455556666', name: 'PHÂN LOẠI', value: '1 chai', keyValue: '1 CHAI' }];
  const ACTIVE_PREV = { retailPrice: 1000, salePrice: null, isActive: true, pancakeHold: null };

  const run = async (v: Record<string, unknown>, prev: Record<string, unknown> | null = null) => {
    const prisma = makePrisma({ variation: { findUnique: jest.fn().mockResolvedValue(prev) } });
    await new PancakeSyncService(prisma, makeClient([[product('a', [v])]]), lifecycle).syncProducts('2026-11-05T00:00:00.000Z');
    return { prisma, upsert: mk(prisma).variation.upsert.mock.calls[0][0], updateMany: mk(prisma).variation.updateMany };
  };

  it('tạo biến thể từ payload dạng mảng: tên là value, không phải "[object Object]", attributes là {tên: giá trị}', async () => {
    const { upsert } = await run(variation('v-a', { fields: PANCAKE_FIELDS }));
    expect(upsert.create.name).toBe('1 chai');
    expect(upsert.create.attributes).toEqual({ 'PHÂN LOẠI': '1 chai' });
    expect(upsert.update.attributes).toEqual({ 'PHÂN LOẠI': '1 chai' });
  });

  it('nhiều phân loại nối " - " theo thứ tự Pancake', async () => {
    const { upsert } = await run(variation('v-a', { fields: [{ name: 'MÀU', value: 'Đỏ' }, { name: 'SIZE', value: 'L' }] }));
    expect(upsert.create.name).toBe('Đỏ - L');
  });

  it('payload dạng object {tên: giá trị} vẫn cho tên đúng', async () => {
    const { upsert } = await run(variation('v-a', { fields: { size: '100ml' } }));
    expect(upsert.create.name).toBe('100ml');
    expect(upsert.create.attributes).toEqual({ size: '100ml' });
  });

  it.each([[[]], [{}], [null], [undefined], [[null, { name: 'A', value: '  ' }]]])('phân loại rỗng hoặc rác %j: tên rơi về tên sản phẩm, attributes {}', async (fields) => {
    const { upsert } = await run(variation('v-a', { fields }));
    expect(upsert.create.name).toBe('Nước rửa chén');
    expect(upsert.create.attributes).toEqual({});
  });

  it('biến thể đang mang "[object Object]": tên được sửa bằng một câu updateMany chỉ khớp khi tên VẪN còn dấu hiệu hỏng', async () => {
    const { upsert, updateMany, prisma } = await run(variation('v-a', { fields: PANCAKE_FIELDS }), { ...ACTIVE_PREV, name: '[object Object]' });
    expect(mk(prisma).variation.updateMany).toHaveBeenCalledWith({
      where: { pancakeId: 'v-a', name: { contains: '[object Object]' } },
      data: { name: '1 chai' },
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(upsert.update).not.toHaveProperty('name');
  });

  it('tên hỏng mà payload không đọc được phân loại: sửa về tên sản phẩm', async () => {
    const { updateMany } = await run(variation('v-a', { fields: [] }), { ...ACTIVE_PREV, name: '[object Object] - [object Object]' });
    expect(updateMany).toHaveBeenCalledWith({ where: { pancakeId: 'v-a', name: { contains: '[object Object]' } }, data: { name: 'Nước rửa chén' } });
  });

  it('tên do admin sửa tay (không chứa dấu hiệu hỏng): giữ nguyên, không ghi name', async () => {
    const { upsert, updateMany } = await run(variation('v-a', { fields: PANCAKE_FIELDS }), { ...ACTIVE_PREV, name: 'Chai 500ml (admin đặt)' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert.update).not.toHaveProperty('name');
  });

  it('tên đã đúng như Pancake: không ghi gì thêm', async () => {
    const { upsert, updateMany } = await run(variation('v-a', { fields: PANCAKE_FIELDS }), { ...ACTIVE_PREV, name: '1 chai' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert.update).not.toHaveProperty('name');
  });

  it('đọc tên hiện tại của biến thể để quyết định (select có name)', async () => {
    const { prisma } = await run(variation('v-a', { fields: PANCAKE_FIELDS }), ACTIVE_PREV);
    expect(mk(prisma).variation.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ name: true }) }));
  });
});

describe('PancakeSyncService — payload thiếu trường hoặc kiểu lạ (W11)', () => {
  const SINCE = '2026-11-06T00:00:00.000Z';
  const sync = async (products: unknown[], prisma: PrismaService = makePrisma(), config?: unknown) => {
    const svc = new PancakeSyncService(prisma, makeClient([products]), lifecycle, undefined, config as never);
    return { n: await svc.syncProducts(SINCE), prisma };
  };
  const upserts = (prisma: PrismaService) => mk(prisma).variation.upsert.mock.calls.map((c) => c[0] as { where: { pancakeId: unknown }; update: Record<string, unknown>; create: Record<string, unknown> });
  const firstUpsert = (prisma: PrismaService) => upserts(prisma)[0]!;
  const stockArgs = (prisma: PrismaService) =>
    (prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw.mock.calls.map((c) => Prisma.sql(c[0] as string[], ...(c.slice(1) as Prisma.Sql[])).values);

  describe('một phần tử hỏng không làm hỏng cả lượt đồng bộ', () => {
    it.each([[null], ['rác'], [42], [[]]])('phần tử %j trong danh sách sản phẩm: bỏ qua, sản phẩm đứng sau vẫn được đồng bộ', async (bad) => {
      const { n, prisma } = await sync([bad, product('good', [variation('v-good')])]);
      expect(n).toBe(1);
      expect(mk(prisma).product.create).toHaveBeenCalledTimes(1);
    });

    it.each([['x'], [{}], [5], [{ id: 'v1' }]])('variations=%j (không phải mảng): sản phẩm vẫn được ghi, không có biến thể nào', async (variations) => {
      const { n, prisma } = await sync([{ id: 'a', name: 'Tinh dầu', variations }, product('b', [variation('v-b')])]);
      expect(n).toBe(2);
      expect(upserts(prisma).map((u) => u.where.pancakeId)).toEqual(['v-b']);
    });

    it('data là object còn products là mảng: đọc mảng, không lặp qua object', async () => {
      const client = {
        isConfigured: () => true,
        fetchProducts: jest
          .fn()
          .mockResolvedValueOnce({ success: true, data: {}, products: [prod('a')], total_pages: 1, total_entries: 1 })
          .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: 1 }),
      } as unknown as PancakeClient;
      const prisma = makePrisma();
      await expect(new PancakeSyncService(prisma, client, lifecycle).syncProducts(SINCE)).resolves.toBe(1);
    });

    it('một biến thể lỗi khi ghi: các biến thể còn lại của sản phẩm vẫn được ghi, sản phẩm tính là lỗi', async () => {
      const prisma = makePrisma({
        variation: {
          upsert: jest.fn().mockImplementation(async ({ where }: { where: { pancakeId: string } }) => {
            if (where.pancakeId === 'v-bad') throw new Error('sku trùng');
            return {};
          }),
        },
      });
      const { n } = await sync([product('a', [variation('v-bad'), variation('v-ok')])], prisma);
      expect(upserts(prisma).map((u) => u.where.pancakeId)).toEqual(['v-bad', 'v-ok']);
      expect(n).toBe(0);
    });
  });

  describe('kết quả lượt đồng bộ ghi cho màn sức khoẻ vận hành: sản phẩm thiếu tên/mã là "bỏ qua", không phải "lỗi"', () => {
    const runDetail = async (products: unknown[], prismaOver: Record<string, unknown> = {}) => {
      const upsert = jest.fn().mockResolvedValue({});
      const prisma = makePrisma({ opsHealthState: { upsert }, ...prismaOver });
      const { n } = await sync(products, prisma);
      const calls = upsert.mock.calls.map((c) => c[0] as { update: { detail?: unknown } });
      return { n, detail: calls.at(-1)?.update.detail };
    };

    it.each([['   '], [null], [{}]])('sản phẩm nháp name=%j + một sản phẩm tốt: count 1, failed 0, skipped 1', async (name) => {
      const { n, detail } = await runDetail([{ id: 'draft', name, variations: [] }, product('good', [variation('v-good')])]);
      expect(n).toBe(1);
      expect(detail).toEqual({ count: 1, failed: 0, skipped: 1 });
    });

    it('sản phẩm thiếu id (có tên): bỏ qua, không phải lỗi', async () => {
      const { detail } = await runDetail([{ name: 'Không mã', variations: [variation('v-x')] }]);
      expect(detail).toEqual({ count: 0, failed: 0, skipped: 1 });
    });

    it('lỗi ghi thật (sku trùng) vẫn là failed, không bị đếm là skipped', async () => {
      const { detail } = await runDetail([product('a', [variation('v-bad')])], {
        variation: { upsert: jest.fn().mockRejectedValue(new Error('sku trùng')) },
      });
      expect(detail).toEqual({ count: 0, failed: 1, skipped: 0 });
    });

    it('phần tử không phải object trong danh sách vẫn là failed (dữ liệu hỏng, không phải sản phẩm nháp)', async () => {
      const { detail } = await runDetail([null, product('good', [variation('v-good')])]);
      expect(detail).toEqual({ count: 1, failed: 1, skipped: 0 });
    });

    it('lượt sạch: skipped 0', async () => {
      const { detail } = await runDetail([product('good', [variation('v-good')])]);
      expect(detail).toEqual({ count: 1, failed: 0, skipped: 0 });
    });
  });

  describe('trường kiểu lạ của sản phẩm', () => {
    it('images là một chuỗi: thành một ảnh, không tách từng ký tự', async () => {
      const { prisma } = await sync([product('a', [variation('v-a')], { images: 'https://img/a.jpg' })]);
      const data = mk(prisma).product.create.mock.calls[0][0].data;
      expect(data.images).toEqual(['https://img/a.jpg']);
      expect(data.thumbnail).toBe('https://img/a.jpg');
    });

    it('images là object: bỏ qua phần ảnh, giá và tồn vẫn đồng bộ', async () => {
      const { n, prisma } = await sync([product('a', [variation('v-a', { images: ['https://img/v.jpg'] })], { images: { 0: 'x' } })]);
      expect(n).toBe(1);
      expect(mk(prisma).product.create.mock.calls[0][0].data.images).toEqual(['https://img/v.jpg']);
    });

    it('variations[].images là một chuỗi thì thành một ảnh, là object thì bỏ qua', async () => {
      const { prisma } = await sync([product('a', [variation('v-a', { images: 'https://img/one.jpg' }), variation('v-b', { images: { a: 1 } })])]);
      expect(mk(prisma).product.create.mock.calls[0][0].data.images).toEqual(['https://img/one.jpg']);
    });

    it('description là object: không ném, mô tả cũ được giữ (bản ghi cập nhật không mang khoá description)', async () => {
      const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue({ id: 'p', pancakeId: 'a', description: 'Mô tả cũ', basePrice: 1000, forSegment: ['eco'], images: [], categoryIds: [] }) } });
      const { n } = await sync([product('a', [variation('v-a')], { description: { vi: 'x' } })], prisma);
      expect(n).toBe(1);
      expect(mk(prisma).product.update.mock.calls[0][0].data).not.toHaveProperty('description');
    });

    it.each([['   '], [''], [null], [{}], [['a']], [true]])('name=%j: bỏ qua sản phẩm, không ghi tên rác', async (name) => {
      const { n, prisma } = await sync([{ id: 'a', name, variations: [variation('v-a')] }]);
      expect(n).toBe(0);
      expect(mk(prisma).product.create).not.toHaveBeenCalled();
      expect(upserts(prisma)).toHaveLength(0);
    });

    it.each([['false'], [0], [null], [undefined]])('is_removed=%j: không phải cờ bật, sản phẩm không bị tắt', async (flag) => {
      const { prisma } = await sync([product('a', [variation('v-a')], { is_removed: flag })]);
      expect(mk(prisma).product.create.mock.calls[0][0].data).not.toHaveProperty('pancakeHold', 'REMOVED');
    });

    it.each([[true], ['true'], [1], ['1'], [2], ['yes'], ['2026-11-05T10:00:00Z'], [1730800000000], [{}]])('is_removed=%j: tắt sản phẩm', async (flag) => {
      const { prisma } = await sync([product('a', [variation('v-a')], { is_removed: flag })]);
      expect(mk(prisma).product.create.mock.calls[0][0].data).toMatchObject({ isActive: false, pancakeHold: 'REMOVED' });
    });

    it('category_ids là một số (không phải mảng): vẫn ánh xạ, sản phẩm không hỏng', async () => {
      const prisma = makePrisma({ category: { findMany: jest.fn().mockResolvedValue([{ id: 'catA' }]) } });
      const cfg = { get: jest.fn().mockResolvedValue({ '865301': 'catA' }) };
      const { n } = await sync([product('a', [variation('v-a')], { category_ids: 865301 })], prisma, cfg);
      expect(n).toBe(1);
      expect(mk(prisma).product.create.mock.calls[0][0].data.categoryIds).toEqual(['catA']);
    });
  });

  describe('trường kiểu lạ của biến thể', () => {
    it.each([[undefined], [null], [''], [{ a: 1 }], [['x']], [true]])('id=%j: bỏ qua biến thể, không upsert theo mã rác; biến thể hợp lệ cạnh nó vẫn ghi', async (id) => {
      const { n, prisma } = await sync([product('a', [{ id, sku: 's', retail_price: 1000 }, variation('v-ok')])]);
      expect(n).toBe(1);
      expect(upserts(prisma).map((u) => u.where.pancakeId)).toEqual(['v-ok']);
    });

    it('id là số: đổi thành chuỗi như webhook đã làm', async () => {
      const { prisma } = await sync([product('a', [variation('x', { id: 12345 })])]);
      expect(upserts(prisma)[0]!.where.pancakeId).toBe('12345');
    });

    it.each([['ABC '], [' ABC'], ['abc-1'], ['null']])('sku chuỗi có chữ %j: ghi nguyên văn, không cắt khoảng trắng (khoá duy nhất so khớp theo giá trị Pancake gửi)', async (sku) => {
      const { prisma } = await sync([product('a', [{ id: 'v-a', sku, retail_price: 1000 }])]);
      expect(firstUpsert(prisma).create.sku).toBe(sku);
      expect(firstUpsert(prisma).update.sku).toBe(sku);
    });

    it('sku là số: đổi thành chuỗi', async () => {
      const { prisma } = await sync([product('a', [{ id: 'v-a', sku: 8934567, retail_price: 1000 }])]);
      expect(firstUpsert(prisma).create.sku).toBe('8934567');
    });

    it.each([[''], ['   '], [{ a: 1 }], [null], [undefined]])('sku=%j: lấy mã biến thể làm sku, không ghi chuỗi rỗng/object (sku là khoá duy nhất)', async (sku) => {
      const { prisma } = await sync([product('a', [{ id: 'v-a', sku, retail_price: 1000 }])]);
      expect(firstUpsert(prisma).create.sku).toBe('v-a');
      expect(firstUpsert(prisma).update.sku).toBe('v-a');
    });

    it.each([
      [250.5, 250],
      [250.9, 250],
      ['250.9', 250],
      ['500', 500],
      [-5, null],
      [{}, null],
      [true, null],
      [Number.MAX_SAFE_INTEGER * 4, null],
    ])('weight=%j: cột weight là Int, ghi %j', async (weight, expected) => {
      const { prisma } = await sync([product('a', [variation('v-a', { weight })])]);
      expect(firstUpsert(prisma).create.weight).toBe(expected);
      expect(firstUpsert(prisma).update.weight).toBe(expected);
    });

    describe('remain_quantity', () => {
      it('số âm (Pancake cho bán lố kho): tồn Tubu là 0, không ghi số âm', async () => {
        const { prisma } = await sync([product('a', [variation('v-a', { remain_quantity: -3 })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ stock: 0, pancakeStock: 0 });
        expect(stockArgs(prisma).flat()).not.toContain(-3);
      });

      it.each([['7', 7], [12.7, 12], ['0', 0]])('remain_quantity=%j: ghi %j', async (raw, expected) => {
        const { prisma } = await sync([product('a', [variation('v-a', { remain_quantity: raw })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ stock: expected, pancakeStock: expected });
        expect(stockArgs(prisma)[0]).toContain(expected);
      });

      it.each([['7.00', 7], ['7.50', 7], ['12.3456', 12], [' 3.0 ', 3]])('remain_quantity chuỗi thập phân %j: ghi %j', async (raw, expected) => {
        const { prisma } = await sync([product('a', [variation('v-a', { remain_quantity: raw })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ stock: expected, pancakeStock: expected });
      });

      it.each([['5.000'], ['1.234'], ['12.000']])('remain_quantity=%j khớp mẫu ngăn nghìn (có thể là 5000): từ chối, không đụng tồn kho, có warn', async (raw) => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          const { prisma } = await sync([product('a', [variation('v-a', { remain_quantity: raw })])]);
          expect(stockArgs(prisma)).toHaveLength(0);
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('remain_quantity'));
        } finally {
          warn.mockRestore();
        }
      });

      it.each([[''], ['abc'], [{}], [[]], [true], [1e12], ['1e3'], [Infinity]])('remain_quantity=%j: không đọc được, coi như Pancake không nói gì (không đụng tồn kho)', async (raw) => {
        const { prisma } = await sync([product('a', [variation('v-a', { remain_quantity: raw })])]);
        expect(stockArgs(prisma)).toHaveLength(0);
        expect(firstUpsert(prisma).create).toMatchObject({ stock: 0, pancakeStock: 0 });
      });
    });

    describe('giá', () => {
      it('retail_price là chuỗi toàn chữ số: đọc như số', async () => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: '269000', sale_price: '199000' })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 269000, salePrice: 199000 });
        expect(firstUpsert(prisma).create.pancakeHold ?? null).toBeNull();
      });

      it('retail_price "269000.000" (phần lẻ toàn số 0) đọc như 269000', async () => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: '269000.000', sale_price: '199000.00' })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 269000, salePrice: 199000 });
      });

      it.each([['5.000', 5000], ['120.000', 120000], ['1.234.567', 1234567]])('W24: retail_price chuỗi ngăn nghìn %j đọc là %j (không thành 5 hay 120)', async (raw, expected) => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: raw, sale_price: undefined })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: expected, salePrice: null });
        expect(firstUpsert(prisma).create.pancakeHold ?? null).toBeNull();
        expect(mk(prisma).product.create.mock.calls[0][0].data).toMatchObject({ basePrice: expected });
      });

      it('W24: sale_price chuỗi ngăn nghìn thấp hơn retail_price: lưu cả hai', async () => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: '120.000', sale_price: '99.000' })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 120000, salePrice: 99000 });
      });

      it.each([[50000], ['50.000'], [60000], ['60.000'], ['50000.000']])(
        'W24: sale_price=%j không thấp hơn retail_price 50000: bỏ giá khuyến mãi, bán theo giá gốc, có warn nói rõ',
        async (sale) => {
          const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
          try {
            const { prisma } = await sync([product('a', [variation('v-a', { retail_price: 50000, sale_price: sale })])]);
            expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 50000, salePrice: null });
            expect(firstUpsert(prisma).create.pancakeHold ?? null).toBeNull();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('không thấp hơn retail_price'));
          } finally {
            warn.mockRestore();
          }
        },
      );

      it('W24: cùng cặp giá sale ≥ retail chỉ warn một lần dù cron gặp lại; giá đổi thì warn lại', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          const sales = [50000, 50000, 60000];
          let fetches = 0;
          const client = {
            isConfigured: () => true,
            // Mỗi lượt đồng bộ đọc một trang có dữ liệu rồi một trang rỗng (như makeClient).
            fetchProducts: jest.fn(async () => {
              const k = fetches++;
              const data = k % 2 === 0 ? [product('a', [variation('v-a', { retail_price: 50000, sale_price: sales[k / 2] })])] : [];
              return { success: true, data, total_pages: 1, total_entries: 1 };
            }),
          } as unknown as PancakeClient;
          const svc = new PancakeSyncService(makePrisma(), client, lifecycle);
          for (let i = 0; i < sales.length; i++) await svc.syncProducts(SINCE);
          const warned = () => warn.mock.calls.filter((c) => String(c[0]).includes('không thấp hơn retail_price'));
          expect(warned()).toHaveLength(2);
          expect(String(warned()[0]![0])).toContain('sale_price 50000');
          expect(String(warned()[1]![0])).toContain('sale_price 60000');
        } finally {
          warn.mockRestore();
        }
      });

      it('W24: sale_price thấp hơn retail_price một đồng vẫn là khuyến mãi, không warn', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          const { prisma } = await sync([product('a', [variation('v-a', { retail_price: 50000, sale_price: 49999 })])]);
          expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 50000, salePrice: 49999 });
          expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('không thấp hơn retail_price'));
        } finally {
          warn.mockRestore();
        }
      });

      it.each([['269.000đ'], [12000.5], [''], ['abc'], [{}], [[]], [true], [-1], [1e21], ['0.500']])('retail_price=%j: không đọc được → biến thể mới không mở bán, không ghi giá lạ', async (retail) => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: retail })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 0, isActive: false, pancakeHold: 'NO_PRICE' });
        expect(mk(prisma).product.create.mock.calls[0][0].data).toMatchObject({ basePrice: 0, isActive: false, pancakeHold: 'NO_PRICE' });
      });

      it.each([['0.500'], [{}], [[]], ['abc']])('sale_price=%j: bỏ giá khuyến mãi, giữ giá lẻ', async (sale) => {
        const { prisma } = await sync([product('a', [variation('v-a', { retail_price: 50000, sale_price: sale })])]);
        expect(firstUpsert(prisma).create).toMatchObject({ retailPrice: 50000, salePrice: null });
      });
    });

    it.each([[true], ['true'], [1], ['1'], [2], ['yes'], ['2026-11-05T10:00:00Z'], [1730800000000], [{}]])('is_removed=%j: tắt biến thể', async (flag) => {
      const { prisma } = await sync([product('a', [variation('v-a', { is_removed: flag })])]);
      expect(firstUpsert(prisma).create).toMatchObject({ isActive: false, pancakeHold: 'REMOVED' });
    });

    it.each([['false'], [' False '], [0], ['0'], [''], [null]])('is_removed=%j: không tắt biến thể', async (flag) => {
      const { prisma } = await sync([product('a', [variation('v-a', { is_removed: flag })])]);
      expect(firstUpsert(prisma).create.pancakeHold ?? null).toBeNull();
      expect(firstUpsert(prisma).create.isActive ?? true).toBe(true);
    });
  });
});

/**
 * W126: bàn làm việc chất lượng catalog ghi mô tả, mô tả ngắn và thành phần AI soạn rồi admin duyệt vào DB. Đồng bộ Pancake chạy mỗi lượt
 * trên mọi sản phẩm nên khoá ở đây rằng nó không bao giờ xoá những chữ đó: mô tả Pancake trống không đè mô tả đã duyệt,
 * và đồng bộ không có đường nào ghi `shortDesc` hay `ingredients`.
 */
describe('PancakeSyncService — chữ catalog admin đã duyệt không bị đồng bộ xoá (W126)', () => {
  const SINCE = '2026-11-12T00:00:00.000Z';
  const ADMIN_TEXT = 'Mô tả admin đã duyệt từ bàn làm việc chất lượng catalog';
  const approved = {
    id: 'prod-w126',
    pancakeId: 'w126',
    basePrice: 1000,
    isActive: true,
    pancakeHold: null,
    forSegment: ['x'],
    categoryIds: ['c'],
    images: ['https://mine/a.jpg'],
    thumbnail: 'https://mine/a.jpg',
    description: ADMIN_TEXT,
    shortDesc: 'Mô tả ngắn đã duyệt',
    ingredients: [{ name: 'Bơ tươi' }],
  };
  const runUpdate = async (pancakeDescription: unknown, withKey = true) => {
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(approved) } });
    const payload = product('w126', [variation('v-w126')], withKey ? { description: pancakeDescription } : {});
    await new PancakeSyncService(prisma, makeClient([[payload]]), lifecycle).syncProducts(SINCE);
    expect(mk(prisma).product.update).toHaveBeenCalledTimes(1);
    return writtenData(prisma);
  };

  it.each([[''], ['   '], ['\n\t  '], [' '], [null], [undefined], [{}], [['x']], [42], [true]])('mô tả Pancake %j: giữ nguyên mô tả đã duyệt', async (pancakeDescription) => {
    expect(await runUpdate(pancakeDescription)).not.toHaveProperty('description');
  });

  it.each([['<p></p>'], ['<br>'], ['<p><br></p>'], ['&nbsp;'], ['<p>&nbsp;</p>'], [' <div> </div> ']])('mô tả Pancake chỉ là HTML trống %j: giữ nguyên mô tả đã duyệt', async (pancakeDescription) => {
    expect(await runUpdate(pancakeDescription)).not.toHaveProperty('description');
  });

  it('Pancake không gửi khoá description: giữ nguyên mô tả đã duyệt', async () => {
    expect(await runUpdate(undefined, false)).not.toHaveProperty('description');
  });

  it('mô tả Pancake từ 40 ký tự trở lên vẫn ghi đè (Pancake là nguồn chính khi có nội dung đủ dài)', async () => {
    const longText = 'Mô tả từ Pancake có đủ bốn mươi ký tự trở lên.';
    expect(longText.length).toBeGreaterThanOrEqual(40);
    expect((await runUpdate(longText)).description).toBe(longText);
    expect((await runUpdate(`<p>${longText}</p>`)).description).toBe(`<p>${longText}</p>`);
  });

  it.each([['Mô tả từ Pancake'], ['<p>Chữ thật từ Pancake</p>'], ['Sữa hạt điều'], ['<p>Sữa hạt điều 400g</p>'], ['a'.repeat(39)]])(
    'Pancake chỉ gửi chữ ngắn hơn 40 ký tự (%j): giữ mô tả đã duyệt từ 40 ký tự, không để tên hay cụm POS đè lên',
    async (pancakeDescription) => {
      expect(ADMIN_TEXT.length).toBeGreaterThanOrEqual(40);
      expect(await runUpdate(pancakeDescription)).not.toHaveProperty('description');
    },
  );

  it('Pancake gửi chữ ngắn nhưng kèm ảnh: là nội dung thật, vẫn ghi đè mô tả đã duyệt', async () => {
    const withImage = '<p>Thông tin</p><img src="https://cdn.example/a.jpg">';
    expect((await runUpdate(withImage)).description).toBe(withImage);
  });

  it('Pancake chép đúng tên sản phẩm dài từ 40 ký tự: giữ mô tả đã duyệt', async () => {
    const longName = 'Sản phẩm thử nghiệm với tên rất dài để vượt bốn mươi ký tự';
    expect(longName.length).toBeGreaterThanOrEqual(40);
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(approved) } });
    await new PancakeSyncService(prisma, makeClient([[{ ...product('w126', [variation('v-w126')], { description: longName }), name: longName }]]), lifecycle).syncProducts(SINCE);
    expect(mk(prisma).product.update.mock.calls[0][0].data as Record<string, unknown>).not.toHaveProperty('description');
  });

  it('mô tả đang có ngắn hơn 40 ký tự thì chữ Pancake ngắn vẫn là nguồn chính (không có gì giàu hơn để giữ)', async () => {
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue({ ...approved, description: 'Sữa hạt điều' }) } });
    await new PancakeSyncService(prisma, makeClient([[product('w126', [variation('v-w126')], { description: 'Sữa hạt điều 400g' })]]), lifecycle).syncProducts(SINCE);
    expect(writtenData(prisma).description).toBe('Sữa hạt điều 400g');
  });

  describe('W149A: mô tả TubuTree từ 80 ký tự là nguồn chuẩn, đồng bộ 15 phút không bao giờ ghi đè', () => {
    const RICH = 'Xoài sấy dẻo BH.NONG. Xoài được sấy theo kiểu dẻo như tên gọi, dùng làm món ăn vặt hoặc ăn nhẹ.';
    const PANCAKE_120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';
    const runWith = async (existingDescription: string, pancakeDescription: unknown, pancakeName = 'Sản phẩm w149a') => {
      const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue({ ...approved, description: existingDescription }) } });
      const payload = { ...product('w126', [variation('v-w126')], { description: pancakeDescription }), name: pancakeName };
      await new PancakeSyncService(prisma, makeClient([[payload]]), lifecycle).syncProducts(SINCE);
      expect(mk(prisma).product.update).toHaveBeenCalledTimes(1);
      return writtenData(prisma);
    };

    it.each([
      ['mô tả mới dài 120 ký tự', PANCAKE_120],
      ['mô tả mới bọc HTML', `<p>${PANCAKE_120}</p>`],
      ['mô tả mới kèm ảnh', `<p>${PANCAKE_120}</p><img src="https://cdn.example/a.jpg">`],
      ['chữ ngắn dưới 40', 'Xoài sấy dẻo'],
      ['HTML trống', '<p><br></p>'],
      ['rỗng', ''],
      ['null', null],
    ])('mô tả TubuTree %#: %s từ Pancake không đè được mô tả giàu', async (_label, pancakeDescription) => {
      expect(RICH.length).toBeGreaterThanOrEqual(80);
      expect(await runWith(RICH, pancakeDescription)).not.toHaveProperty('description');
    });

    it('Pancake chép đúng tên sản phẩm: mô tả giàu vẫn đứng vững', async () => {
      expect(await runWith(RICH, 'Xoài sấy dẻo BH.NONG', 'Xoài sấy dẻo BH.NONG')).not.toHaveProperty('description');
    });

    it.each([[''], ['Xoài'], ['a'.repeat(39)], [ADMIN_TEXT]])('mô tả TubuTree rỗng hoặc dưới 80 ký tự (%j) vẫn nhận mô tả thật từ Pancake', async (existing) => {
      expect(ADMIN_TEXT.length).toBeLessThan(80);
      expect((await runWith(existing, PANCAKE_120)).description).toBe(PANCAKE_120);
    });

    it('bản chép tên sản phẩm dài từ 80 ký tự không bị nhầm là mô tả giàu: Pancake có chữ thật thì thay', async () => {
      const longName = 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 Gói Thơm Ngon Đặc Biệt Nhập Khẩu Chính Hãng';
      expect(longName.length).toBeGreaterThanOrEqual(80);
      expect((await runWith(longName, PANCAKE_120, longName)).description).toBe(PANCAKE_120);
    });

    it('mô tả TubuTree 40..79 ký tự giữ lớp bảo vệ cũ: Pancake ngắn không đè, Pancake chữ thật đè', async () => {
      expect(await runWith(ADMIN_TEXT, 'Mô tả từ Pancake')).not.toHaveProperty('description');
      expect((await runWith(ADMIN_TEXT, PANCAKE_120)).description).toBe(PANCAKE_120);
    });
  });

  describe('W150A: giữ mô tả thì không đưa khoá description vào lệnh update (Admin lưu xen giữa không bị ghi đè ngược)', () => {
    const RICH = 'Xoài sấy dẻo BH.NONG. Xoài được sấy theo kiểu dẻo như tên gọi, dùng làm món ăn vặt hoặc ăn nhẹ.';
    const ADMIN_NEW = 'Mô tả mới do Admin vừa lưu trong lúc đồng bộ Pancake đang chạy, dài hơn tám mươi ký tự nên vẫn là mô tả giàu.';
    const PANCAKE_120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';

    /**
     * Hàng Postgres giả: `findUnique` trả ảnh chụp lúc đọc; `update` cho Admin lưu xong TRƯỚC khi lệnh của đồng bộ tới nơi, rồi chỉ áp những khoá có trong `data`.
     * `updateMany` áp `data` chỉ khi mọi điều kiện `where` có mặt khớp hàng hiện tại (đúng như Postgres); `adminSavesAt` chọn lúc Admin chen vào.
     */
    const raceRun = async (readDescription: string, pancakeDescription: unknown, withKey = true, adminSavesAt: 'update' | 'never' = 'update') => {
      const row: Record<string, unknown> = { ...approved, description: readDescription };
      const prisma = makePrisma({
        product: {
          findUnique: jest.fn(async () => ({ ...row })),
          update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            if (adminSavesAt === 'update') row.description = ADMIN_NEW;
            Object.assign(row, data);
            return { ...row };
          }),
          updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (!('description' in data)) return { count: 0 };
            if ('description' in where && where.description !== row.description) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          }),
        },
      });
      const payload = product('w126', [variation('v-w126')], withKey ? { description: pancakeDescription } : {});
      await new PancakeSyncService(prisma, makeClient([[payload]]), lifecycle).syncProducts(SINCE);
      expect(mk(prisma).product.update).toHaveBeenCalledTimes(1);
      return { row, data: writtenData(prisma), prisma };
    };

    it.each([
      ['mô tả Pancake dài 120 ký tự', PANCAKE_120],
      ['chữ ngắn dưới 40', 'Xoài sấy dẻo'],
      ['HTML trống', '<p><br></p>'],
      ['chuỗi rỗng', ''],
      ['null', null],
    ])('mô tả giàu đã đọc, Pancake gửi %s, Admin lưu bản mới xen giữa: bản mới của Admin còn nguyên', async (_label, pancakeDescription) => {
      expect(RICH.length).toBeGreaterThanOrEqual(80);
      const { row, data } = await raceRun(RICH, pancakeDescription);
      expect(data).not.toHaveProperty('description');
      expect(row.description).toBe(ADMIN_NEW);
    });

    it('Pancake không gửi khoá description, Admin lưu xen giữa: bản mới của Admin còn nguyên', async () => {
      const { row, data } = await raceRun(RICH, undefined, false);
      expect(data).not.toHaveProperty('description');
      expect(row.description).toBe(ADMIN_NEW);
    });

    it('mô tả 40..79 ký tự, Pancake gửi chữ ngắn hoặc trống, Admin lưu xen giữa: bản mới của Admin còn nguyên', async () => {
      const mid = 'Mô tả admin đã duyệt từ bàn làm việc chất lượng catalog';
      expect(mid.length).toBeGreaterThanOrEqual(40);
      expect(mid.length).toBeLessThan(80);
      for (const incoming of ['Mô tả từ Pancake', '', null]) {
        const { row, data } = await raceRun(mid, incoming);
        expect(data).not.toHaveProperty('description');
        expect(row.description).toBe(ADMIN_NEW);
      }
    });

    it('Pancake ghi mô tả mới (mô tả đang có chưa đạt chuẩn giàu), không ai chen vào: mô tả Pancake được ghi, qua lệnh có điều kiện khớp bản đã đọc', async () => {
      const { row, data, prisma } = await raceRun('Xoài', PANCAKE_120, true, 'never');
      expect(data.description).toBe(PANCAKE_120);
      expect(row.description).toBe(PANCAKE_120);
      const cas = mk(prisma).product.updateMany.mock.calls.map(([a]) => a).filter((a) => 'description' in a.data);
      expect(cas).toHaveLength(1);
      expect(cas[0].where).toEqual({ id: approved.id, description: 'Xoài' });
      const html = `<p>${PANCAKE_120}</p>`;
      const second = await raceRun('', html, true, 'never');
      expect(second.data.description).toBe(html);
      expect(second.row.description).toBe(html);
    });

    it('W151: Pancake ghi mô tả mới nhưng Admin lưu bản mới xen giữa lúc đọc và lúc ghi: bản của Admin còn nguyên, Pancake không đè', async () => {
      for (const readDescription of ['Xoài', '', 'Mô tả admin đã duyệt từ bàn làm việc chất lượng catalog']) {
        const { row, prisma } = await raceRun(readDescription, PANCAKE_120);
        expect(row.description).toBe(ADMIN_NEW);
        const cas = mk(prisma).product.updateMany.mock.calls.map(([a]) => a).filter((a) => 'description' in a.data);
        expect(cas).toHaveLength(1);
        expect(cas[0].where.description).toBe(readDescription);
      }
    });

    it('W151: CAS trượt thì ghi một dòng log để vận hành biết mô tả Pancake bị bỏ lượt này; CAS khớp thì không log', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      try {
        await raceRun('Xoài', PANCAKE_120);
        expect(log.mock.calls.filter(([m]) => String(m).includes('Bỏ qua mô tả Pancake'))).toHaveLength(1);
        log.mockClear();
        await raceRun('Xoài', PANCAKE_120, true, 'never');
        expect(log.mock.calls.filter(([m]) => String(m).includes('Bỏ qua mô tả Pancake'))).toHaveLength(0);
      } finally {
        log.mockRestore();
      }
    });

    it('W151: lệnh update chính không bao giờ mang khoá description, kể cả khi Pancake ghi mô tả mới', async () => {
      const { prisma } = await raceRun('Xoài', PANCAKE_120, true, 'never');
      expect(mk(prisma).product.update.mock.calls[0][0].data).not.toHaveProperty('description');
    });

    it('W151: giữ mô tả (không ghi mô tả Pancake) thì không có lệnh có điều kiện nào chạm cột description', async () => {
      const { prisma } = await raceRun(RICH, PANCAKE_120, true, 'never');
      expect(mk(prisma).product.updateMany.mock.calls.filter(([a]) => 'description' in a.data)).toHaveLength(0);
    });

    it('tạo mới luôn mang description: chữ Pancake nếu có, chuỗi rỗng nếu trống', async () => {
      const withText = makePrisma();
      await new PancakeSyncService(withText, makeClient([[product('w150n1', [variation('v-w150n1')], { description: PANCAKE_120 })]]), lifecycle).syncProducts(SINCE);
      expect((mk(withText).product.create.mock.calls[0][0].data as Record<string, unknown>).description).toBe(PANCAKE_120);
      const blank = makePrisma();
      await new PancakeSyncService(blank, makeClient([[product('w150n2', [variation('v-w150n2')], { description: '<p></p>' })]]), lifecycle).syncProducts(SINCE);
      expect((mk(blank).product.create.mock.calls[0][0].data as Record<string, unknown>).description).toBe('');
    });
  });

  describe('W150A: sản phẩm đổi tên trên Pancake, mô tả cũ từ 80 ký tự là bản chép nguyên tên cũ', () => {
    const OLD_NAME = 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 Gói Thơm Ngon Đặc Biệt Nhập Khẩu Chính Hãng';
    const NEW_NAME = 'Cà Phê Muối C&Sea Huế Hộp 10 Gói';
    const PANCAKE_120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';
    const REAL_RICH = 'Cà phê muối C&Sea đóng hộp mười gói, mỗi gói mười sáu gam, pha cùng nước nóng hoặc nước đá; mô tả do TubuTree biên tập.';
    const runRenamed = async (existingDescription: string, pancakeDescription: unknown, withKey = true) => {
      const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue({ ...approved, name: OLD_NAME, description: existingDescription }) } });
      const payload = { ...product('w126', [variation('v-w126')], withKey ? { description: pancakeDescription } : {}), name: NEW_NAME };
      await new PancakeSyncService(prisma, makeClient([[payload]]), lifecycle).syncProducts(SINCE);
      expect(mk(prisma).product.update).toHaveBeenCalledTimes(1);
      return writtenData(prisma);
    };

    it('tiền đề: tên cũ và mô tả giàu thật đều từ 80 ký tự', () => {
      expect(OLD_NAME.length).toBeGreaterThanOrEqual(80);
      expect(REAL_RICH.length).toBeGreaterThanOrEqual(80);
    });

    it.each([
      ['nguyên văn', OLD_NAME],
      ['bọc HTML', `<p>${OLD_NAME}</p>`],
      ['chữ hoa', OLD_NAME.toUpperCase()],
    ])('Pancake gửi mô tả thật từ 40 ký tự: bản chép tên cũ (%s) được thay, không bị khoá vĩnh viễn', async (_label, copy) => {
      const data = await runRenamed(copy, PANCAKE_120);
      expect(data.description).toBe(PANCAKE_120);
      expect(data.name).toBe(NEW_NAME);
      expect((await runRenamed(copy, `<p>${PANCAKE_120}</p>`)).description).toBe(`<p>${PANCAKE_120}</p>`);
    });

    it.each([[''], ['<p><br></p>'], [null], [undefined]])('Pancake gửi mô tả trống %j: giữ tạm bản chép tên cũ, không xoá trắng (bản ghi không mang khoá description)', async (pancakeDescription) => {
      const data = await runRenamed(OLD_NAME, pancakeDescription);
      expect(data).not.toHaveProperty('description');
      expect(data.name).toBe(NEW_NAME);
    });

    it('Pancake không gửi khoá description: giữ tạm bản chép tên cũ', async () => {
      expect(await runRenamed(OLD_NAME, undefined, false)).not.toHaveProperty('description');
    });

    it('Pancake chỉ gửi cụm POS ngắn dưới 40 ký tự: vẫn giữ bản chép tên cũ, không để cụm ngắn thay vào', async () => {
      expect(await runRenamed(OLD_NAME, 'Hộp 10 gói')).not.toHaveProperty('description');
    });

    it('mô tả giàu thật của TubuTree (không trùng tên cũ) vẫn được khoá dù sản phẩm vừa đổi tên', async () => {
      expect(await runRenamed(REAL_RICH, PANCAKE_120)).not.toHaveProperty('description');
      expect(await runRenamed(`<p>${REAL_RICH}</p>`, '')).not.toHaveProperty('description');
    });

    it('sản phẩm chưa đổi tên, mô tả chép đúng tên đó (từ 80 ký tự): Pancake chữ thật vẫn thay (không đổi so với W149A)', async () => {
      const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue({ ...approved, name: OLD_NAME, description: OLD_NAME }) } });
      const payload = { ...product('w126', [variation('v-w126')], { description: PANCAKE_120 }), name: OLD_NAME };
      await new PancakeSyncService(prisma, makeClient([[payload]]), lifecycle).syncProducts(SINCE);
      expect(writtenData(prisma).description).toBe(PANCAKE_120);
    });
  });

  it.each([[''], ['Mô tả từ Pancake'], [null]])('bản ghi cập nhật không bao giờ mang shortDesc hay ingredients (mô tả Pancake %j)', async (pancakeDescription) => {
    const data = await runUpdate(pancakeDescription);
    expect(data).not.toHaveProperty('shortDesc');
    expect(data).not.toHaveProperty('ingredients');
  });

  it('bản ghi tạo mới cũng không mang shortDesc hay ingredients; mô tả Pancake trống thì mô tả là chuỗi rỗng, không phải null', async () => {
    const prisma = makePrisma();
    await new PancakeSyncService(prisma, makeClient([[product('w126n', [variation('v-w126n')], { description: '  ' })]]), lifecycle).syncProducts(SINCE);
    const data = mk(prisma).product.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.description).toBe('');
    expect(data).not.toHaveProperty('shortDesc');
    expect(data).not.toHaveProperty('ingredients');
  });
});
