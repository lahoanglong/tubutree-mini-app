import { BadRequestException, NotFoundException } from '@nestjs/common';
import { shelfVersion } from './merch-shelf';
import { MERCH_SHELF_EVENT_KIND, MerchShelvesService, normalizePins } from './merch-shelves.service';

type FakeProduct = {
  id: string;
  name: string;
  brand: string;
  slug: string;
  thumbnail: string | null;
  images: string[];
  shortDesc: string | null;
  categoryIds: string[];
  isActive: boolean;
  approvalStatus: string;
  variations: { isActive: boolean; stock: number }[];
};

const product = (id: string, over: Partial<FakeProduct> = {}): FakeProduct => ({
  id,
  name: `SP ${id}`,
  brand: `Brand ${id}`,
  slug: `sp-${id}`,
  thumbnail: null,
  images: [`https://img/${id}.webp`],
  shortDesc: 'Mô tả ngắn',
  categoryIds: ['cat-root'],
  isActive: true,
  approvalStatus: 'APPROVED',
  variations: [{ isActive: true, stock: 3 }],
  ...over,
});

type PinRow = { productId: string; position: number; startsAt: Date | null; endsAt: Date | null; note: string | null; updatedAt: Date };
const pin = (productId: string, position: number, over: Partial<PinRow> = {}): PinRow => ({
  productId,
  position,
  startsAt: null,
  endsAt: null,
  note: null,
  updatedAt: new Date('2026-11-18T01:00:00Z'),
  ...over,
});

const CATS = [
  { id: 'cat-root', name: 'Chăm sóc bé', slug: 'cham-soc-be', parentId: null, productCount: 4 },
  { id: 'cat-child', name: 'Tắm gội', slug: 'tam-goi', parentId: 'cat-root', productCount: 2 },
  { id: 'cat-other', name: 'Nhà cửa', slug: 'nha-cua', parentId: null, productCount: 0 },
];

function setup(opts: { products?: FakeProduct[]; rows?: PinRow[]; txRows?: PinRow[]; counts?: { flash?: number; bundles?: number; groups?: number } } = {}) {
  const products = opts.products ?? [];
  const rows = opts.rows ?? [];
  const byIdIn = (where: { id?: { in?: string[]; notIn?: string[] } } | undefined) => {
    if (where?.id?.in) return products.filter((p) => where.id!.in!.includes(p.id));
    const skip = new Set(where?.id?.notIn ?? []);
    return products.filter((p) => !skip.has(p.id));
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    merchShelfPin: { findMany: jest.fn().mockResolvedValue(opts.txRows ?? rows), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), upsert: jest.fn().mockResolvedValue({}) },
    userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    product: { findMany: jest.fn(async (args: { where?: { id?: { in?: string[]; notIn?: string[] } } }) => byIdIn(args.where)) },
    merchShelfPin: {
      findMany: jest.fn().mockResolvedValue(rows),
      groupBy: jest.fn().mockResolvedValue([{ shelfKey: 'home_featured', _count: { _all: 3 } }]),
    },
    flashSaleItem: { count: jest.fn().mockResolvedValue(opts.counts?.flash ?? 0) },
    bundle: { count: jest.fn().mockResolvedValue(opts.counts?.bundles ?? 0) },
    groupBuy: { count: jest.fn().mockResolvedValue(opts.counts?.groups ?? 0) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const catalog = {
    merchStatus: jest.fn().mockResolvedValue({ enabled: false, curated: true }),
    categoriesFlat: jest.fn().mockResolvedValue(CATS),
    cardsByIds: jest.fn(async (ids: string[]) =>
      ids
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is FakeProduct => Boolean(p) && p!.isActive && p!.approvalStatus === 'APPROVED')
        .map((p) => ({ id: p.id, name: p.name })),
    ),
    invalidateMerchShelves: jest.fn(),
  };
  const svc = new MerchShelvesService(prisma as never, catalog as never);
  return { svc, prisma, tx, catalog };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return { type: (err as Error).constructor.name, body: (err as { getResponse(): { code: string; productIds?: string[] } }).getResponse() };
  }
  throw new Error('expected rejection');
};

describe('normalizePins', () => {
  it('ghi chú rỗng thành null, cắt khoảng trắng; khung giờ ngược và món trùng bị chặn', () => {
    expect(normalizePins([{ productId: 'a', note: '  ' }, { productId: 'b', note: ' Tết ', startsAt: '2026-11-18T00:00:00Z', endsAt: '2026-11-19T00:00:00Z' }])).toEqual([
      { productId: 'a', startsAt: null, endsAt: null, note: null },
      { productId: 'b', startsAt: new Date('2026-11-18T00:00:00Z'), endsAt: new Date('2026-11-19T00:00:00Z'), note: 'Tết' },
    ]);
    expect(() => normalizePins([{ productId: 'a', startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-19T00:00:00Z' }])).toThrow(BadRequestException);
    expect(() => normalizePins([{ productId: 'a' }, { productId: 'a' }])).toThrow(BadRequestException);
  });
});

describe('MerchShelvesService.save', () => {
  const ready = [product('a'), product('b'), product('c')];

  it('món chưa có ảnh chặn lưu (400 PIN_NO_IMAGE), không mở giao dịch', async () => {
    const s = setup({ products: [...ready, product('noimg', { images: [], thumbnail: null })] });
    const r = await codeOf(s.svc.save({ key: 'home_featured', version: shelfVersion([]), pins: [{ productId: 'a' }, { productId: 'noimg' }] }, 'admin-1'));
    expect(r).toMatchObject({ type: 'BadRequestException', body: { code: 'PIN_NO_IMAGE', productIds: ['noimg'] } });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('món không còn trong bảng sản phẩm: 400 PIN_PRODUCT_NOT_FOUND', async () => {
    const s = setup({ products: ready });
    const r = await codeOf(s.svc.save({ key: 'home_featured', version: shelfVersion([]), pins: [{ productId: 'ghost' }] }, 'admin-1'));
    expect(r).toMatchObject({ body: { code: 'PIN_PRODUCT_NOT_FOUND', productIds: ['ghost'] } });
  });

  it('khoá kệ sai dạng 400, danh mục không còn 404', async () => {
    const s = setup({ products: ready });
    await expect(s.svc.save({ key: 'brand:x', version: 'v', pins: [] }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.svc.save({ key: 'category:khong-con', version: 'v', pins: [] }, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('kệ đã đổi từ lúc admin mở (phiên bản lệch): 409 SHELF_CHANGED, khoá theo kệ, không ghi gì, không xoá bộ nhớ', async () => {
    const s = setup({ products: ready, rows: [], txRows: [pin('c', 0)] });
    const r = await codeOf(s.svc.save({ key: 'home_featured', version: shelfVersion([]), pins: [{ productId: 'a' }] }, 'admin-2'));
    expect(r).toMatchObject({ type: 'ConflictException', body: { code: 'SHELF_CHANGED' } });
    expect(s.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((s.tx.$executeRaw.mock.calls[0] as unknown[]).slice(1)).toEqual(['merch-shelf:home_featured']);
    expect(s.tx.merchShelfPin.upsert).not.toHaveBeenCalled();
    expect(s.tx.merchShelfPin.deleteMany).not.toHaveBeenCalled();
    expect(s.tx.userAdminEvent.create).not.toHaveBeenCalled();
    expect(s.catalog.invalidateMerchShelves).not.toHaveBeenCalled();
  });

  it('lưu: gỡ món bỏ đi, ghi đúng thứ tự, người tạo chỉ ghi khi thêm mới, nhật ký ai đổi gì, rồi xoá bộ nhớ của khách', async () => {
    const current = [pin('c', 0), pin('a', 1)];
    const s = setup({ products: ready, rows: current });
    await s.svc.save(
      { key: 'home_featured', version: shelfVersion(current), pins: [{ productId: 'b', note: 'Món mới' }, { productId: 'a', endsAt: '2026-12-01T00:00:00Z' }] },
      'admin-1',
    );
    expect(s.tx.merchShelfPin.deleteMany).toHaveBeenCalledWith({ where: { shelfKey: 'home_featured', productId: { in: ['c'] } } });
    const upserts = s.tx.merchShelfPin.upsert.mock.calls.map((c) => c[0] as { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> });
    expect(upserts.map((u) => u.where)).toEqual([
      { shelfKey_productId: { shelfKey: 'home_featured', productId: 'b' } },
      { shelfKey_productId: { shelfKey: 'home_featured', productId: 'a' } },
    ]);
    expect(upserts[0]!.create).toMatchObject({ shelfKey: 'home_featured', productId: 'b', position: 0, note: 'Món mới', createdById: 'admin-1' });
    expect(upserts[1]!.update).toMatchObject({ position: 1, endsAt: new Date('2026-12-01T00:00:00Z'), note: null });
    expect(upserts[1]!.update).not.toHaveProperty('createdById');
    expect(upserts[0]!.update.updatedAt).toBeInstanceOf(Date);
    expect(s.tx.userAdminEvent.create).toHaveBeenCalledWith({
      data: { userId: 'admin-1', kind: MERCH_SHELF_EVENT_KIND, fromValue: 'c,a', toValue: 'b,a', reason: 'shelf:home_featured', actorId: 'admin-1' },
    });
    expect(s.catalog.invalidateMerchShelves).toHaveBeenCalledTimes(1);
  });

  it('lưu kệ rỗng gỡ hết món, vẫn ghi nhật ký', async () => {
    const current = [pin('a', 0)];
    const s = setup({ products: ready, rows: current });
    await s.svc.save({ key: 'best_sellers', version: shelfVersion(current), pins: [] }, 'admin-1');
    expect(s.tx.merchShelfPin.deleteMany).toHaveBeenCalledWith({ where: { shelfKey: 'best_sellers', productId: { in: ['a'] } } });
    expect(s.tx.userAdminEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fromValue: 'a', toValue: '', reason: 'shelf:best_sellers' }) });
  });
});

describe('MerchShelvesService.getShelf', () => {
  it('cảnh báo từng món, `live` theo đang bán/còn hàng/khung giờ/danh mục, kệ danh mục gồm cả danh mục con', async () => {
    const products = [
      product('ok', { categoryIds: ['cat-child'] }),
      product('oos', { variations: [{ isActive: true, stock: 0 }], shortDesc: null }),
      product('hidden', { isActive: false }),
      product('outside', { categoryIds: ['cat-other'] }),
      product('later', { categoryIds: ['cat-root'] }),
    ];
    const rows = [pin('ok', 0), pin('oos', 1), pin('hidden', 2), pin('outside', 3), pin('later', 4, { startsAt: new Date(Date.now() + 3_600_000) })];
    const s = setup({ products, rows });
    const view = await s.svc.getShelf('category:cham-soc-be');
    expect(view).toMatchObject({ key: 'category:cham-soc-be', label: 'Đầu danh mục: Chăm sóc bé', maxPins: 12, version: shelfVersion(rows), status: { enabled: false, curated: true } });
    const by = new Map(view.pins.map((p) => [p.productId, p]));
    expect(by.get('ok')).toMatchObject({ warnings: [], live: true, card: { id: 'ok' } });
    expect(by.get('oos')).toMatchObject({ warnings: ['OUT_OF_STOCK', 'NO_SHORT_DESC'], live: false });
    expect(by.get('hidden')).toMatchObject({ warnings: ['NOT_ON_SALE'], live: false, card: null });
    expect(by.get('outside')).toMatchObject({ warnings: ['OUTSIDE_CATEGORY'], live: false });
    expect(by.get('later')).toMatchObject({ warnings: [], live: false });
    expect(view.pins.map((p) => p.productId)).toEqual(['ok', 'oos', 'hidden', 'outside', 'later']);
  });
});

describe('MerchShelvesService.suggest', () => {
  it('bỏ món đã ghim và món trong bản nháp, chỉ đọc (không ghi gì), tối đa 8 món, điều kiện sẵn sàng nằm ở truy vấn', async () => {
    const products = Array.from({ length: 12 }, (_, i) => product(`p${i}`, { brand: `B${i % 5}`, categoryIds: [`c${i % 3}`] }));
    const s = setup({ products, rows: [pin('p0', 0)] });
    const r = await s.svc.suggest('home_featured', ['p1']);
    expect(r.items).toHaveLength(8);
    expect(r.items.map((i) => i.productId)).not.toEqual(expect.arrayContaining(['p0']));
    expect(r.items.map((i) => i.productId)).not.toEqual(expect.arrayContaining(['p1']));
    const where = (s.prisma.product.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      isActive: true,
      approvalStatus: 'APPROVED',
      variations: { some: { isActive: true, stock: { gt: 0 } } },
      images: { isEmpty: false },
      categoryIds: { isEmpty: false },
      id: { notIn: ['p0', 'p1'] },
    });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('kệ danh mục chỉ gợi ý món thuộc danh mục đó hoặc danh mục con', async () => {
    const s = setup({ products: [product('x')] });
    await s.svc.suggest('category:cham-soc-be', []);
    const where = (s.prisma.product.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.categoryIds).toEqual({ hasSome: ['cat-root', 'cat-child'] });
    expect(where).not.toHaveProperty('id');
  });
});

describe('MerchShelvesService.emptyEntrances', () => {
  it('liệt kê lối vào trống trên dữ liệu thật kèm tab quản trị; có nội dung thì không liệt kê', async () => {
    const empty = await setup().svc.emptyEntrances();
    expect(empty.entrances).toEqual([
      expect.objectContaining({ key: 'flash', adminTab: 'flashSales' }),
      expect.objectContaining({ key: 'bundles', adminTab: 'bundles' }),
      expect.objectContaining({ key: 'groupBuys', adminTab: null }),
      expect.objectContaining({ key: 'category:nha-cua', label: 'Danh mục "Nhà cửa"', adminTab: 'productCategories' }),
    ]);
    const full = await setup({ counts: { flash: 2, bundles: 1, groups: 1 } }).svc.emptyEntrances();
    expect(full.entrances.map((e) => e.key)).toEqual(['category:nha-cua']);
  });
});

describe('MerchShelvesService.overview', () => {
  it('kệ Trang chủ, Bán chạy và một kệ cho mỗi danh mục, kèm số món ghim', async () => {
    const r = await setup().svc.overview();
    expect(r.shelves.map((s) => [s.key, s.pinCount])).toEqual([
      ['home_featured', 3],
      ['best_sellers', 0],
      ['category:cham-soc-be', 0],
      ['category:tam-goi', 0],
      ['category:nha-cua', 0],
    ]);
  });
});
