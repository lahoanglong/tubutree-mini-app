import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommissionAdminService } from './commission-admin.service';
import { AFFILIATE_MAX_RATE_KEY } from './commission-rate-csv';

const dec = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));

function makeConfig(maxRate?: unknown) {
  return {
    get: jest.fn(async (key: string, fallback: unknown) => (key === AFFILIATE_MAX_RATE_KEY && maxRate !== undefined ? maxRate : fallback)),
  };
}

function make(prisma: Record<string, unknown>, maxRate?: unknown) {
  const p = { ...prisma } as Record<string, unknown>;
  // applyImport chạy trong $transaction(fn): tx chính là mock prisma.
  p.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(p));
  p.$queryRaw ??= jest.fn().mockResolvedValue([]);
  return { svc: new CommissionAdminService(p as never, makeConfig(maxRate) as never), prisma: p };
}

let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => logSpy.mockRestore());

describe('CommissionAdminService — đặt % hoa hồng CTV (D1-01)', () => {
  it('đặt % một biến thể: ghi Decimal, log admin + cũ → mới', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'v1', sku: 'A1', affiliateRate: dec(12.5) });
    const { svc } = make({
      variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', sku: 'A1', affiliateRate: null }), update },
    });
    const r = await svc.setVariationRate('admin-1', 'v1', 12.5);
    expect(r).toEqual({ id: 'v1', sku: 'A1', affiliateRate: 12.5 });
    expect(update.mock.calls[0][0].data.affiliateRate.toString()).toBe('12.5');
    expect(logSpy.mock.calls.map((c) => c[0]).join('\n')).toMatch(/admin-1.*A1: chưa có → 12\.5%/);
  });

  it('vượt trần cấu hình / âm / quá 2 chữ số thập phân → 400, không ghi', async () => {
    const update = jest.fn();
    const { svc } = make({ variation: { findUnique: jest.fn(), update } }, 20);
    await expect(svc.setVariationRate('a', 'v1', 25)).rejects.toThrow('vượt trần 20%');
    await expect(svc.setVariationRate('a', 'v1', -1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setVariationRate('a', 'v1', 1.234)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('trần mặc định 50 khi chưa có khoá; khoá hỏng cũng về 50', async () => {
    const { svc } = make({});
    expect(await svc.maxRate()).toBe(50);
    expect(await make({}, 'abc').svc.maxRate()).toBe(50);
    expect(await make({}, 30).svc.maxRate()).toBe(30);
  });

  it('biến thể không tồn tại → 404', async () => {
    const { svc } = make({ variation: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(svc.setVariationRate('a', 'nope', 10)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đặt % cả sản phẩm: chỉ biến thể đang bán; không còn biến thể đang bán → 400', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 0 });
    const { svc } = make({
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'SP' }) },
      variation: { updateMany },
    });
    expect(await svc.setProductRate('a', 'p1', 8)).toEqual({ productId: 'p1', updated: 3, affiliateRate: 8 });
    expect(updateMany.mock.calls[0][0].where).toEqual({ productId: 'p1', isActive: true });
    await expect(svc.setProductRate('a', 'p1', 8)).rejects.toThrow('không có biến thể đang bán');
  });

  it('áp % cho biến thể chưa có %: chỉ NULL (không đè 0 cố ý hay mức đã đặt), chỉ hàng Tubu, chỉ đang bán', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 42 });
    const { svc } = make({ variation: { updateMany } });
    expect(await svc.fillMissingRates('a', 10)).toEqual({ updated: 42, affiliateRate: 10 });
    expect(updateMany.mock.calls[0][0].where).toEqual({ isActive: true, affiliateRate: null, product: { storefrontId: null } });
  });
});

describe('CommissionAdminService — nhập CSV "sku,%"', () => {
  const catalog = [
    { sku: 'A1', name: '500ml', affiliateRate: dec(null), product: { name: 'Nước rửa chén' } },
    { sku: 'B2', name: '1L', affiliateRate: dec(8), product: { name: 'Nước giặt' } },
    { sku: 'C3', name: 'Mặc định', affiliateRate: dec(5), product: { name: 'Xà phòng' } },
  ];
  const variationMock = (updateMany = jest.fn().mockResolvedValue({ count: 1 })) => ({
    findMany: jest.fn(async ({ where }: { where: { sku: { in: string[] } } }) => catalog.filter((v) => where.sku.in.includes(v.sku))),
    updateMany,
  });

  it('xem trước phân loại khớp / giữ nguyên / không khớp / sai định dạng / vượt trần / lặp — không ghi', async () => {
    const v = variationMock();
    const { svc, prisma } = make({ variation: v }, 30);
    const p = await svc.previewImport('sku,rate\nA1,10\nB2,8\nZZ,5\nC3,abc\nC3,40\nA9,1\nA9,2');
    expect(p.rows.map((r) => [r.line, r.sku, r.status])).toEqual([
      [2, 'A1', 'OK'],
      [3, 'B2', 'UNCHANGED'],
      [4, 'ZZ', 'NOT_FOUND'],
      [5, 'C3', 'INVALID'],
      [6, 'C3', 'OVER_CAP'],
      [7, 'A9', 'DUPLICATE'],
      [8, 'A9', 'DUPLICATE'],
    ]);
    expect(p.rows[0]).toMatchObject({ currentRate: null, rate: 10, productName: 'Nước rửa chén', variationName: '500ml' });
    expect(p.counts).toEqual({ OK: 1, UNCHANGED: 1, NOT_FOUND: 1, INVALID: 1, OVER_CAP: 1, DUPLICATE: 2 });
    expect(p).toMatchObject({ blocking: 4, canApply: false, maxRate: 30 });
    expect(v.updateMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('áp: còn dòng lỗi → 400 và KHÔNG ghi dòng nào (kể cả dòng khớp)', async () => {
    const v = variationMock();
    const { svc } = make({ variation: v });
    await expect(svc.applyImport('a', 'A1,10\nB2,abc')).rejects.toThrow('Chưa ghi dòng nào');
    await expect(svc.applyImport('a', 'A1,10\nA1,10')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.applyImport('a', 'A1,99')).rejects.toBeInstanceOf(BadRequestException);
    expect(v.updateMany).not.toHaveBeenCalled();
  });

  it('áp: ghi theo nhóm mức %, bỏ qua SKU không khớp và dòng giữ nguyên, log từng thay đổi kèm admin', async () => {
    const v = variationMock();
    const { svc, prisma } = make({ variation: v });
    const r = await svc.applyImport('admin-9', 'A1,10\nC3,10\nB2,8\nZZ,3');
    expect(r).toEqual({ updated: 2, unchanged: 1, notFound: ['ZZ'] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Khoá các dòng theo id trước khi đọc mức cũ (chống deadlock giữa hai lần nhập, log đúng mức bị thay).
    const lock = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    expect(lock[0].join('?')).toContain('ORDER BY "id" FOR UPDATE');
    expect(lock[1]).toEqual(['A1', 'C3', 'B2', 'ZZ']);
    expect((prisma.$queryRaw as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(v.findMany.mock.invocationCallOrder[0]!);
    expect(v.updateMany).toHaveBeenCalledTimes(1);
    const call = v.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ sku: { in: ['A1', 'C3'] } });
    expect(call.data.affiliateRate.toString()).toBe('10');
    const logs = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(logs).toContain('admin-9');
    expect(logs).toContain('A1: chưa có→10');
    expect(logs).toContain('C3: 5→10');
  });

  it('áp: không có gì để đổi → 400', async () => {
    const { svc } = make({ variation: variationMock() });
    await expect(svc.applyImport('a', 'B2,8')).rejects.toThrow('Không có dòng nào cần đổi');
  });

  it('quá số dòng tối đa → 400', async () => {
    const { svc } = make({ variation: variationMock() });
    const csv = Array.from({ length: 5001 }, (_, i) => `S${i},1`).join('\n');
    await expect(svc.previewImport(csv)).rejects.toThrow('Tối đa 5000 dòng');
  });
});

describe('CommissionAdminService.listProducts', () => {
  function listPrisma(rows: unknown[]) {
    return {
      product: { findMany: jest.fn().mockResolvedValue(rows) },
      variation: { count: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(5) },
    };
  }
  const row = (id: string) => ({
    id,
    name: `SP ${id}`,
    thumbnail: null,
    brand: 'Tubu Tree',
    isActive: true,
    affiliateBlocked: false,
    approvalStatus: 'APPROVED',
    storefrontId: id === 'p2' ? 'sf1' : null,
    variations: [{ id: `v-${id}`, sku: `S-${id}`, name: 'M', retailPrice: 100_000, salePrice: null, isActive: true, affiliateRate: dec(id === 'p1' ? 10 : null), dealerPrices: null }],
  });

  it('keyset: lấy take+1 để biết còn trang; % ra số; đánh dấu hàng đối tác; kèm trần và số biến thể chưa có %', async () => {
    const prisma = listPrisma([row('p1'), row('p2'), row('p3')]);
    const { svc } = make(prisma);
    const r = await svc.listProducts({ take: 2, cursor: 'p0' });
    const args = prisma.product.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 3, cursor: { id: 'p0' }, skip: 1, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    expect(r.items.map((i) => [i.id, i.isPartner, i.variations[0]!.affiliateRate])).toEqual([
      ['p1', false, 10],
      ['p2', true, null],
    ]);
    expect(r.items[0]).not.toHaveProperty('storefrontId');
    expect(r.nextCursor).toBe('p2');
    expect(r.maxRate).toBe(50);
    expect(r.summary).toEqual({ missing: 7, missingTubu: 5 });
  });

  it('trang cuối → nextCursor null; lọc chưa có % và tìm theo tên không dấu hoặc SKU (escape ký tự LIKE)', async () => {
    const prisma = listPrisma([row('p1')]);
    const { svc } = make(prisma);
    const r = await svc.listProducts({ take: 20, q: ' Nước_Rửa ', missing: true });
    expect(r.nextCursor).toBeNull();
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.variations).toEqual({ some: { isActive: true, affiliateRate: null } });
    expect(where.OR).toEqual([
      { nameSearch: { contains: 'nuoc\\_rua' } },
      { variations: { some: { sku: { contains: 'Nước\\_Rửa', mode: 'insensitive' } } } },
    ]);
  });
});

describe('CommissionAdminService.orderReferral (D3-07)', () => {
  it('đơn có CTV + gian hàng + hoa hồng: trả tên/mã CTV, gian hàng, số tiền và trạng thái', async () => {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'o1', code: 'TB1', userId: 'u1', referrerUserId: 'ctv1', storefrontSlug: 'shop-lan', placedForCustomer: false, source: 'checkout',
          storefront: { id: 'sf1', slug: 'shop-lan', title: 'Shop Lan', type: 'CTV' },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'ctv1', fullName: 'Lan', phone: '0900000001', referralCode: 'LAN12345', role: 'AFFILIATE' }) },
      commission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', affiliateUserId: 'ctv1', amount: 20_000, rate: dec(10), commissionableTotal: 200_000, status: 'LOCKED', createdAt: new Date(), lockedAt: new Date(), approvedAt: null, paidAt: null, user: { fullName: 'Lan' } },
        ]),
      },
    };
    const r = await make(prisma).svc.orderReferral('TB1');
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ OR: [{ id: 'TB1' }, { code: 'TB1' }] });
    expect(r).toMatchObject({
      orderCode: 'TB1',
      referrer: { fullName: 'Lan', referralCode: 'LAN12345' },
      storefront: { title: 'Shop Lan' },
      selfReferral: false,
      commissions: [{ amount: 20_000, rate: 10, status: 'LOCKED', affiliateName: 'Lan' }],
    });
    expect(r.commissions[0]).not.toHaveProperty('user');
  });

  it('đơn không người giới thiệu → referrer null, không tra user; tự giới thiệu (không phải đơn hộ) được đánh dấu', async () => {
    const findUnique = jest.fn();
    const base = { id: 'o1', code: 'TB1', userId: 'u1', storefrontSlug: null, placedForCustomer: false, source: null, storefront: null };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValueOnce({ ...base, referrerUserId: null }).mockResolvedValueOnce({ ...base, referrerUserId: 'u1' }) },
      user: { findUnique },
      commission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const { svc } = make(prisma);
    expect(await svc.orderReferral('o1')).toMatchObject({ referrer: null, selfReferral: false, commissions: [] });
    expect(findUnique).not.toHaveBeenCalled();
    expect(await svc.orderReferral('o1')).toMatchObject({ selfReferral: true });
  });

  it('không có đơn → 404', async () => {
    const { svc } = make({ order: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.orderReferral('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
