import { Logger } from '@nestjs/common';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import { PancakeSyncService } from './pancake-sync.service';
import { ZERO_PRICE_STATE_KEY, summarizeZeroPrice, type ZeroPriceAnomaly } from './pancake-zero-price';
import { CATALOG_STATE_KEY } from '../../ops/ops-state';

const SINCE = '2026-11-13T00:00:00.000Z';
const notifyPriceDrop = jest.fn().mockResolvedValue(undefined);
const lifecycle = { notifyWishlistPriceDrop: notifyPriceDrop } as unknown as LifecycleService;

let warn: jest.SpyInstance;
beforeEach(() => {
  notifyPriceDrop.mockClear();
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

function makeClient(pages: unknown[][]): PancakeClient {
  let call = 0;
  const filled = pages.filter((p) => p.length > 0);
  return {
    isConfigured: () => true,
    fetchProducts: jest.fn(async () => ({ success: true, data: pages[call++] ?? [], total_pages: filled.length, total_entries: filled.flat().length })),
  } as unknown as PancakeClient;
}

type Prev = { retailPrice: number; salePrice: number | null; isActive: boolean; pancakeHold: string | null } | null;

/** Prisma giả: `ops` giữ các hàng ops_health_states như bảng thật (key → bản ghi cuối), `prevByVariation` là biến thể đã có trên Tubu. */
function makePrisma(opts: { prevByVariation?: Record<string, Prev>; ops?: Map<string, { detail: unknown }>; opsUpsert?: jest.Mock; productCreate?: jest.Mock } = {}) {
  const ops = opts.ops ?? new Map<string, { detail: unknown }>();
  const upsert =
    opts.opsUpsert ??
    jest.fn(async ({ where, update }: { where: { key: string }; update: { detail?: unknown } }) => {
      ops.set(where.key, { detail: update.detail });
    });
  const prisma = {
    product: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: opts.productCreate ?? jest.fn().mockImplementation(async ({ data }) => ({ id: `prod-${data.pancakeId}`, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'existing', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    variation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(async ({ where }: { where: { pancakeId: string } }) => opts.prevByVariation?.[where.pancakeId] ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    opsHealthState: { upsert, findUnique: jest.fn(async ({ where }: { where: { key: string } }) => ops.get(where.key) ?? null) },
    wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ holder: 'this-run' }]),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, ops };
}

const variation = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sku: `S-${id}`,
  retail_price: 89_000,
  remain_quantity: 5,
  fields: { size: '500ml' },
  images: [`https://img/${id}.jpg`],
  ...over,
});
const product = (id: string, variations: unknown[], name = 'Lau sàn quế 500ml') => ({ id, name, variations });
const sellingAt = (retailPrice: number, over: Partial<NonNullable<Prev>> = {}): NonNullable<Prev> => ({ retailPrice, salePrice: null, isActive: true, pancakeHold: null, ...over });

async function run(rows: unknown[], setup: Parameters<typeof makePrisma>[0] = {}, updatedSince?: string) {
  const m = makePrisma(setup);
  const svc = new PancakeSyncService(m.prisma, makeClient([rows]), lifecycle);
  const n = await svc.syncProducts(updatedSince);
  const call = m.raw.variation.upsert.mock.calls[0]?.[0] as { update: Record<string, unknown>; create: Record<string, unknown> } | undefined;
  const zero = m.ops.get(ZERO_PRICE_STATE_KEY)?.detail as ReturnType<typeof summarizeZeroPrice> | undefined;
  const catalog = m.ops.get(CATALOG_STATE_KEY)?.detail;
  return { svc, n, call, zero, catalog, ...m };
}

const loggedZeroEvents = () =>
  warn.mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.includes('pancake.zeroPriceAnomalies'))
    .map((l) => JSON.parse(l.slice(l.indexOf('{"event"'))));

describe('W131: Pancake báo 0đ không được xoá giá đang bán, và phải để lại dấu vết cho admin', () => {
  it('SKU MỚI báo 0đ: giữ hành vi cũ (tạo NO_PRICE, ngừng bán, không hiện 0đ), ghi NEW_AT_ZERO và cảnh báo rõ', async () => {
    const r = await run([product('p1', [variation('v1', { retail_price: 0 })])]);
    expect(r.call!.create).toMatchObject({ retailPrice: 0, isActive: false, pancakeHold: 'NO_PRICE' });
    expect(r.zero).toMatchObject({ scope: 'FULL', count: 1, keptCount: 0, newCount: 1 });
    expect(r.zero!.skus[0]).toEqual({ pancakeId: 'v1', sku: 'S-v1', productName: 'Lau sàn quế 500ml', kind: 'NEW_AT_ZERO', keptPrice: null });
    expect(loggedZeroEvents()).toEqual([expect.objectContaining({ count: 1, newCount: 1, skus: [expect.objectContaining({ sku: 'S-v1', kind: 'NEW_AT_ZERO' })] })]);
    expect(r.catalog).toEqual({ count: 1, failed: 0, skipped: 0, zeroPriceAnomalies: 1 });
  });

  it('SKU đang bán 89.000đ mà Pancake báo 0đ: GIỮ 89.000đ, vẫn bán, ghi PRICE_KEPT kèm SKU + giá giữ, có dòng log cấu trúc', async () => {
    const r = await run([product('p1', [variation('v1', { retail_price: 0 })])], { prevByVariation: { v1: sellingAt(89_000) } });
    expect(r.call!.update).not.toHaveProperty('retailPrice');
    expect(r.call!.update).not.toHaveProperty('salePrice');
    expect(r.call!.update).not.toHaveProperty('isActive');
    expect(r.zero).toMatchObject({ count: 1, keptCount: 1, newCount: 0 });
    expect(r.zero!.skus[0]).toMatchObject({ sku: 'S-v1', kind: 'PRICE_KEPT', keptPrice: 89_000 });
    expect(loggedZeroEvents()).toHaveLength(1);
    expect(loggedZeroEvents()[0]).toMatchObject({ event: 'pancake.zeroPriceAnomalies', scope: 'FULL', keptCount: 1 });
    expect(r.svc.lastZeroPrice()).toMatchObject({ count: 1, keptCount: 1 });
    expect(r.catalog).toMatchObject({ zeroPriceAnomalies: 1 });
    expect(notifyPriceDrop).not.toHaveBeenCalled();
  });

  it('đổi giá hợp lệ 89.000đ → 79.000đ: áp dụng bình thường, không báo 0đ, danh sách rỗng, chi tiết lượt giữ dạng cũ', async () => {
    const r = await run([product('p1', [variation('v1', { retail_price: 79_000 })])], { prevByVariation: { v1: sellingAt(89_000) } });
    expect(r.call!.update).toMatchObject({ retailPrice: 79_000 });
    expect(r.zero).toMatchObject({ count: 0, skus: [] });
    expect(loggedZeroEvents()).toHaveLength(0);
    expect(r.catalog).toEqual({ count: 1, failed: 0, skipped: 0 });
    expect(notifyPriceDrop).toHaveBeenCalledTimes(1);
  });

  it('quà tặng có cờ is_gift mà Tubu chưa bán giá dương, biến thể Pancake đã xoá, biến thể admin tắt tay: giá 0đ không bị báo; giá Tubu vẫn không bị ghi 0đ', async () => {
    const r = await run(
      [
        product('pg', [variation('v-gift', { retail_price: 0, is_gift: true })]),
        product('pr', [variation('v-removed', { retail_price: 0, is_removed: true })]),
        product('pa', [variation('v-admin-off', { retail_price: 0 })]),
      ],
      { prevByVariation: { 'v-removed': sellingAt(89_000), 'v-admin-off': sellingAt(89_000, { isActive: false }) } },
    );
    expect(r.zero).toMatchObject({ count: 0 });
    expect(loggedZeroEvents()).toHaveLength(0);
    expect(r.raw.variation.upsert).toHaveBeenCalledTimes(3);
    for (const c of r.raw.variation.upsert.mock.calls) expect((c[0] as { update: object }).update).not.toHaveProperty('retailPrice');
  });

  it('cờ is_gift nhưng Tubu đang bán 89.000đ: giữ giá, vẫn báo PRICE_KEPT (cửa hàng lệch với POS)', async () => {
    const r = await run([product('pg', [variation('v-gift', { retail_price: 0, is_gift: true })])], { prevByVariation: { 'v-gift': sellingAt(89_000) } });
    expect(r.call!.update).not.toHaveProperty('retailPrice');
    expect(r.zero!.skus.map((s) => `${s.pancakeId}:${s.kind}`)).toEqual(['v-gift:PRICE_KEPT']);
  });

  it.each([['0.000'], ['0.00'], ['0']])('Pancake gửi giá chuỗi retail_price=%j: giữ 89.000đ và vẫn ghi PRICE_KEPT (dạng "0.000" như "269000.000" trước đây bị bỏ sót)', async (retail) => {
    const r = await run([product('p1', [variation('v1', { retail_price: retail })])], { prevByVariation: { v1: sellingAt(89_000) } });
    expect(r.call!.update).not.toHaveProperty('retailPrice');
    expect(r.zero!.skus.map((s) => `${s.pancakeId}:${s.kind}:${s.keptPrice}`)).toEqual(['v1:PRICE_KEPT:89000']);
    expect(loggedZeroEvents()).toHaveLength(1);
  });

  it('thiếu giá (undefined/rác) không phải 0đ tường minh: không vào danh sách 0đ', async () => {
    const r = await run([product('p1', [variation('v1', { retail_price: undefined }), variation('v2', { retail_price: 'abc' })])], {
      prevByVariation: { v1: sellingAt(89_000), v2: sellingAt(50_000) },
    });
    expect(r.zero).toMatchObject({ count: 0 });
  });

  it('một sản phẩm nhiều biến thể: chỉ biến thể 0đ bị báo, biến thể còn lại đổi giá bình thường', async () => {
    const r = await run([product('p1', [variation('v1', { retail_price: 0 }), variation('v2', { retail_price: 95_000 })])], {
      prevByVariation: { v1: sellingAt(89_000), v2: sellingAt(90_000) },
    });
    expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v1']);
    const updates = r.raw.variation.upsert.mock.calls.map((c) => c[0] as { where: { pancakeId: string }; update: Record<string, unknown> });
    expect(updates.find((u) => u.where.pancakeId === 'v2')!.update).toMatchObject({ retailPrice: 95_000 });
  });

  describe('danh sách lưu cho admin giữa các lượt', () => {
    const stored = (...a: Array<Partial<ZeroPriceAnomaly> & { pancakeId: string }>) =>
      new Map([
        [
          ZERO_PRICE_STATE_KEY,
          {
            detail: summarizeZeroPrice(
              a.map((x) => ({ sku: `S-${x.pancakeId}`, productName: 'cũ', kind: 'PRICE_KEPT' as const, keptPrice: 50_000, ...x })),
              'FULL',
            ),
          },
        ],
      ]);

    it('lượt quét toàn bộ thay hẳn danh sách: SKU đã sửa trên Pancake biến mất', async () => {
      const r = await run([product('p1', [variation('v-fixed', { retail_price: 70_000 })])], { ops: stored({ pancakeId: 'v-fixed' }) });
      expect(r.zero).toMatchObject({ count: 0, skus: [], scope: 'FULL' });
    });

    it('lượt 15 phút (tăng dần) gộp vào danh sách đang lưu, không xoá danh sách của lượt quét đêm', async () => {
      const r = await run(
        [product('p1', [variation('v-new', { retail_price: 0 })])],
        { ops: stored({ pancakeId: 'v-old' }), prevByVariation: { 'v-new': sellingAt(89_000) } },
        SINCE,
      );
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-old', 'v-new']);
      expect(r.zero).toMatchObject({ count: 2, scope: 'FULL' });
    });

    it('lượt tăng dần thấy SKU đã có giá dương trở lại: gỡ khỏi danh sách', async () => {
      const r = await run([product('p1', [variation('v-old', { retail_price: 60_000 })])], { ops: stored({ pancakeId: 'v-old' }, { pancakeId: 'v-other' }) }, SINCE);
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-other']);
    });

    it('lượt tăng dần sạch, danh sách không đổi: không ghi lại hàng 0đ (chỉ ghi hàng trạng thái danh mục)', async () => {
      const r = await run([product('p1', [variation('v1')])], { ops: stored({ pancakeId: 'v-old' }), prevByVariation: { v1: sellingAt(89_000) } }, SINCE);
      const keys = r.raw.opsHealthState.upsert.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key);
      expect(keys).toEqual([CATALOG_STATE_KEY]);
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-old']);
    });

    it('lượt quét toàn bộ có sản phẩm bị bỏ qua (thiếu tên): SKU của nó (chưa đọc được) vẫn còn, SKU đã biến khỏi Pancake bị gỡ', async () => {
      const r = await run(
        [product('p-draft', [variation('v-old', { retail_price: 0 })], ''), product('p1', [variation('v1', { retail_price: 70_000 })])],
        { ops: stored({ pancakeId: 'v-old' }, { pancakeId: 'v-other' }), prevByVariation: { v1: sellingAt(70_000) } },
      );
      expect(r.catalog).toMatchObject({ skipped: 1, failed: 0 });
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-old']);
    });

    it('lượt quét toàn bộ có sản phẩm lỗi khi ghi: chỉ gộp, SKU của nó (chưa đọc hết) vẫn còn, SKU đã biến khỏi Pancake bị gỡ', async () => {
      const productCreate = jest.fn().mockRejectedValue(new Error('slug trùng'));
      const r = await run([product('p1', [variation('v1', { retail_price: 0 })])], { ops: stored({ pancakeId: 'v1' }, { pancakeId: 'v-gone' }), productCreate });
      expect(r.catalog).toMatchObject({ failed: 1 });
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v1']);
    });

    it('lượt quét toàn bộ có sản phẩm nháp: biến thể đã đọc mà hết 0đ vẫn được gỡ như thường', async () => {
      const r = await run(
        [product('p-draft', [variation('v-draft')], ''), product('p1', [variation('v-fixed', { retail_price: 70_000 })])],
        { ops: stored({ pancakeId: 'v-fixed' }, { pancakeId: 'v-draft' }), prevByVariation: { 'v-fixed': sellingAt(70_000) } },
      );
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-draft']);
    });

    it('lượt quét toàn bộ có phần tử không phải sản phẩm (không biết nó che biến thể nào): không gỡ mục nào theo kiểu "không còn thấy", chỉ gộp', async () => {
      const r = await run(
        [null, product('p1', [variation('v1', { retail_price: 70_000 })])],
        { ops: stored({ pancakeId: 'v-old' }, { pancakeId: 'v-gone' }), prevByVariation: { v1: sellingAt(70_000) } },
      );
      expect(r.catalog).toMatchObject({ failed: 1 });
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-old', 'v-gone']);
    });

    it('trang đầu rỗng (Pancake trả 0 sản phẩm): danh sách đang lưu không bị thay bằng danh sách rỗng', async () => {
      const r = await run([], { ops: stored({ pancakeId: 'v-old' }, { pancakeId: 'v-other' }) });
      expect(r.n).toBe(0);
      expect(r.zero!.skus.map((s) => s.pancakeId)).toEqual(['v-old', 'v-other']);
      const keys = r.raw.opsHealthState.upsert.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key);
      expect(keys).not.toContain(ZERO_PRICE_STATE_KEY);
    });

    it('Pancake không báo tổng trang/tổng bản ghi nên không chứng minh được đã quét hết: danh sách đang lưu không bị thay hẳn', async () => {
      const m = makePrisma({ ops: stored({ pancakeId: 'v-old' }, { pancakeId: 'v-other' }), prevByVariation: { v1: sellingAt(70_000) } });
      let call = 0;
      const client = {
        isConfigured: () => true,
        fetchProducts: jest.fn(async () => ({ success: true, data: call++ === 0 ? [product('p1', [variation('v1', { retail_price: 70_000 })])] : [] })),
      } as unknown as PancakeClient;
      await new PancakeSyncService(m.prisma, client, lifecycle).syncProducts();
      const zero = m.ops.get(ZERO_PRICE_STATE_KEY)!.detail as ReturnType<typeof summarizeZeroPrice>;
      expect(zero.skus.map((s) => s.pancakeId)).toEqual(['v-old', 'v-other']);
    });
  });

  it('ghi danh sách 0đ lỗi: lượt đồng bộ vẫn thành công, trạng thái danh mục vẫn ghi, có cảnh báo', async () => {
    const ops = new Map<string, { detail: unknown }>();
    const opsUpsert = jest.fn(async ({ where, update }: { where: { key: string }; update: { detail?: unknown } }) => {
      if (where.key === ZERO_PRICE_STATE_KEY) throw new Error('db down');
      ops.set(where.key, { detail: update.detail });
    });
    const r = await run([product('p1', [variation('v1', { retail_price: 0 })])], { ops, opsUpsert, prevByVariation: { v1: sellingAt(89_000) } });
    expect(r.n).toBe(1);
    expect(ops.get(CATALOG_STATE_KEY)?.detail).toMatchObject({ count: 1, failed: 0, zeroPriceAnomalies: 1 });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Không ghi được danh sách SKU giá 0đ'))).toBe(true);
  });
});
