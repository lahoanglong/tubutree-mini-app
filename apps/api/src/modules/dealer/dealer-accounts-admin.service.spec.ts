import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DealerAccountsAdminService } from './dealer-accounts-admin.service';

const INPUT = { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 20_000_000, paymentTerms: 'NET 15' };
const ROW = {
  id: 'DEALER_2',
  name: 'Đại lý Cấp 2',
  minOrderVolume: 30_000_000,
  discountRules: { default: 0.3, note: 'giữ khoá lạ' },
  creditLimit: 20_000_000,
  paymentTerms: 'NET 15',
};

function build(opts: { row?: typeof ROW | null; maxDiscount?: unknown; createError?: unknown } = {}) {
  const row = opts.row === undefined ? ROW : opts.row;
  const historyCreate = jest.fn().mockResolvedValue({});
  const tierUpdate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ROW, ...data }));
  const tierCreate = jest.fn().mockImplementation(({ data }) => (opts.createError ? Promise.reject(opts.createError) : Promise.resolve(data)));
  const queryRaw = jest.fn().mockResolvedValue(row ? [row] : []);
  const tx = { $queryRaw: queryRaw, dealerTier: { update: tierUpdate, create: tierCreate }, dealerTierHistory: { create: historyCreate } };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const config = { get: jest.fn().mockResolvedValue(opts.maxDiscount ?? 0.45) };
  const svc = new DealerAccountsAdminService(prisma as never, config as never);
  return { svc, prisma, tx, queryRaw, tierUpdate, tierCreate, historyCreate, config };
}

describe('DealerAccountsAdminService.updateTier — sửa bậc đại lý (tham số tiền)', () => {
  it('ghi bậc đã khoá dòng + một dòng lịch sử cũ → mới kèm id admin, giữ khoá lạ trong discountRules', async () => {
    const { svc, tierUpdate, historyCreate, queryRaw } = build();
    const out = await svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, discountPct: 32.5, creditLimit: 25_000_000 });
    expect(String((queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?'))).toMatch(/FOR UPDATE/);
    expect(tierUpdate).toHaveBeenCalledWith({
      where: { id: 'DEALER_2' },
      data: {
        name: 'Đại lý Cấp 2',
        minOrderVolume: 30_000_000,
        discountRules: { default: 0.325, note: 'giữ khoá lạ' },
        creditLimit: 25_000_000,
        paymentTerms: 'NET 15',
      },
    });
    expect(historyCreate).toHaveBeenCalledTimes(1);
    expect(historyCreate.mock.calls[0]![0].data).toEqual({
      tierId: 'DEALER_2',
      action: 'UPDATE',
      changedBy: 'admin-1',
      oldValue: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 20_000_000, paymentTerms: 'NET 15' },
      newValue: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 32.5, creditLimit: 25_000_000, paymentTerms: 'NET 15' },
    });
    expect(out).toMatchObject({ id: 'DEALER_2', discountPct: 32.5, creditLimit: 25_000_000 });
  });

  it('không có gì đổi → không ghi bậc, không ghi lịch sử', async () => {
    const { svc, tierUpdate, historyCreate } = build();
    const out = await svc.updateTier('admin-1', 'DEALER_2', INPUT);
    expect(tierUpdate).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ id: 'DEALER_2', discountPct: 30 });
  });

  it('chiết khấu vượt dealer.max_discount_pct → 400, không chạm DB', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, discountPct: 50 })).rejects.toThrow(/vượt trần 45%/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trần theo khoá cấu hình hiện tại (nâng trần thì cho chiết khấu cao hơn); khoá hỏng rơi về 45%', async () => {
    const hi = build({ maxDiscount: 0.5 });
    await expect(hi.svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, discountPct: 50 })).resolves.toBeDefined();
    const bad = build({ maxDiscount: 'x' });
    await expect(bad.svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, discountPct: 46 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gom mọi lỗi giá trị vào một câu 400', async () => {
    const { svc } = build();
    const err = await svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, creditLimit: -1, minOrderVolume: -1, name: '' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/Tên bậc/);
    expect((err as Error).message).toMatch(/Hạn mức/);
    expect((err as Error).message).toMatch(/Doanh số tối thiểu/);
  });

  it('bậc không tồn tại → 404, không ghi lịch sử', async () => {
    const { svc, historyCreate } = build({ row: null });
    await expect(svc.updateTier('admin-1', 'NOPE', INPUT)).rejects.toBeInstanceOf(NotFoundException);
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('điều kiện thanh toán để trống → lưu null', async () => {
    const { svc, tierUpdate } = build();
    await svc.updateTier('admin-1', 'DEALER_2', { ...INPUT, paymentTerms: '' });
    expect(tierUpdate.mock.calls[0]![0].data.paymentTerms).toBeNull();
  });
});

describe('DealerAccountsAdminService.createTier — tạo bậc khi danh sách rỗng', () => {
  it('tạo bậc kèm lịch sử CREATE (oldValue null) trong một transaction', async () => {
    const { svc, tierCreate, historyCreate } = build();
    const out = await svc.createTier('admin-1', { id: 'DEALER_1', ...INPUT, discountPct: 20, creditLimit: 0, paymentTerms: 'PREPAID' });
    expect(tierCreate).toHaveBeenCalledWith({
      data: {
        id: 'DEALER_1',
        name: 'Đại lý Cấp 2',
        minOrderVolume: 30_000_000,
        discountRules: { default: 0.2 },
        creditLimit: 0,
        paymentTerms: 'PREPAID',
      },
    });
    expect(historyCreate.mock.calls[0]![0].data).toMatchObject({ tierId: 'DEALER_1', action: 'CREATE', oldValue: Prisma.JsonNull, changedBy: 'admin-1' });
    expect(out).toMatchObject({ id: 'DEALER_1', discountPct: 20, creditLimit: 0 });
  });

  it('mã bậc đã tồn tại → 409, không ghi lịch sử', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { svc, historyCreate } = build({ createError: dup });
    await expect(svc.createTier('admin-1', { id: 'DEALER_1', ...INPUT })).rejects.toBeInstanceOf(ConflictException);
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('chiết khấu vượt trần cũng bị chặn lúc tạo', async () => {
    const { svc, tierCreate } = build();
    await expect(svc.createTier('admin-1', { id: 'DEALER_X', ...INPUT, discountPct: 60 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tierCreate).not.toHaveBeenCalled();
  });
});
