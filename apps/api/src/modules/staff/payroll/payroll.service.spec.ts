import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollService } from './payroll.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

const config = {
  get: jest.fn(async (_k: string, d: unknown) => d),
} as unknown as SystemConfigService;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    shift: { findMany: jest.fn().mockResolvedValue([]) },
    payrollAdjustment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    payrollDay: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    payrollMonth: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 30000 }), upsert: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}
const mk = (p: PrismaService) => new PayrollService(p, config);

describe('PayrollService.ensureFines', () => {
  it('có phiên trễ → tạo LATE (1 lần)', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: false, sessions: [{ isLate: true }] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue(null), create },
    });
    await mk(prisma).ensureFines('u1', new Date('2026-07-03'), 30000);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'LATE', amount: 10000, shiftId: 's1' }) }),
    );
  });

  it('ca huỷ trễ (cancelPenalty) → tạo LATE_CANCEL = 1h công (rate)', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: true, sessions: [] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue(null), create },
    });
    await mk(prisma).ensureFines('u1', new Date('2026-07-03'), 25000);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'LATE_CANCEL', amount: 25000 }) }),
    );
  });

  it('phạt đã tồn tại → không tạo trùng', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: false, sessions: [{ isLate: true }] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue({ id: 'a1' }), create },
    });
    await mk(prisma).ensureFines('u1', new Date('2026-07-03'), 30000);
    expect(create).not.toHaveBeenCalled();
  });

  it('race: 2 recompute song song — pre-check đọc "chưa có phạt" nhưng create() đụng unique index (shiftId,type) → nuốt lỗi, KHÔNG throw, KHÔNG trừ lương 2 lần', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: false, sessions: [{ isLate: true }] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue(null), create }, // pre-check thua race
    });
    await expect(mk(prisma).ensureFines('u1', new Date('2026-07-03'), 30000)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('PayrollService.recomputeDay', () => {
  it('upsert PayrollDay với gross/net đúng (2h × 30k = 60k)', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 30000 }) },
      shift: {
        findMany: jest
          .fn()
          // ensureFines call
          .mockResolvedValueOnce([])
          // recomputeDay shifts call
          .mockResolvedValueOnce([
            {
              startAt: new Date('2026-07-03T01:00:00Z'),
              endAt: new Date('2026-07-03T05:00:00Z'),
              approvedStart: null,
              approvedEnd: null,
              sessions: [{ checkinAt: new Date('2026-07-03T01:00:00Z'), checkoutAt: new Date('2026-07-03T03:00:00Z') }],
            },
          ]),
      },
      payrollAdjustment: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      payrollDay: { upsert, findUnique: jest.fn().mockResolvedValue(null) },
    });
    const pay = await mk(prisma).recomputeDay('u1', new Date('2026-07-03'));
    expect(pay.gross).toBe(60000);
    expect(pay.net).toBe(60000);
    expect(upsert).toHaveBeenCalled();
  });
});

describe('PayrollService.recomputeStaffMonth', () => {
  it('tháng đã PAID → không recompute, trả nguyên', async () => {
    const upsert = jest.fn();
    const prisma = makePrisma({
      payrollMonth: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', status: 'PAID' }), upsert },
    });
    const out = await mk(prisma).recomputeStaffMonth('u1', 2026, 7);
    expect(out).toEqual({ id: 'm1', status: 'PAID' });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('PayrollService.markPaid / finalize', () => {
  it('markPaid thiếu proof → BadRequest', async () => {
    await expect(mk(makePrisma()).markPaid('u1', 2026, 7, '', undefined, 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('markPaid đã trả (updateMany count 0) → BadRequest', async () => {
    const prisma = makePrisma({
      payrollMonth: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      mk(prisma).markPaid('u1', 2026, 7, 'http://img/proof.jpg', undefined, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finalize tháng không mở → BadRequest', async () => {
    const prisma = makePrisma({
      payrollMonth: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      shift: { findMany: jest.fn().mockResolvedValue([]) },
      payrollAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      payrollDay: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(mk(prisma).finalize('u1', 2026, 7)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Đơn giá giờ phải KHOÁ THEO NGÀY. Trước đây recomputeDay luôn đọc hourlyRate HIỆN TẠI của hồ
 * sơ, còn recomputeStaffMonth thì tính lại MỌI ngày trong tháng — nên đổi đơn giá ngày 11 là tự
 * động định giá lại cả 10 ngày đã làm xong (trả dư khi tăng, ăn bớt lương đã làm khi giảm). Chỉ
 * cần NV mở màn "Lương của tôi" là recompute chạy.
 */
describe('PayrollService.recomputeDay — đơn giá khoá theo ngày', () => {
  const dayWithTwoHours = (over: Record<string, unknown> = {}) =>
    makePrisma({
      shift: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              startAt: new Date('2026-07-03T01:00:00Z'),
              endAt: new Date('2026-07-03T05:00:00Z'),
              approvedStart: null,
              approvedEnd: null,
              sessions: [{ checkinAt: new Date('2026-07-03T01:00:00Z'), checkoutAt: new Date('2026-07-03T03:00:00Z') }],
            },
          ]),
      },
      ...over,
    });

  it('ngày đã có bản ghi lương với đơn giá cũ → giữ đơn giá CŨ, không định giá lại', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = dayWithTwoHours({
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 40000 }) }, // đơn giá MỚI
      payrollDay: { upsert, findUnique: jest.fn().mockResolvedValue({ hourlyRate: 25000 }) },
    });

    const pay = await mk(prisma).recomputeDay('u1', new Date('2026-07-03'));

    expect(pay.gross).toBe(50000); // 2h × 25k, KHÔNG phải 2h × 40k
    expect(upsert.mock.calls[0][0].update.hourlyRate).toBe(25000);
  });

  it('ngày chưa có bản ghi → lấy đơn giá hiện hành của hồ sơ', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = dayWithTwoHours({
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 40000 }) },
      payrollDay: { upsert, findUnique: jest.fn().mockResolvedValue(null) },
    });

    const pay = await mk(prisma).recomputeDay('u1', new Date('2026-07-03'));

    expect(pay.gross).toBe(80000);
  });

  it('bản ghi cũ có đơn giá 0 (chưa từng set) → dùng đơn giá hiện hành', async () => {
    const prisma = dayWithTwoHours({
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 40000 }) },
      payrollDay: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ hourlyRate: 0 }) },
    });

    const pay = await mk(prisma).recomputeDay('u1', new Date('2026-07-03'));

    expect(pay.gross).toBe(80000);
  });

  it('reprice: true (quản lý bấm tính lại có chủ đích) → mới áp đơn giá mới cho ngày cũ', async () => {
    const prisma = dayWithTwoHours({
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 40000 }) },
      payrollDay: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ hourlyRate: 25000 }) },
    });

    const pay = await mk(prisma).recomputeDay('u1', new Date('2026-07-03'), { reprice: true });

    expect(pay.gross).toBe(80000);
  });
});

describe('PayrollService.recomputeStaffMonth — tiền phạt thật sự bị trừ', () => {
  it('ngày huỷ ca (net âm) kéo giảm thực nhận cả tháng', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      payrollDay: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          { workedMinutes: 480, gross: 240000, fines: 0, net: 240000 },
          { workedMinutes: 0, gross: 0, fines: 30000, net: -30000 },
        ]),
      },
      payrollMonth: { findUnique: jest.fn().mockResolvedValue(null), upsert },
    });

    await mk(prisma).recomputeStaffMonth('u1', 2026, 7);

    expect(upsert.mock.calls[0][0].update).toMatchObject({ gross: 240000, totalFines: 30000, net: 210000 });
  });

  it('phạt vượt lương cả tháng → thực nhận 0, không đòi ngược nhân viên', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      payrollDay: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ workedMinutes: 0, gross: 0, fines: 30000, net: -30000 }]),
      },
      payrollMonth: { findUnique: jest.fn().mockResolvedValue(null), upsert },
    });

    await mk(prisma).recomputeStaffMonth('u1', 2026, 7);

    expect(upsert.mock.calls[0][0].update.net).toBe(0);
  });
});
