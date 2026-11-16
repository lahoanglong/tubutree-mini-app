import type { PrismaService } from '../../../prisma/prisma.service';
import type { LifecycleService } from '../../lifecycle/lifecycle.service';
import { PancakeSyncService } from './pancake-sync.service';
import type { PancakeClient } from './pancake.client';

/**
 * W181: đồng bộ media Pancake. Kho giả có trạng thái: hàng `products` đã chốt được đọc lại ở lượt đồng bộ sau, nên chạy hai lượt liên tiếp
 * kiểm được đúng chuyện "ảnh Pancake đi trước, ảnh admin giữ, ảnh Pancake bị xoá thì gỡ".
 */

const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
type Row = Record<string, unknown>;

const A = 'https://content.pancake.vn/a.jpg';
const B = 'https://content.pancake.vn/b.jpg';
const C = 'https://content.pancake.vn/c.jpg';
const ADMIN = 'https://res.cloudinary.com/tubu/admin-lifestyle.jpg';
const ADMIN_B64 = 'data:image/png;base64,QUJDREVGRw==';
const V1 = 'https://content.pancake.vn/video1.mp4';
const V2 = 'https://content.pancake.vn/video2.mp4';

function makeClient(rounds: unknown[][]): PancakeClient {
  let call = 0;
  return {
    isConfigured: () => true,
    fetchProducts: jest.fn(async () => {
      const data = rounds[call] ?? [];
      call++;
      return { success: true, data, total_pages: 1, total_entries: data.length };
    }),
  } as unknown as PancakeClient;
}

function makeStore(initial: Row | null) {
  let row: Row | null = initial ? { ...initial } : null;
  const productApi = {
    update: jest.fn(async ({ data }: { data: Row }) => {
      Object.assign(row as Row, data, { updatedAt: new Date(Number((row as Row).updatedAt ?? 0) + 1) });
      return { ...(row as Row) };
    }),
    // Chỉ lệnh ghi ảnh (có điều kiện `updatedAt`) được áp dụng thật; các lệnh có điều kiện khác (mô tả, danh mục, nhãn) không liên quan tới spec này.
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      if (!('updatedAt' in where)) return { count: 1 };
      if (!row || Number(row.updatedAt ?? 0) !== Number(where.updatedAt ?? 0)) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(Number(row.updatedAt ?? 0) + 1) });
      return { count: 1 };
    }),
  };
  const prisma = {
    product: {
      ...productApi,
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        row = { id: 'p-new', ...data };
        return { ...row };
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
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
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ product: productApi })),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, row: () => row as Row };
}

type Variation = Record<string, unknown>;
const variation = (id: string, over: Variation = {}): Variation => ({ id, sku: id, retail_price: 1000, remain_quantity: 5, fields: {}, images: [], videos: [], ...over });
const product = (variations: Variation[], over: Row = {}) => ({ id: 'x1', name: 'Tinh dầu sả chanh', variations, ...over });

const EXISTING: Row = {
  id: 'p-1',
  pancakeId: 'x1',
  slug: 'tinh-dau-sa-chanh-x1',
  name: 'Tinh dầu sả chanh',
  brand: 'Tubu Tree',
  description: 'Mô tả',
  images: [],
  pancakeImages: [],
  videos: [],
  thumbnail: null,
  updatedAt: new Date(1),
  basePrice: 1000,
  isActive: true,
  pancakeHold: null,
  categoryIds: ['c1'],
  forSegment: ['eco'],
};

async function sync(initial: Row | null, ...rounds: unknown[][]) {
  const store = makeStore(initial);
  // Mỗi lượt đọc một client riêng (một trang rồi trang rỗng), như mỗi lần cron chạy.
  for (const round of rounds) await new PancakeSyncService(store.prisma, makeClient([round]), lifecycle).syncProducts();
  return store;
}

describe('W181: gộp ảnh Pancake, không ghi đè', () => {
  it('sản phẩm mới: ảnh = ảnh Pancake (theo thứ tự), pancakeImages ghi nhớ đúng danh sách đó, thumbnail là ảnh đầu', async () => {
    const { row } = await sync(null, [product([variation('v1', { images: [A] }), variation('v2', { images: [B, A] })])]);
    expect(row()).toMatchObject({ images: [A, B], pancakeImages: [A, B], thumbnail: A });
  });

  it('ảnh admin thêm trên Tubu Tree được giữ qua nhiều lượt đồng bộ, đứng sau ảnh Pancake', async () => {
    const start = { ...EXISTING, images: [A, ADMIN, ADMIN_B64], pancakeImages: [A], thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: [A, B] })])], [product([variation('v1', { images: [A, B] })])]);
    expect(row().images).toEqual([A, B, ADMIN, ADMIN_B64]);
    expect(row().pancakeImages).toEqual([A, B]);
    expect(row().thumbnail).toBe(A);
  });

  it('ảnh Pancake bị xoá trên Pancake thì gỡ khỏi web; ảnh admin còn', async () => {
    const start = { ...EXISTING, images: [A, B, ADMIN], pancakeImages: [A, B], thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: [A] })])]);
    expect(row().images).toEqual([A, ADMIN]);
    expect(row().pancakeImages).toEqual([A]);
  });

  it('Pancake đổi ảnh đầu: ảnh mới lên đầu và thành thumbnail, ảnh Pancake cũ gỡ, ảnh admin giữ', async () => {
    const start = { ...EXISTING, images: [A, ADMIN], pancakeImages: [A], thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: [C] })])]);
    expect(row()).toMatchObject({ images: [C, ADMIN], pancakeImages: [C], thumbnail: C });
  });

  it('dữ liệu có từ trước khi có cột pancakeImages: ảnh đang lưu mà Pancake không có đều giữ (không mất ảnh nào)', async () => {
    const start = { ...EXISTING, images: [A, ADMIN], pancakeImages: undefined, thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: [A, B] })])]);
    expect(row().images).toEqual([A, B, ADMIN]);
  });

  it('Pancake không gửi ảnh nào (thiếu trường hoặc danh sách rỗng): giữ nguyên ảnh, thumbnail và pancakeImages, không xoá gì', async () => {
    const start = { ...EXISTING, images: [A, B, ADMIN], pancakeImages: [A, B], thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: undefined })])], [product([variation('v1', { images: [] })])]);
    expect(row()).toMatchObject({ images: [A, B, ADMIN], pancakeImages: [A, B], thumbnail: A });
  });

  it('ảnh ở máy chủ ảnh của Pancake mà nay Pancake không gửi cũng gỡ kể cả khi chưa có pancakeImages (hàng cũ); ảnh admin giữ', async () => {
    const start = { ...EXISTING, images: [C, ADMIN], pancakeImages: undefined, thumbnail: C };
    const { row } = await sync(start, [product([variation('v1', { images: [A] })])]);
    expect(row()).toMatchObject({ images: [A, ADMIN], pancakeImages: [A], thumbnail: A });
  });

  it('admin lưu ảnh xen giữa lúc đồng bộ: lệnh ghi ảnh không khớp dòng nào, ảnh admin còn nguyên, các cột Pancake khác vẫn ghi', async () => {
    const store = makeStore({ ...EXISTING, images: [A], pancakeImages: [A], thumbnail: A });
    store.raw.product.findUnique.mockImplementationOnce(async () => {
      const snapshot = { ...store.row() };
      Object.assign(store.row(), { images: [A, ADMIN], updatedAt: new Date(2) });
      return snapshot;
    });
    const markStale = jest.fn();
    await new PancakeSyncService(store.prisma, makeClient([[product([variation('v1', { images: [A, B], videos: [V1] })])]]), lifecycle, undefined, undefined, { markStale } as never).syncProducts();
    expect(store.row().images).toEqual([A, ADMIN]);
    expect(store.row().pancakeImages).toEqual([A, B]);
    expect(store.row().videos).toEqual([V1]);
    expect(markStale).not.toHaveBeenCalled();
  });

  it('ảnh đổi và không ai xen vào: ghi ảnh và đánh dấu nạp lại ảnh đúng một lần', async () => {
    const store = makeStore({ ...EXISTING, images: [A], pancakeImages: [A], thumbnail: A });
    const markStale = jest.fn();
    await new PancakeSyncService(store.prisma, makeClient([[product([variation('v1', { images: [A, B] })])]]), lifecycle, undefined, undefined, { markStale } as never).syncProducts();
    expect(store.row().images).toEqual([A, B]);
    expect(markStale).toHaveBeenCalledTimes(1);
  });

  it('ảnh y nguyên thì không đổi gì (thứ tự, thumbnail)', async () => {
    const start = { ...EXISTING, images: [A, B, ADMIN], pancakeImages: [A, B], thumbnail: A };
    const { row } = await sync(start, [product([variation('v1', { images: [A, B] })])]);
    expect(row()).toMatchObject({ images: [A, B, ADMIN], pancakeImages: [A, B], thumbnail: A });
  });
});

describe('W181: video từ variations[].videos', () => {
  it('sản phẩm mới: chuỗi URL và object có url, chỉ http/https, bỏ trùng', async () => {
    const { row } = await sync(null, [
      product([
        variation('v1', { videos: [V1, { url: V2 }, 'javascript:alert(1)', 'data:video/mp4;base64,AAAA', '/rel.mp4'] }),
        variation('v2', { videos: [{ url: V1 }, { link: 'https://x/y.mp4' }, 7, null] }),
      ]),
    ]);
    expect(row().videos).toEqual([V1, V2]);
  });

  it('Pancake gỡ hết video (videos: []): xoá khỏi web', async () => {
    const { row } = await sync({ ...EXISTING, videos: [V1] }, [product([variation('v1', { videos: [] })])]);
    expect(row().videos).toEqual([]);
  });

  it('Pancake không gửi trường videos ở biến thể nào: giữ video đang lưu', async () => {
    const noField = variation('v1');
    delete noField.videos;
    const { row } = await sync({ ...EXISTING, videos: [V1] }, [product([noField])]);
    expect(row().videos).toEqual([V1]);
  });

  it('video đổi: thay bằng danh sách mới của Pancake', async () => {
    const { row } = await sync({ ...EXISTING, videos: [V1] }, [product([variation('v1', { videos: [V2] })])]);
    expect(row().videos).toEqual([V2]);
  });
});

describe('W181: ảnh gắn biến thể', () => {
  it('biến thể ghi ảnh đầu của nó (imageUrl); biến thể không ảnh thì NULL', async () => {
    const { raw } = await sync(null, [product([variation('v1', { images: [B, C] }), variation('v2', { images: [] })])]);
    const calls = raw.variation.upsert.mock.calls.map(([arg]: [{ where: { pancakeId: string }; create: Row; update: Row }]) => arg);
    const v1 = calls.find((c: { where: { pancakeId: string } }) => c.where.pancakeId === 'v1');
    const v2 = calls.find((c: { where: { pancakeId: string } }) => c.where.pancakeId === 'v2');
    expect(v1?.create.imageUrl).toBe(B);
    expect(v1?.update.imageUrl).toBe(B);
    expect(v2?.create.imageUrl).toBeNull();
    expect(v2?.update.imageUrl).toBeNull();
  });
});
