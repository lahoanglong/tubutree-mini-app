import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

const cfg = {
  get: jest.fn(async (_k: string, d: number) => d),
} as unknown as SystemConfigService;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    shift: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args) => args),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    shiftTemplate: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { ...base, ...over } as unknown as PrismaService;
}

const mk = (prisma: PrismaService) => new ShiftsService(prisma, cfg);

describe('ShiftsService.createShifts', () => {
  it('batch rỗng → BadRequest', async () => {
    await expect(mk(makePrisma()).createShifts('u1', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('end <= start → BadRequest', async () => {
    await expect(
      mk(makePrisma()).createShifts('u1', [
        {
          workDate: new Date('2026-07-10'),
          startAt: new Date('2026-07-10T05:00:00Z'),
          endAt: new Date('2026-07-10T05:00:00Z'),
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trùng ca đã có cùng ngày → BadRequest', async () => {
    const prisma = makePrisma({
      shift: {
        findMany: jest.fn().mockResolvedValue([
          { startAt: new Date('2026-07-10T01:00:00Z'), endAt: new Date('2026-07-10T05:00:00Z') },
        ]),
        create: jest.fn(),
      },
    });
    await expect(
      mk(prisma).createShifts('u1', [
        {
          workDate: new Date('2026-07-10'),
          startAt: new Date('2026-07-10T04:00:00Z'),
          endAt: new Date('2026-07-10T06:00:00Z'),
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('2 ca trong batch chồng nhau → BadRequest', async () => {
    await expect(
      mk(makePrisma()).createShifts('u1', [
        {
          workDate: new Date('2026-07-10'),
          startAt: new Date('2026-07-10T01:00:00Z'),
          endAt: new Date('2026-07-10T04:00:00Z'),
        },
        {
          workDate: new Date('2026-07-10'),
          startAt: new Date('2026-07-10T03:00:00Z'),
          endAt: new Date('2026-07-10T06:00:00Z'),
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không chồng → tạo thành công', async () => {
    const create = jest.fn().mockImplementation((a) => a);
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([]), create },
    });
    const out = await mk(prisma).createShifts('u1', [
      {
        workDate: new Date('2026-07-10'),
        startAt: new Date('2026-07-10T01:00:00Z'),
        endAt: new Date('2026-07-10T04:00:00Z'),
      },
    ]);
    expect(out).toEqual({ created: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('ShiftsService.cancelShift', () => {
  it('ca không APPROVED → BadRequest', async () => {
    const prisma = makePrisma({
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', status: 'PENDING' }) },
    });
    await expect(mk(prisma).cancelShift('u1', 's1', { reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('huỷ <3 ngày, không đột xuất → CANCELLED + cancelPenalty=true', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const soon = new Date(Date.now() + 24 * 3600 * 1000); // 1 ngày nữa
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          staffId: 'u1',
          status: 'APPROVED',
          startAt: soon,
          approvedStart: null,
          workDate: new Date('2026-07-10'),
        }),
        count: jest.fn().mockResolvedValue(0),
        updateMany,
      },
    });
    const out = await mk(prisma).cancelShift('u1', 's1', { reason: 'bận' });
    expect(out).toEqual({ cancelled: true, penalty: true });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelPenalty: true, status: 'CANCELLED' }) }),
    );
  });

  it('huỷ ≥3 ngày → cancelPenalty=false', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const far = new Date(Date.now() + 10 * 24 * 3600 * 1000); // 10 ngày nữa
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          staffId: 'u1',
          status: 'APPROVED',
          startAt: far,
          approvedStart: null,
          workDate: new Date('2026-07-10'),
        }),
        count: jest.fn().mockResolvedValue(0),
        updateMany,
      },
    });
    const out = await mk(prisma).cancelShift('u1', 's1', { reason: 'kế hoạch' });
    expect(out).toEqual({ cancelled: true, penalty: false });
  });
});

describe('ShiftsService.copyWeek', () => {
  it('dịch ngày +7 và tạo PENDING (bỏ ca trùng)', async () => {
    const src = [
      {
        workDate: new Date('2026-06-29'),
        startAt: new Date('2026-06-29T01:00:00Z'),
        endAt: new Date('2026-06-29T05:00:00Z'),
        templateId: null,
      },
    ];
    const create = jest.fn().mockImplementation((a) => a);
    const prisma = makePrisma({
      shift: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(src) // src week
          .mockResolvedValueOnce([]), // target existing
        create,
      },
    });
    const sourceWeekStart = new Date('2026-06-29T00:00:00Z');
    const targetWeekStart = new Date('2026-07-06T00:00:00Z');
    const out = await mk(prisma).copyWeek('u1', sourceWeekStart, targetWeekStart);
    expect(out).toEqual({ created: 1, skipped: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('tuần nguồn = tuần đích → BadRequest', async () => {
    const same = new Date('2026-06-29T00:00:00Z');
    await expect(mk(makePrisma()).copyWeek('u1', same, same)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ShiftsService.approve/reject (admin)', () => {
  it('approve ca không PENDING → BadRequest', async () => {
    const prisma = makePrisma({ shift: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    await expect(mk(prisma).approve('a1', 's1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approve set approvedStart khi truyền', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ shift: { updateMany } });
    const s = new Date('2026-07-10T01:00:00Z');
    const e = new Date('2026-07-10T05:00:00Z');
    await mk(prisma).approve('a1', 's1', { approvedStart: s, approvedEnd: e });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvedStart: s, approvedEnd: e, status: 'APPROVED' }) }),
    );
  });
});
