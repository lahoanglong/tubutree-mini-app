import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { AdminCouponBatchService, CARD_CODE_ALPHABET, CARD_CODE_LENGTH, cardCode, claimUrl } from './admin-coupon-batch.service';

const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString();
const NOW = new Date().toISOString();
const INPUT = { prefix: 'SHOPEE', quantity: 3, type: 'AMOUNT' as const, value: 30000, minOrder: 99000, startAt: NOW, endAt: FUTURE, newCustomerOnly: true };

function config(base: unknown = 'https://zalo.me/s/123/') {
  return { get: jest.fn().mockResolvedValue(base) } as unknown as SystemConfigService;
}

function make(opts: { existing?: number; inserted?: number[]; base?: unknown } = {}) {
  const calls: string[] = [];
  const inserted = [...(opts.inserted ?? [])];
  // Mã thực sự vào bảng (ON CONFLICT bỏ qua phần trùng: mô phỏng bằng cách giữ `count` dòng đầu).
  const stored: string[] = [];
  const createMany = jest.fn().mockImplementation(({ data }: { data: { code: string }[] }) => {
    calls.push('insert');
    const n = inserted.length ? inserted.shift()! : data.length;
    stored.push(...data.slice(0, n).map((r) => r.code));
    return Promise.resolve({ count: n });
  });
  const count = jest.fn().mockImplementation(() => {
    calls.push('exists?');
    return Promise.resolve(opts.existing ?? 0);
  });
  const executeRaw = jest.fn().mockImplementation(() => {
    calls.push('lock');
    return Promise.resolve(0);
  });
  const findMany = jest
    .fn()
    .mockImplementation(async () => stored.map((code) => ({ code, isActive: true, _count: { claims: 0, redemptions: 0 } })));
  const base: Record<string, unknown> = {
    coupon: { createMany, count, findMany, updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    $executeRaw: executeRaw,
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  base.$transaction = jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(base));
  const svc = new AdminCouponBatchService(base as unknown as PrismaService, config(opts.base));
  return { svc, calls, createMany, findMany, prisma: base };
}

describe('cardCode / claimUrl', () => {
  it('mã thẻ = TIỀN TỐ-8 ký tự ngẫu nhiên, không có ký tự dễ đọc nhầm (0 O 1 I)', () => {
    for (let i = 0; i < 200; i++) {
      const code = cardCode('SHOPEE');
      expect(code).toMatch(new RegExp(`^SHOPEE-[${CARD_CODE_ALPHABET}]{${CARD_CODE_LENGTH}}$`));
      expect(code.slice(7)).not.toMatch(/[01OI]/);
    }
    expect(new Set(Array.from({ length: 500 }, () => cardCode('X'))).size).toBe(500);
  });

  it('link nhận = URL gốc Mini App (bỏ "/" cuối) + ?claim=; chưa cấu hình thì đường dẫn tương đối', () => {
    expect(claimUrl('https://zalo.me/s/123/', 'SHOPEE-AB')).toBe('https://zalo.me/s/123/?claim=SHOPEE-AB');
    expect(claimUrl('https://zalo.me/s/123', 'SHOPEE-AB')).toBe('https://zalo.me/s/123/?claim=SHOPEE-AB');
    expect(claimUrl('', 'SHOPEE-AB')).toBe('/?claim=SHOPEE-AB');
  });
});

describe('AdminCouponBatchService.create (D2-03: lô mã in thẻ hộp hàng)', () => {
  it('khoá theo tiền tố, kiểm tiền tố chưa dùng, rồi ghi N mã CLAIM cùng cấu hình (mỗi mã 1 lượt nhận, 1 lượt dùng)', async () => {
    const { svc, calls, createMany } = make();
    const out = await svc.create(INPUT);
    expect(calls.slice(0, 3)).toEqual(['lock', 'exists?', 'insert']);
    const rows = createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.code)).size).toBe(3);
    for (const r of rows) {
      expect(r).toMatchObject({
        type: 'AMOUNT',
        value: 30000,
        minOrder: 99000,
        usageLimit: 1,
        perUserLimit: 1,
        scope: 'CLAIM',
        newCustomerOnly: true,
        batch: 'SHOPEE',
      });
    }
    expect(out).toMatchObject({ batch: 'SHOPEE', created: 3, claimUrlBase: 'https://zalo.me/s/123' });
    expect(out.codes.map((c) => c.code).sort()).toEqual(rows.map((r) => r.code as string).sort());
    const first = out.codes[0]!;
    expect(first.url).toBe(`https://zalo.me/s/123/?claim=${first.code}`);
  });

  it('mã sinh ra trùng mã đã có (ON CONFLICT bỏ qua) → sinh bù đúng số thiếu', async () => {
    const { svc, createMany } = make({ inserted: [2, 1] });
    const out = await svc.create(INPUT);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect((createMany.mock.calls[1][0].data as unknown[]).length).toBe(1);
    expect(out.created).toBe(3);
    expect(out.codes).toHaveLength(3);
  });

  it('ghi sổ ai tạo lô (nhân viên Marketing tạo được, D1-05)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = make();
    await svc.create(INPUT, { id: 's1', staff: true });
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('Nhân viên s1') && m.includes('SHOPEE'))).toBe(true);
    warn.mockRestore();
  });

  it('link gốc Mini App cho mã chung (nhân viên Marketing không đọc được tab Cấu hình)', async () => {
    const { svc } = make();
    await expect(svc.claimBase()).resolves.toEqual({ claimUrlBase: 'https://zalo.me/s/123' });
  });

  it('tiền tố đã có lô → 409, không ghi', async () => {
    const { svc, createMany } = make({ existing: 5 });
    await expect(svc.create(INPUT)).rejects.toBeInstanceOf(ConflictException);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('luật tiền chung với tạo mã lẻ (mức giảm phải nhỏ hơn đơn tối thiểu...) → 400, không ghi', async () => {
    const { svc, createMany } = make();
    await expect(svc.create({ ...INPUT, value: 100000, minOrder: 99000 })).rejects.toThrow('nhỏ hơn đơn tối thiểu');
    await expect(svc.create({ ...INPUT, type: 'PERCENT', value: 60 })).rejects.toThrow('Giảm tối đa');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('newCustomerOnly bỏ trống → false', async () => {
    const { svc, createMany } = make();
    await svc.create({ ...INPUT, newCustomerOnly: undefined });
    expect((createMany.mock.calls[0][0].data as Record<string, unknown>[])[0]).toMatchObject({ newCustomerOnly: false });
  });

  it('chưa cấu hình URL gốc Mini App → vẫn tạo, claimUrlBase null để màn admin cảnh báo', async () => {
    const { svc } = make({ base: '' });
    const out = await svc.create(INPUT);
    expect(out.claimUrlBase).toBeNull();
    expect(out.codes[0]!.url).toMatch(/^\/\?claim=SHOPEE-/);
  });
});

describe('AdminCouponBatchService.codes / setActive', () => {
  it('codes: mỗi mã kèm link nhận, đã nhận/đã dùng (để xuất lại CSV và soát thẻ)', async () => {
    const { svc, findMany } = make();
    findMany.mockResolvedValue([
      { code: 'SHOPEE-AAAA2222', isActive: true, _count: { claims: 1, redemptions: 1 } },
      { code: 'SHOPEE-BBBB3333', isActive: true, _count: { claims: 0, redemptions: 0 } },
    ]);
    const out = await svc.codes('shopee');
    expect(findMany.mock.calls[0][0].where).toEqual({ batch: 'SHOPEE' });
    expect(out.codes).toEqual([
      { code: 'SHOPEE-AAAA2222', url: 'https://zalo.me/s/123/?claim=SHOPEE-AAAA2222', claimed: true, used: true, isActive: true },
      { code: 'SHOPEE-BBBB3333', url: 'https://zalo.me/s/123/?claim=SHOPEE-BBBB3333', claimed: false, used: false, isActive: true },
    ]);
  });

  it('codes: lô không tồn tại → 404', async () => {
    const { svc, findMany } = make();
    findMany.mockResolvedValue([]);
    await expect(svc.codes('NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setActive: tắt/bật cả lô (thẻ bị lộ) bằng một lệnh', async () => {
    const { svc, prisma } = make();
    await expect(svc.setActive('shopee', false)).resolves.toEqual({ batch: 'SHOPEE', updated: 3 });
    expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({ where: { batch: 'SHOPEE' }, data: { isActive: false } });
  });
});

describe('AdminCouponBatchService — nhân viên Marketing (D1-05)', () => {
  const staff = { id: 's1', staff: true };
  const admin = { id: 'a1', staff: false };
  const withUsers = (prisma: Record<string, unknown>, users: { id: string; role: string }[]) => {
    prisma.user = { findMany: jest.fn().mockResolvedValue(users) };
  };

  it('nhân viên tạo lô vượt trần (mỗi thẻ giảm quá 200.000đ) → 403, không sinh mã', async () => {
    const { svc, createMany } = make();
    await expect(svc.create({ ...INPUT, value: 300_000, minOrder: 500_000 }, staff)).rejects.toThrow(ForbiddenException);
    await expect(svc.create({ ...INPUT, type: 'PERCENT', value: 20 }, staff)).rejects.toThrow('Giảm tối đa');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('nhân viên tạo lô trong trần → mỗi mã ghi người tạo', async () => {
    const { svc, createMany } = make();
    await svc.create(INPUT, staff);
    for (const r of createMany.mock.calls[0][0].data as Record<string, unknown>[]) {
      expect(r).toMatchObject({ createdById: 's1', updatedById: 's1' });
    }
  });

  it('quản trị viên không bị trần nhân viên', async () => {
    const { svc, createMany } = make();
    await svc.create({ ...INPUT, value: 300_000, minOrder: 500_000 }, admin);
    expect((createMany.mock.calls[0][0].data as Record<string, unknown>[])[0]).toMatchObject({ createdById: 'a1' });
  });

  const batchRow = (over: Record<string, unknown> = {}) => ({ createdById: 's2', type: 'AMOUNT', value: 30_000, maxDiscount: null, usageLimit: 1, ...over });

  it('nhân viên không tắt/bật lô do quản trị viên hoặc hệ thống tạo', async () => {
    for (const [row, users] of [
      [batchRow({ createdById: 'a1' }), [{ id: 'a1', role: 'ADMIN' }]],
      [batchRow({ createdById: null }), []],
    ] as const) {
      const { svc, prisma, findMany } = make();
      findMany.mockResolvedValueOnce([row]);
      withUsers(prisma, [...users]);
      await expect(svc.setActive('shopee', true, staff)).rejects.toThrow(ForbiddenException);
      expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    }
  });

  it('nhân viên bật lại lô nhân viên tạo → ghi người sửa', async () => {
    const { svc, prisma, findMany } = make();
    findMany.mockResolvedValueOnce([batchRow()]);
    withUsers(prisma, [{ id: 's2', role: 'STAFF' }]);
    await svc.setActive('shopee', true, staff);
    expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
      where: { batch: 'SHOPEE' },
      data: { isActive: true, updatedById: 's1' },
    });
  });

  it('lô nhân viên tạo đã vượt trần mới → nhân viên không bật lại; tắt thì được', async () => {
    const { svc, prisma, findMany } = make();
    findMany.mockResolvedValue([batchRow({ value: 300_000 })]);
    withUsers(prisma, [{ id: 's2', role: 'STAFF' }]);
    await expect(svc.setActive('shopee', true, staff)).rejects.toThrow('200.000');
    expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    await svc.setActive('shopee', false, staff);
    expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
      where: { batch: 'SHOPEE' },
      data: { isActive: false, updatedById: 's1' },
    });
  });

  it('quản trị viên tắt/bật mọi lô, ghi người sửa và sổ', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, prisma } = make();
    await svc.setActive('shopee', false, admin);
    expect((prisma.coupon as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
      where: { batch: 'SHOPEE' },
      data: { isActive: false, updatedById: 'a1' },
    });
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('Admin a1') && m.includes('SHOPEE'))).toBe(true);
    warn.mockRestore();
  });
});
