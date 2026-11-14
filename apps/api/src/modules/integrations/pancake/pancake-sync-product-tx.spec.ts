import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';
import { PancakeSyncService } from './pancake-sync.service';
import type { PancakeClient } from './pancake.client';

/**
 * W153: mọi lệnh ghi lên hàng `products` của sản phẩm đã có (update chính + mô tả/danh mục/nhãn có điều kiện) đi chung MỘT giao dịch.
 * Kho giả bên dưới có giao dịch thật theo nghĩa hoàn tác: lệnh trong `$transaction` ghi vào bản nháp, chỉ gộp vào hàng đã chốt khi cả callback trả về;
 * callback ném thì bản nháp bị bỏ. Lệnh ghi ngoài giao dịch ghi thẳng vào hàng đã chốt, nên ai quay lại ghi ngoài giao dịch sẽ làm test đỏ.
 */

const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
const SINCE = '2026-11-14T00:00:00.000Z';
const PANCAKE_120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type FailAt = 'update' | 'description' | 'brand' | null;

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

/** Khớp đúng các dạng `where` mà đồng bộ dùng: id, description bằng, brand `in`, categoryIds `isEmpty`. */
function matches(where: Where, row: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond !== null && typeof cond === 'object') {
      const c = cond as { in?: unknown[]; isEmpty?: boolean };
      if (c.in) return c.in.includes(row[k]);
      if (c.isEmpty !== undefined) return (Array.isArray(row[k]) && (row[k] as unknown[]).length === 0) === c.isEmpty;
    }
    return row[k] === cond;
  });
}

function makeStore(initial: Row, failAt: FailAt) {
  const committed: Row = { ...initial };
  const productApi = (target: Row) => ({
    update: jest.fn(async ({ data }: { data: Row }) => {
      if (failAt === 'update') throw new Error('deadlock detected');
      Object.assign(target, data);
      return { ...target };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Row }) => {
      if (failAt === 'description' && 'description' in data) throw new Error('connection reset');
      if (failAt === 'brand' && 'brand' in data) throw new Error('connection reset');
      if (!matches(where, target)) return { count: 0 };
      Object.assign(target, data);
      return { count: 1 };
    }),
  });
  const outerProduct = {
    ...productApi(committed),
    findUnique: jest.fn(async () => ({ ...committed })),
    create: jest.fn(async ({ data }: { data: Row }) => ({ id: 'p-new', ...data })),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const txProducts: ReturnType<typeof productApi>[] = [];
  const prisma = {
    product: outerProduct,
    variation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wishlist: { findMany: jest.fn().mockResolvedValue([]) },
    opsHealthState: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ holder: 'this-run' }]),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged: Row = { ...committed };
      const product = productApi(staged);
      txProducts.push(product);
      const out = await fn({ product });
      Object.assign(committed, staged);
      return out;
    }),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, committed, txProducts };
}

const EXISTING: Row = {
  id: 'p-1',
  pancakeId: 'x1',
  slug: 'xit-tram-cho-be-pineboo-150ml-b70d1d',
  name: 'Xịt tràm cho bé Pineboo 150ml',
  brand: 'Tubu Tree',
  description: 'Xoài',
  images: ['https://img/a.jpg'],
  thumbnail: 'https://img/a.jpg',
  basePrice: 1000,
  isActive: true,
  pancakeHold: null,
  categoryIds: ['c1'],
  forSegment: ['MOM_BABY'],
};

const payload = (over: Row = {}) => ({
  id: 'x1',
  name: 'Xịt tràm cho bé Pineboo 150ml mới',
  description: PANCAKE_120,
  variations: [{ id: 'v-x1', sku: 's', retail_price: 2000, remain_quantity: 5, fields: { size: '150ml' }, images: ['https://img/a.jpg'] }],
  ...over,
});

async function run(failAt: FailAt, rows: unknown[] = [payload()], initial: Row | null = EXISTING) {
  const store = makeStore(initial ?? EXISTING, failAt);
  if (initial === null) store.raw.product.findUnique.mockResolvedValue(null as never);
  const n = await new PancakeSyncService(store.prisma, makeClient([rows]), lifecycle).syncProducts(SINCE);
  return { ...store, n };
}

describe('W153: hàng sản phẩm đã có được ghi trong một giao dịch', () => {
  it('đủ ba lệnh (update, mô tả có điều kiện, nhãn có điều kiện) đều chạy trong giao dịch, không lệnh nào ghi products ngoài giao dịch', async () => {
    const { raw, txProducts, committed, n } = await run(null);
    expect(n).toBe(1);
    expect(raw.$transaction).toHaveBeenCalledTimes(1);
    expect(raw.product.update).not.toHaveBeenCalled();
    expect(raw.product.updateMany).not.toHaveBeenCalled();
    expect(txProducts).toHaveLength(1);
    expect(txProducts[0]?.update).toHaveBeenCalledTimes(1);
    expect(txProducts[0]?.updateMany).toHaveBeenCalledTimes(2);
    expect(committed).toMatchObject({ name: 'Xịt tràm cho bé Pineboo 150ml mới', basePrice: 2000, description: PANCAKE_120, brand: 'Pineboo' });
  });

  it.each<[string, FailAt]>([
    ['lệnh update chính', 'update'],
    ['lệnh ghi mô tả có điều kiện', 'description'],
    ['lệnh ghi nhãn có điều kiện', 'brand'],
  ])('%s lỗi giữa giao dịch: hàng sản phẩm giữ nguyên toàn bộ (tên, giá gốc, mô tả, nhãn), không nửa vời', async (_label, failAt) => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { committed, n } = await run(failAt);
      expect(committed).toMatchObject({ name: EXISTING.name, basePrice: 1000, description: 'Xoài', brand: 'Tubu Tree' });
      expect(n).toBe(0);
      expect(error.mock.calls.filter(([m]) => String(m).includes('Ghi hàng sản phẩm Pancake x1 lỗi'))).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });

  it.each<[string, FailAt]>([
    ['lệnh update chính', 'update'],
    ['lệnh ghi mô tả có điều kiện', 'description'],
    ['lệnh ghi nhãn có điều kiện', 'brand'],
  ])('%s lỗi: biến thể của sản phẩm vẫn được đồng bộ giá/tồn (không chờ lượt quét đêm), sản phẩm vẫn tính là lỗi', async (_label, failAt) => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { raw, n } = await run(failAt);
      expect(raw.variation.upsert).toHaveBeenCalledTimes(1);
      expect(raw.variation.upsert.mock.calls[0][0]).toMatchObject({ where: { pancakeId: 'v-x1' }, update: { retailPrice: 2000 } });
      expect(raw.$executeRaw).toHaveBeenCalled();
      expect(n).toBe(0);
    } finally {
      error.mockRestore();
    }
  });

  it('đánh dấu nạp lại ảnh chỉ khi giao dịch hàng sản phẩm chốt: giao dịch hỏng thì không đánh dấu, ảnh chưa vào DB', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const withNewImage = () => payload({ variations: [{ id: 'v-x1', sku: 's', retail_price: 2000, remain_quantity: 5, fields: {}, images: ['https://img/moi.jpg'] }] });
      for (const [failAt, stale] of [[null, 1], ['brand', 0]] as const) {
        const store = makeStore(EXISTING, failAt);
        const markStale = jest.fn();
        await new PancakeSyncService(store.prisma, makeClient([[withNewImage()]]), lifecycle, undefined, undefined, { markStale } as never).syncProducts(SINCE);
        expect(markStale).toHaveBeenCalledTimes(stale);
      }
    } finally {
      error.mockRestore();
    }
  });

  it('admin lưu mô tả xen giữa: lệnh có điều kiện không khớp dòng nào, giao dịch vẫn chốt các phần còn lại và mô tả của admin còn nguyên', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const store = makeStore(EXISTING, null);
      // Admin lưu xong sau lúc đồng bộ đọc `findUnique` (ảnh chụp mô tả cũ) và trước lúc giao dịch chạy.
      store.raw.product.findUnique.mockImplementationOnce(async () => {
        const snapshot = { ...store.committed };
        store.committed.description = 'Mô tả mới do Admin vừa lưu';
        return snapshot;
      });
      const n = await new PancakeSyncService(store.prisma, makeClient([[payload()]]), lifecycle).syncProducts(SINCE);
      expect(n).toBe(1);
      expect(store.committed).toMatchObject({ description: 'Mô tả mới do Admin vừa lưu', name: 'Xịt tràm cho bé Pineboo 150ml mới', brand: 'Pineboo' });
      expect(log.mock.calls.filter(([m]) => String(m).includes('Bỏ qua mô tả Pancake'))).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it('sản phẩm mới: một lệnh create, không mở giao dịch', async () => {
    const { raw, n } = await run(null, [payload({ id: 'x2', variations: [{ id: 'v-x2', sku: 's2', retail_price: 1500, remain_quantity: 1, fields: {}, images: [] }] })], null);
    expect(n).toBe(1);
    expect(raw.product.create).toHaveBeenCalledTimes(1);
    expect(raw.$transaction).not.toHaveBeenCalled();
  });
});
