import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BundlesAdminService } from './bundles-admin.service';

const NOW = new Date('2026-11-05T05:00:00Z');
const ADMIN = { id: 'admin1', staff: false };
const STAFF = { id: 'staff1', staff: true };

const product = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  name: `SP ${id}`,
  isActive: true,
  approvalStatus: 'APPROVED',
  storefrontId: null,
  basePrice: 100_000,
  salePrice: null,
  variations: [{ id: `${id}-v`, sku: id, retailPrice: 100_000, salePrice: null, stock: 3 }],
  ...o,
});
const dtoItem = (productId: string, o: Record<string, unknown> = {}) => ({ productId, ...o });
const createDto = (o: Record<string, unknown> = {}) => ({
  kind: 'BUNDLE_PCT' as const,
  title: 'Bộ đôi',
  pct: 10,
  startAt: '2026-11-05T00:00:00.000Z',
  endAt: '2026-11-12T00:00:00.000Z',
  items: [dtoItem('p1'), dtoItem('p2')],
  ...o,
});
const detailRow = (o: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'BUNDLE_PCT',
  title: 'Bộ đôi',
  pct: 10,
  anchorProductId: null,
  anchorProduct: null,
  isActive: true,
  startAt: new Date('2026-11-05T00:00:00Z'),
  endAt: new Date('2026-11-12T00:00:00Z'),
  sortOrder: 0,
  createdById: 'admin1',
  items: [
    { productId: 'p1', variationId: null, variation: null, addonPrice: null, maxQty: 1, sortOrder: 0, product: { id: 'p1', name: 'SP p1', slug: 'sp-p1', basePrice: 100_000, salePrice: null, variations: [{ id: 'p1-v', sku: 'p1', retailPrice: 100_000, salePrice: null, stock: 3 }] } },
    { productId: 'p2', variationId: null, variation: null, addonPrice: null, maxQty: 1, sortOrder: 1, product: { id: 'p2', name: 'SP p2', slug: 'sp-p2', basePrice: 100_000, salePrice: null, variations: [{ id: 'p2-v', sku: 'p2', retailPrice: 100_000, salePrice: null, stock: 3 }] } },
  ],
  ...o,
});

function setup(o: { products?: unknown[]; current?: unknown; creatorRole?: string | null; maxPct?: number; caps?: Record<string, number> } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    bundleItem: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    bundle: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue(o.products ?? [product('p1'), product('p2')]) },
    bundle: {
      create: jest.fn().mockResolvedValue({ id: 'b1' }),
      findUnique: jest.fn().mockResolvedValue(o.current === undefined ? detailRow() : o.current),
      findMany: jest.fn().mockResolvedValue([detailRow()]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(o.creatorRole === null ? null : { role: o.creatorRole ?? 'ADMIN' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'admin1', role: 'ADMIN' }]),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const values: Record<string, unknown> = {
    'bundle.max_pct': o.maxPct ?? 50,
    'coupon.staff_max_percent': o.caps?.maxPercent ?? 20,
    'coupon.staff_max_amount_vnd': o.caps?.maxAmount ?? 30_000,
  };
  const config = { get: jest.fn().mockImplementation(async (k: string, fb: unknown) => values[k] ?? fb) };
  return { svc: new BundlesAdminService(prisma as never, config as never), prisma, tx };
}

describe('BundlesAdminService.create', () => {
  it('ghi bộ và món trong một lần ghi lồng nhau, createdById là người tạo, rồi trả chi tiết', async () => {
    const { svc, prisma } = setup();
    const out = await svc.create(createDto({ items: [dtoItem('p1', { maxQty: 2 }), dtoItem('p2')] }) as never, ADMIN, NOW);
    const data = prisma.bundle.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'BUNDLE_PCT', title: 'Bộ đôi', pct: 10, anchorProductId: null, isActive: true, sortOrder: 0, createdById: 'admin1' });
    expect(data.startAt).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    expect(data.items.create).toEqual([
      { productId: 'p1', variationId: null, addonPrice: null, maxQty: 2, sortOrder: 0 },
      { productId: 'p2', variationId: null, addonPrice: null, maxQty: 1, sortOrder: 1 },
    ]);
    expect(out).toMatchObject({ id: 'b1', status: 'live', createdByStaff: false });
    expect(out.items.map((i) => [i.productId, i.price])).toEqual([['p1', 100_000], ['p2', 100_000]]);
  });

  it('giờ kết thúc không sau giờ bắt đầu → 400, không ghi', async () => {
    const { svc, prisma } = setup();
    await expect(svc.create(createDto({ endAt: '2026-11-05T00:00:00.000Z' }) as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bundle.create).not.toHaveBeenCalled();
  });

  it('pct vượt bundle.max_pct → 400; sản phẩm đối tác → 400; không ghi gì', async () => {
    const a = setup({ maxPct: 20 });
    await expect(a.svc.create(createDto({ pct: 30 }) as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ products: [product('p1'), product('p2', { storefrontId: 'sf1' })] });
    await expect(b.svc.create(createDto() as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(a.prisma.bundle.create).not.toHaveBeenCalled();
    expect(b.prisma.bundle.create).not.toHaveBeenCalled();
  });

  it('ADDON: lưu sản phẩm chính và giá kèm; giá kèm 0đ hợp lệ', async () => {
    const { svc, prisma } = setup();
    await svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 0 })] }) as never, ADMIN, NOW);
    const data = prisma.bundle.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'ADDON', pct: null, anchorProductId: 'p1' });
    expect(data.items.create).toEqual([{ productId: 'p2', variationId: null, addonPrice: 0, maxQty: 1, sortOrder: 0 }]);
  });

  it('nhân viên: pct 30 khi trần 20 → 403, không ghi', async () => {
    const { svc, prisma } = setup({ caps: { maxPercent: 20 } });
    await expect(svc.create(createDto({ pct: 30 }) as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.bundle.create).not.toHaveBeenCalled();
  });

  it('nhân viên: tiền tối đa mỗi đơn vượt trần tiền → 403; trong trần → ghi với createdById là nhân viên', async () => {
    const over = setup({ caps: { maxPercent: 50, maxAmount: 10_000 } });
    await expect(over.svc.create(createDto({ pct: 10 }) as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException); // 10k + 10k = 20k > 10k
    const ok = setup({ caps: { maxPercent: 50, maxAmount: 20_000 } });
    await ok.svc.create(createDto({ pct: 10 }) as never, STAFF, NOW);
    expect(ok.prisma.bundle.create.mock.calls[0][0].data.createdById).toBe('staff1');
  });

  it('admin không bị trần nhân viên', async () => {
    const { svc, prisma } = setup({ caps: { maxPercent: 5, maxAmount: 1 } });
    await svc.create(createDto({ pct: 50 }) as never, ADMIN, NOW);
    expect(prisma.bundle.create).toHaveBeenCalled();
  });
});

describe('BundlesAdminService.update', () => {
  it('bộ không có → 404', async () => {
    await expect(setup({ current: null }).svc.update('x', { title: 'A' } as never, ADMIN, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhân viên sửa bộ của quản trị viên (hoặc không rõ người tạo) → 403', async () => {
    const a = setup({ creatorRole: 'ADMIN' });
    await expect(a.svc.update('b1', { title: 'A' } as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    const b = setup({ current: detailRow({ createdById: null }) });
    await expect(b.svc.update('b1', { title: 'A' } as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nhân viên sửa bộ của nhân viên được', async () => {
    const { svc, tx } = setup({ creatorRole: 'STAFF', current: detailRow({ createdById: 'staff2' }) });
    await svc.update('b1', { title: 'Mới' } as never, STAFF, NOW);
    expect(tx.bundle.update).toHaveBeenCalled();
  });

  it('chỉ đổi bật/tắt hay thứ tự: không đọc catalog, không kiểm trần (bộ có sản phẩm đã ngừng bán vẫn tắt được)', async () => {
    const { svc, prisma, tx } = setup({ products: [] });
    await svc.update('b1', { isActive: false, sortOrder: 3 } as never, ADMIN, NOW);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(tx.bundleItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.bundle.update.mock.calls[0][0]).toMatchObject({ where: { id: 'b1' }, data: { isActive: false, sortOrder: 3 } });
  });

  it('có items thì thay cả danh sách dưới khoá hàng, trong một giao dịch', async () => {
    const { svc, tx } = setup();
    await svc.update('b1', { items: [dtoItem('p1'), dtoItem('p2', { maxQty: 3 })] } as never, ADMIN, NOW);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.bundleItem.deleteMany).toHaveBeenCalledWith({ where: { bundleId: 'b1' } });
    expect(tx.bundle.update.mock.calls[0][0].data.items.create).toEqual([
      { productId: 'p1', variationId: null, addonPrice: null, maxQty: 1, sortOrder: 0 },
      { productId: 'p2', variationId: null, addonPrice: null, maxQty: 3, sortOrder: 1 },
    ]);
  });

  it('đổi pct kiểm lại trên nội dung gộp: vượt trần → 400, không ghi', async () => {
    const { svc, prisma } = setup({ maxPct: 20 });
    await expect(svc.update('b1', { pct: 30 } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đặt pct cho bộ ADDON → 400', async () => {
    const addon = detailRow({ kind: 'ADDON', pct: null, anchorProductId: 'p1', items: [detailRow().items[1]!].map((i) => ({ ...i, addonPrice: 39_000 })) });
    const { svc } = setup({ current: addon });
    await expect(svc.update('b1', { pct: 10 } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dời giờ kiểm với giờ còn lại của bộ', async () => {
    const { svc, prisma } = setup();
    await expect(svc.update('b1', { endAt: '2026-11-04T00:00:00.000Z' } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nhân viên đổi nội dung vượt trần → 403', async () => {
    const { svc } = setup({ creatorRole: 'STAFF', caps: { maxPercent: 20 } });
    await expect(svc.update('b1', { pct: 30 } as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('BundlesAdminService.remove', () => {
  it('quản trị viên xoá được cả bộ đang chạy; bộ không có → 404', async () => {
    const { svc, prisma } = setup();
    expect(await svc.remove('b1', ADMIN)).toEqual({ ok: true });
    expect(prisma.bundle.deleteMany).toHaveBeenCalledWith({ where: { id: 'b1' } });
    const none = setup();
    none.prisma.bundle.deleteMany.mockResolvedValue({ count: 0 });
    await expect(none.svc.remove('x', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhân viên xoá bộ của quản trị viên → 403, không xoá', async () => {
    const { svc, prisma } = setup({ creatorRole: 'ADMIN' });
    await expect(svc.remove('b1', STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.bundle.deleteMany).not.toHaveBeenCalled();
  });
});

describe('BundlesAdminService.list', () => {
  it.each([
    ['live', { isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } }],
    ['scheduled', { isActive: true, startAt: { gt: NOW } }],
    ['ended', { isActive: true, endAt: { lte: NOW } }],
    ['off', { isActive: false }],
  ] as const)('lọc theo trạng thái %s', async (status, where) => {
    const { svc, prisma } = setup();
    await svc.list(status, NOW);
    expect(prisma.bundle.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it('không lọc thì lấy tất cả, kèm trạng thái và người tạo là nhân viên hay không', async () => {
    const { svc, prisma } = setup();
    const rows = await svc.list(undefined, NOW);
    expect(prisma.bundle.findMany.mock.calls[0][0].where).toEqual({});
    expect(rows[0]).toMatchObject({ id: 'b1', status: 'live', createdByStaff: false });
  });
});
