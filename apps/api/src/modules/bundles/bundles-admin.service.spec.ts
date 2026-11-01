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

function setup(o: { products?: unknown[]; current?: unknown; locked?: unknown; creatorRole?: string | null; maxPct?: number; caps?: Record<string, number> } = {}) {
  const current = o.current === undefined ? detailRow() : o.current;
  const products = o.products ?? [product('p1'), product('p2')];
  const creator = o.creatorRole === null ? null : { role: o.creatorRole ?? 'ADMIN' };
  // Lệnh gọi bằng kết nối KHÁC (prisma, không phải tx) trong lúc giao dịch còn giữ khoá hàng: đủ N PATCH cùng lúc thì mỗi cái giữ một
  // kết nối chờ khoá, cái giữ khoá cần thêm một kết nối mà hồ đã hết → cả nhóm quá hạn (P2028).
  const lock = { held: false, outside: [] as string[] };
  const viaOther = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
    if (lock.held) lock.outside.push(name);
    return fn(...a);
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    bundleItem: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    // Dòng đọc SAU khi giữ khoá: mặc định cùng dòng với lần đọc ngoài giao dịch, test race cho nó khác đi.
    bundle: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(o.locked === undefined ? current : o.locked) },
    product: { findMany: jest.fn().mockResolvedValue(products) },
    user: { findUnique: jest.fn().mockResolvedValue(creator) },
  };
  const prisma = {
    product: { findMany: jest.fn(viaOther('product.findMany', () => Promise.resolve(products))) },
    bundle: {
      create: jest.fn().mockResolvedValue({ id: 'b1' }),
      findUnique: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([detailRow()]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn(viaOther('user.findUnique', () => Promise.resolve(creator))),
      findMany: jest.fn().mockResolvedValue([{ id: 'admin1', role: 'ADMIN' }]),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => {
      lock.held = true;
      try {
        return await fn(tx);
      } finally {
        lock.held = false;
      }
    }),
  };
  const values: Record<string, unknown> = {
    'bundle.max_pct': o.maxPct ?? 50,
    'coupon.staff_max_percent': o.caps?.maxPercent ?? 20,
    'coupon.staff_max_amount_vnd': o.caps?.maxAmount ?? 30_000,
  };
  const config = { get: jest.fn(viaOther('config.get', async (k: string, fb: unknown) => values[k] ?? fb)) };
  return { svc: new BundlesAdminService(prisma as never, config as never), prisma, tx, lock };
}

describe('BundlesAdminService.create', () => {
  it('ghi bộ và món trong một lần ghi lồng nhau, createdById là người tạo, rồi trả chi tiết', async () => {
    const { svc, prisma } = setup();
    const out = await svc.create(createDto({ items: [dtoItem('p1', { maxQty: 2 }), dtoItem('p2')] }) as never, ADMIN, NOW);
    const data = prisma.bundle.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'BUNDLE_PCT', title: 'Bộ đôi', pct: 10, anchorProductId: null, isActive: true, sortOrder: 0, createdById: 'admin1' });
    expect(data.startAt).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    expect(data.items.create).toEqual([
      { productId: 'p1', variationId: null, addonPrice: null, refPrice: null, maxQty: 2, sortOrder: 0 },
      { productId: 'p2', variationId: null, addonPrice: null, refPrice: null, maxQty: 1, sortOrder: 1 },
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
    await svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 0, variationId: 'p2-v' })] }) as never, ADMIN, NOW);
    const data = prisma.bundle.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'ADDON', pct: null, anchorProductId: 'p1' });
    expect(data.items.create).toEqual([{ productId: 'p2', variationId: 'p2-v', addonPrice: 0, refPrice: 100_000, maxQty: 1, sortOrder: 0 }]);
  });

  it('ADDON: giá tham chiếu là giá ĐANG BÁN của phân loại ghim lúc tạo (giá sale thắng giá lẻ), trần của khoản giảm về sau', async () => {
    const sale = product('p2', { variations: [{ id: 'p2-v', sku: 'p2', retailPrice: 100_000, salePrice: 70_000, stock: 3 }] });
    const { svc, prisma } = setup({ products: [product('p1'), sale] });
    await svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 39_000, variationId: 'p2-v' })] }) as never, ADMIN, NOW);
    expect(prisma.bundle.create.mock.calls[0][0].data.items.create).toEqual([
      { productId: 'p2', variationId: 'p2-v', addonPrice: 39_000, refPrice: 70_000, maxQty: 1, sortOrder: 0 },
    ]);
  });

  it('ADDON không ghim phân loại → 400, không ghi (giá kèm cố định không hợp với nhiều phân loại)', async () => {
    const { svc, prisma } = setup();
    const call = svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 39_000 })] }) as never, ADMIN, NOW);
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow('Chọn phân loại');
    expect(prisma.bundle.create).not.toHaveBeenCalled();
  });

  it('ADDON ghim phân loại đắt: giá kèm so với giá phân loại ghim, không phải phân loại rẻ nhất', async () => {
    const two = product('p2', {
      variations: [
        { id: 'p2-s', sku: 'p2s', retailPrice: 50_000, salePrice: null, stock: 3 },
        { id: 'p2-l', sku: 'p2l', retailPrice: 500_000, salePrice: null, stock: 3 },
      ],
    });
    const { svc, prisma } = setup({ products: [product('p1'), two] });
    await svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 400_000, variationId: 'p2-l' })] }) as never, ADMIN, NOW);
    expect(prisma.bundle.create).toHaveBeenCalled();
    await expect(
      svc.create(createDto({ kind: 'ADDON', pct: undefined, anchorProductId: 'p1', items: [dtoItem('p2', { addonPrice: 60_000, variationId: 'p2-s' })] }) as never, ADMIN, NOW),
    ).rejects.toThrow('thấp hơn giá đang bán');
  });

  it('nhân viên: combo giảm % tính tiền tối đa trên phân loại ĐẮT NHẤT (50k và 500k) → 403, không ghi', async () => {
    const two = (id: string) =>
      product(id, {
        variations: [
          { id: `${id}-s`, sku: `${id}s`, retailPrice: 50_000, salePrice: null, stock: 3 },
          { id: `${id}-l`, sku: `${id}l`, retailPrice: 500_000, salePrice: null, stock: 3 },
        ],
      });
    const { svc, prisma } = setup({ products: [two('p1'), two('p2')], caps: { maxPercent: 50, maxAmount: 250_000 } });
    const dto = createDto({ pct: 20, items: [dtoItem('p1', { maxQty: 10 }), dtoItem('p2', { maxQty: 10 })] });
    await expect(svc.create(dto as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.bundle.create).not.toHaveBeenCalled();
    await svc.create(dto as never, ADMIN, NOW);
    expect(prisma.bundle.create).toHaveBeenCalled();
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
    expect(a.tx.bundle.update).not.toHaveBeenCalled();
    expect(b.tx.bundle.update).not.toHaveBeenCalled();
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
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.bundleItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.bundle.update.mock.calls[0][0]).toMatchObject({ where: { id: 'b1' }, data: { isActive: false, sortOrder: 3 } });
  });

  it('có items thì thay cả danh sách dưới khoá hàng, trong một giao dịch', async () => {
    const { svc, tx } = setup();
    await svc.update('b1', { items: [dtoItem('p1'), dtoItem('p2', { maxQty: 3 })] } as never, ADMIN, NOW);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.bundleItem.deleteMany).toHaveBeenCalledWith({ where: { bundleId: 'b1' } });
    expect(tx.bundle.update.mock.calls[0][0].data.items.create).toEqual([
      { productId: 'p1', variationId: null, addonPrice: null, refPrice: null, maxQty: 1, sortOrder: 0 },
      { productId: 'p2', variationId: null, addonPrice: null, refPrice: null, maxQty: 3, sortOrder: 1 },
    ]);
  });

  describe('giá tham chiếu khi sửa bộ ADDON (form luôn gửi lại cả danh sách món)', () => {
    const pinnedItem = (o: Record<string, unknown> = {}) => ({ ...detailRow().items[1]!, variationId: 'p2-v', addonPrice: 39_000, refPrice: 50_000, ...o });
    const addon = (items = [pinnedItem()], o: Record<string, unknown> = {}) => detailRow({ kind: 'ADDON', pct: null, anchorProductId: 'p1', items, ...o });
    // Phân loại ghim đã tăng từ 50.000 lên 500.000 sau khi bộ được tạo (sửa tay hay đồng bộ Pancake).
    const risen = product('p2', { variations: [{ id: 'p2-v', sku: 'p2', retailPrice: 500_000, salePrice: null, stock: 3 }] });
    const created = (svc: { tx: { bundle: { update: jest.Mock } } }) => svc.tx.bundle.update.mock.calls[0][0].data.items.create;

    it('gửi lại nguyên món (chỉ đổi giờ/tên): giữ giá tham chiếu 50.000, không bật lại theo giá hiện tại 500.000', async () => {
      const s = setup({ current: addon(), products: [product('p1'), risen] });
      await s.svc.update('b1', { title: 'Mới', items: [dtoItem('p2', { addonPrice: 39_000, variationId: 'p2-v' })] } as never, ADMIN, NOW);
      expect(created(s)).toEqual([{ productId: 'p2', variationId: 'p2-v', addonPrice: 39_000, refPrice: 50_000, maxQty: 1, sortOrder: 0 }]);
    });

    it('đổi giá kèm, hay thêm món mới: giá tham chiếu lấy theo giá đang bán lúc sửa; dòng cũ thiếu giá tham chiếu cũng vậy', async () => {
      const changed = setup({ current: addon(), products: [product('p1'), risen] });
      await changed.svc.update('b1', { items: [dtoItem('p2', { addonPrice: 399_000, variationId: 'p2-v' })] } as never, ADMIN, NOW);
      expect(created(changed)[0]).toMatchObject({ addonPrice: 399_000, refPrice: 500_000 });
      const added = setup({ current: addon(), products: [product('p1'), risen, product('p3')] });
      await added.svc.update(
        'b1',
        { items: [dtoItem('p2', { addonPrice: 39_000, variationId: 'p2-v' }), dtoItem('p3', { addonPrice: 10_000, variationId: 'p3-v' })] } as never,
        ADMIN,
        NOW,
      );
      expect(created(added).map((i: { productId: string; refPrice: number }) => [i.productId, i.refPrice])).toEqual([['p2', 50_000], ['p3', 100_000]]);
      const legacy = setup({ current: addon([pinnedItem({ refPrice: null })]), products: [product('p1'), risen] });
      await legacy.svc.update('b1', { items: [dtoItem('p2', { addonPrice: 39_000, variationId: 'p2-v' })] } as never, ADMIN, NOW);
      expect(created(legacy)[0].refPrice).toBe(500_000);
    });

    it('phân loại tụt giá (sale 45.000) rồi form gửi lại nguyên món: giữ giá tham chiếu cũ, không hạ theo giá sale', async () => {
      const sale = product('p2', { variations: [{ id: 'p2-v', sku: 'p2', retailPrice: 50_000, salePrice: 45_000, stock: 3 }] });
      const s = setup({ current: addon(), products: [product('p1'), sale] });
      await s.svc.update('b1', { items: [dtoItem('p2', { addonPrice: 39_000, variationId: 'p2-v' })] } as never, ADMIN, NOW);
      expect(created(s)[0].refPrice).toBe(50_000);
    });

    it('không đụng danh sách món (không gửi items): không ghi lại món nào', async () => {
      const s = setup({ current: addon(), products: [product('p1'), risen] });
      await s.svc.update('b1', { title: 'Mới' } as never, ADMIN, NOW);
      expect(s.tx.bundleItem.deleteMany).not.toHaveBeenCalled();
      expect(s.tx.bundle.update.mock.calls[0][0].data.items).toBeUndefined();
    });

    it('nhân viên gia hạn bộ ADDON của mình (gửi lại nguyên món) khi phân loại đã tăng giá: qua, vì trần tính trên giá tham chiếu; đổi giá kèm thì tính theo giá hiện tại → 403', async () => {
      // Giá kèm 45.000 trên giá tham chiếu 50.000: giảm 10% ≤ 20%, 5.000đ ≤ 30.000đ.
      const mine = addon([pinnedItem({ addonPrice: 45_000 })], { createdById: 'staff2' });
      const same = setup({ current: mine, creatorRole: 'STAFF', products: [product('p1'), risen] });
      await same.svc.update('b1', { endAt: '2026-11-13T00:00:00.000Z', items: [dtoItem('p2', { addonPrice: 45_000, variationId: 'p2-v' })] } as never, STAFF, NOW);
      expect(created(same)[0]).toMatchObject({ addonPrice: 45_000, refPrice: 50_000 });
      const reprice = setup({ current: mine, creatorRole: 'STAFF', products: [product('p1'), risen] });
      await expect(
        reprice.svc.update('b1', { items: [dtoItem('p2', { addonPrice: 440_000, variationId: 'p2-v' })] } as never, STAFF, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException); // 60.000đ mỗi đơn vị trên 500.000đ > trần 30.000đ
      expect(reprice.tx.bundle.update).not.toHaveBeenCalled();
    });

    it('chi tiết admin trả giá tham chiếu của từng món để form báo đúng khoản giảm giỏ sẽ cho', async () => {
      const s = setup({ current: addon([pinnedItem({ product: { ...detailRow().items[1]!.product, variations: risen.variations } })]) });
      const out = await s.svc.get('b1', NOW);
      expect(out.items[0]).toMatchObject({ price: 500_000, refPrice: 50_000, addonPrice: 39_000 });
    });
  });

  it('đổi pct kiểm lại trên nội dung gộp: vượt trần → 400, không ghi', async () => {
    const { svc, tx } = setup({ maxPct: 20 });
    await expect(svc.update('b1', { pct: 30 } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.bundle.update).not.toHaveBeenCalled();
  });

  it('đặt pct cho bộ ADDON → 400', async () => {
    const addon = detailRow({ kind: 'ADDON', pct: null, anchorProductId: 'p1', items: [detailRow().items[1]!].map((i) => ({ ...i, addonPrice: 39_000 })) });
    const { svc } = setup({ current: addon });
    await expect(svc.update('b1', { pct: 10 } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dời giờ kiểm với giờ còn lại của bộ', async () => {
    const { svc, tx } = setup();
    await expect(svc.update('b1', { endAt: '2026-11-04T00:00:00.000Z' } as never, ADMIN, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.bundle.update).not.toHaveBeenCalled();
  });

  it('trong lúc giữ khoá hàng chỉ dùng kết nối của giao dịch: catalog và người tạo đọc qua tx, cấu hình đọc trước khi mở giao dịch (không chiếm kết nối thứ hai)', async () => {
    const s = setup({ creatorRole: 'STAFF', current: detailRow({ createdById: 'staff2' }), caps: { maxPercent: 20, maxAmount: 50_000 } });
    await s.svc.update('b1', { pct: 20, items: [dtoItem('p1'), dtoItem('p2')] } as never, STAFF, NOW);
    expect(s.lock.outside).toEqual([]);
    expect(s.tx.product.findMany).toHaveBeenCalled();
    expect(s.tx.user.findUnique).toHaveBeenCalled();
    expect(s.tx.bundle.update).toHaveBeenCalled();
  });

  describe('kiểm trên dòng đọc SAU khi giữ khoá (hai PATCH đồng thời không lách trần nhân viên)', () => {
    const stale = detailRow({ createdById: 'staff2' });
    // Một PATCH khác vừa ghi xong: mỗi món được hưởng 2 đơn vị (dòng đọc ngoài giao dịch còn là 1 đơn vị).
    const changed = detailRow({ createdById: 'staff2', items: detailRow().items.map((i) => ({ ...i, maxQty: 2 })) });

    it('nội dung gộp với dòng đã khoá vượt trần tiền → 403, không ghi, dù dòng đọc trước khoá còn hợp lệ', async () => {
      // 20% × 100.000 × 1 đơn vị × 2 món = 40.000 ≤ 50.000 (dòng cũ); trên dòng đã khoá: 80.000 > 50.000.
      const { svc, tx } = setup({ creatorRole: 'STAFF', current: stale, locked: changed, caps: { maxPercent: 20, maxAmount: 50_000 } });
      await expect(svc.update('b1', { pct: 20 } as never, STAFF, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.bundle.update).not.toHaveBeenCalled();
      expect(tx.bundleItem.deleteMany).not.toHaveBeenCalled();
    });

    it('cùng PATCH trên dòng cũ thì được (chứng minh ca trên đỏ vì dòng đã khoá, không vì dữ liệu)', async () => {
      const { svc, tx } = setup({ creatorRole: 'STAFF', current: stale, caps: { maxPercent: 20, maxAmount: 50_000 } });
      await svc.update('b1', { pct: 20 } as never, STAFF, NOW);
      expect(tx.bundle.update).toHaveBeenCalled();
    });

    it('dòng bị xoá giữa lúc chờ khoá → 404, không ghi', async () => {
      const { svc, tx } = setup({ current: detailRow(), locked: null });
      await expect(svc.update('b1', { pct: 20 } as never, ADMIN, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.bundle.update).not.toHaveBeenCalled();
    });
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
