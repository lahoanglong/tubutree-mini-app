import { BadRequestException } from '@nestjs/common';
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
    payrollDay: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
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
      payrollDay: { upsert },
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
