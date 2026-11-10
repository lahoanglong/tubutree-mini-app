import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { LOCK_BUSY_MESSAGE } from '../../../common/lock-busy';
import { ShiftsService } from './shifts.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

const cfg = {
  get: jest.fn(async (_k: string, d: number) => d),
} as unknown as SystemConfigService;

type Mocks = Record<string, unknown>;

// Bản tx và bản prisma ngoài mang hai jest.fn RIÊNG cho mỗi hàm, cùng chuyển lời gọi về hàm gốc trong `over`: assertion đặt trên hàm gốc
// vẫn đúng dù lời gọi đi qua bên nào, còn bên nào bị gọi thì đo được riêng, nên đọc/ghi lọt ra ngoài giao dịch sẽ bị bắt.
function mirror(src: Mocks): Mocks {
  const out: Mocks = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'function') out[k] = jest.fn((...a: unknown[]) => (v as (...x: unknown[]) => unknown)(...a));
    else if (v && typeof v === 'object') out[k] = mirror(v as Mocks);
    else out[k] = v;
  }
  return out;
}

function makeSplit(over: Mocks = {}) {
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
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const { $transaction: _custom, ...fns } = { ...base, ...over } as Mocks;
  const tx = mirror(fns);
  const outer = mirror(fns);
  // Mọi đường ghi (createShifts, updateShift, copyWeek, cancelShift) gọi $transaction(async tx => {...}) với `tx` RIÊNG, không phải `outer`.
  // Test tự truyền `over.$transaction` (vd để giả lập P2034) thì giữ nguyên, không ghi đè.
  outer.$transaction = '$transaction' in over ? over.$transaction : jest.fn((fn: (t: unknown) => unknown) => fn(tx));
  return { prisma: outer as unknown as PrismaService, tx, outer };
}

function makePrisma(over: Mocks = {}) {
  return makeSplit(over).prisma;
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

  it('dùng $transaction isolationLevel Serializable (chống 2 huỷ ca khẩn cấp cùng lúc cùng vượt trần)', async () => {
    const soon = new Date(Date.now() + 24 * 3600 * 1000);
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1', staffId: 'u1', status: 'APPROVED', startAt: soon, approvedStart: null,
          workDate: new Date('2026-07-10'),
        }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    await mk(prisma).cancelShift('u1', 's1', { reason: 'bận', isEmergency: true });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('race P2034 (serialization failure giữa 2 huỷ ca) → báo thử lại, không phải 500', async () => {
    const soon = new Date(Date.now() + 24 * 3600 * 1000);
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1', staffId: 'u1', status: 'APPROVED', startAt: soon, approvedStart: null,
          workDate: new Date('2026-07-10'),
        }),
      },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' }),
    });
    await expect(mk(prisma).cancelShift('u1', 's1', { reason: 'bận' })).rejects.toThrow(
      'Hệ thống đang bận xử lý, bạn thử lại nhé.',
    );
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

describe('ShiftsService.updateShift', () => {
  const shift = {
    id: 's1',
    staffId: 'u1',
    status: 'PENDING',
    workDate: new Date('2026-07-10'),
    startAt: new Date('2026-07-10T01:00:00Z'),
    endAt: new Date('2026-07-10T05:00:00Z'),
  };

  it('RC-03: ghi kèm điều kiện PENDING, ca vừa được duyệt (count 0) → BadRequest', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findFirst = jest.fn().mockResolvedValueOnce(shift).mockResolvedValueOnce({ status: 'APPROVED' });
    const prisma = makePrisma({ shift: { findFirst, findMany: jest.fn().mockResolvedValue([]), updateMany } });
    await expect(
      mk(prisma).updateShift('u1', 's1', { endAt: new Date('2026-07-10T07:00:00Z') }),
    ).rejects.toThrow('Ca vừa được duyệt, tải lại');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', staffId: 'u1', status: 'PENDING' } }),
    );
  });

  it.each([
    [{ status: 'REJECTED' }, 'Ca vừa bị từ chối, tải lại'],
    [null, 'Ca không còn nữa, tải lại'],
    [{ status: 'CANCELLED' }, 'Ca vừa đổi trạng thái, tải lại'],
  ])('count 0, đọc lại ca = %j → lời báo đúng trạng thái', async (now, msg) => {
    const findFirst = jest.fn().mockResolvedValueOnce(shift).mockResolvedValueOnce(now);
    const prisma = makePrisma({
      shift: { findFirst, findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(mk(prisma).updateShift('u1', 's1', { endAt: new Date('2026-07-10T07:00:00Z') })).rejects.toThrow(msg);
  });

  it('ca còn PENDING → ghi giờ mới và trả ca', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const endAt = new Date('2026-07-10T07:00:00Z');
    const findFirst = jest.fn().mockResolvedValueOnce(shift).mockResolvedValueOnce({ ...shift, endAt });
    const prisma = makePrisma({ shift: { findFirst, findMany: jest.fn().mockResolvedValue([]), updateMany } });
    const res = await mk(prisma).updateShift('u1', 's1', { endAt });
    expect(res).toMatchObject({ id: 's1', endAt });
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

/**
 * Không lọc trạng thái thì ca đã bị TỪ CHỐI/đã huỷ tuần trước cũng được chép sang: nhân viên
 * đăng 08:00–12:00 bị REJECT rồi đăng lại 09:00–13:00 (APPROVED), bấm "Copy tuần trước" là ra
 * HAI ca chồng giờ — đúng thứ createShifts cố tình cấm; admin bulk-approve xong là hai ca
 * APPROVED trùng giờ, giờ công tính hai lần.
 */
describe('ShiftsService.copyWeek — chỉ chép ca còn hiệu lực, không tạo ca chồng', () => {
  const monday = new Date('2026-07-06T00:00:00.000Z');
  const nextMonday = new Date('2026-07-13T00:00:00.000Z');

  function mkPrisma(src: unknown[]) {
    const findMany = jest.fn().mockResolvedValueOnce(src).mockResolvedValueOnce([]);
    const create = jest.fn().mockImplementation(({ data }) => data);
    const tx = { shift: { findMany, create }, $queryRaw: jest.fn().mockResolvedValue([]) };
    const prisma = {
      shift: { findMany: jest.fn(), create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    return { prisma, findMany, create };
  }

  it('truy vấn ca nguồn lọc theo trạng thái PENDING/APPROVED', async () => {
    const { prisma, findMany } = mkPrisma([]);
    await mk(prisma).copyWeek('u1', monday, nextMonday);
    expect(findMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'APPROVED'] });
  });

  it('hai ca nguồn chồng giờ nhau → chỉ chép một, không đẩy cả hai sang tuần đích', async () => {
    const sh = (h1: number, h2: number) => ({
      workDate: monday,
      startAt: new Date(`2026-07-06T0${h1}:00:00.000Z`),
      endAt: new Date(`2026-07-06T${String(h2).padStart(2, '0')}:00:00.000Z`),
      templateId: null,
    });
    const { prisma, create } = mkPrisma([sh(1, 5), sh(2, 6)]);

    const out = await mk(prisma).copyWeek('u1', monday, nextMonday);

    expect(out).toEqual({ created: 1, skipped: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('ShiftsService — khoá dòng nhân viên xếp hàng các yêu cầu song song trước khi kiểm chồng giờ', () => {
  const day = new Date('2026-07-10T00:00:00Z');
  const item = { workDate: day, startAt: new Date('2026-07-10T01:00:00Z'), endAt: new Date('2026-07-10T04:00:00Z') };

  function traced() {
    const order: string[] = [];
    const lockSql: string[] = [];
    const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push('lock');
      lockSql.push(`${strings.join('?')}|${values.join(',')}`);
      return [];
    });
    const findMany = jest.fn(async () => { order.push('find'); return []; });
    const findFirst = jest.fn(async () => { order.push('find'); return { id: 's1', staffId: 'u1', status: 'PENDING', workDate: day, startAt: item.startAt, endAt: item.endAt }; });
    const create = jest.fn(async () => { order.push('write'); return {}; });
    const updateMany = jest.fn(async () => { order.push('write'); return { count: 1 }; });
    const prisma = makePrisma({ $queryRaw: queryRaw, shift: { findMany, findFirst, create, updateMany } });
    return { prisma, order, lockSql };
  }

  it('createShifts: khoá dòng users của nhân viên trước khi đọc ca đang có và trước khi ghi', async () => {
    const { prisma, order, lockSql } = traced();
    await mk(prisma).createShifts('u1', [item]);
    expect(order).toEqual(['lock', 'find', 'write']);
    expect(lockSql[0]).toMatch(/FROM "users" WHERE "id" = \? FOR NO KEY UPDATE\|u1$/);
  });

  it('updateShift: khoá trước khi đọc ca và đọc ca khác cùng ngày, rồi mới ghi', async () => {
    const { prisma, order, lockSql } = traced();
    await mk(prisma).updateShift('u1', 's1', { endAt: new Date('2026-07-10T05:00:00Z') });
    expect(order.slice(0, 3)).toEqual(['lock', 'find', 'find']);
    expect(order.indexOf('write')).toBeGreaterThan(order.lastIndexOf('lock'));
    expect(lockSql[0]).toMatch(/FOR NO KEY UPDATE\|u1$/);
  });

  it('copyWeek: khoá trước khi đọc tuần nguồn và tuần đích', async () => {
    const { prisma, order, lockSql } = traced();
    await mk(prisma).copyWeek('u1', new Date('2026-07-06T00:00:00Z'), new Date('2026-07-13T00:00:00Z'));
    expect(order).toEqual(['lock', 'find', 'find']);
    expect(lockSql[0]).toMatch(/FOR NO KEY UPDATE\|u1$/);
  });

  it('lỗi chồng giờ vẫn là BadRequest và không ghi gì (giao dịch đã mở và khoá trước đó)', async () => {
    const create = jest.fn();
    const findMany = jest.fn().mockResolvedValue([{ startAt: item.startAt, endAt: item.endAt }]);
    const { prisma, tx, outer } = makeSplit({ shift: { findMany, create } });
    await expect(mk(prisma).createShifts('u1', [item])).rejects.toThrow('Ca bị chồng với ca đã đăng ký.');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(outer.$queryRaw).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ShiftsService: đăng ký, sửa giờ, chép tuần đọc và ghi trên tx, không lọt ra prisma ngoài giao dịch', () => {
  const day = new Date('2026-07-10T00:00:00Z');
  const item = { workDate: day, startAt: new Date('2026-07-10T01:00:00Z'), endAt: new Date('2026-07-10T04:00:00Z') };
  const current = { id: 's1', staffId: 'u1', status: 'PENDING', workDate: day, startAt: item.startAt, endAt: item.endAt };
  const fullShift = (o: Record<string, jest.Mock> = {}) => ({
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    ...o,
  });
  const shiftOf = (o: Mocks) => o.shift as Record<string, jest.Mock>;
  const rawOf = (o: Mocks) => o.$queryRaw as jest.Mock;
  /** Bản ngoài giao dịch: không một hàm đọc/ghi ca nào, cũng không câu raw nào được gọi. */
  const expectOuterUntouched = (outer: Mocks) => {
    for (const [name, fn] of Object.entries(shiftOf(outer))) expect([name, fn.mock.calls.length]).toEqual([name, 0]);
    expect(rawOf(outer)).not.toHaveBeenCalled();
  };

  it('createShifts: khoá, đọc ca đang có và tạo ca đều trên tx', async () => {
    const { prisma, tx, outer } = makeSplit({ shift: fullShift() });
    await mk(prisma).createShifts('u1', [item]);
    expect(rawOf(tx)).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).findMany).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).create).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).createMany).not.toHaveBeenCalled();
    expectOuterUntouched(outer);
  });

  it('updateShift: khoá, đọc ca, đọc ca khác cùng ngày và ghi giờ mới đều trên tx', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, endAt: new Date('2026-07-10T05:00:00Z') });
    const { prisma, tx, outer } = makeSplit({ shift: fullShift({ findFirst }) });
    await mk(prisma).updateShift('u1', 's1', { endAt: new Date('2026-07-10T05:00:00Z') });
    expect(rawOf(tx)).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).findFirst).toHaveBeenCalledTimes(2);
    expect(shiftOf(tx).findMany).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).updateMany).toHaveBeenCalledTimes(1);
    expectOuterUntouched(outer);
  });

  it('updateShift: ghi trượt (count 0) thì đọc lại trạng thái cũng trên tx', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce({ status: 'APPROVED' });
    const { prisma, tx, outer } = makeSplit({ shift: fullShift({ findFirst, updateMany: jest.fn().mockResolvedValue({ count: 0 }) }) });
    await expect(mk(prisma).updateShift('u1', 's1', { endAt: new Date('2026-07-10T05:00:00Z') })).rejects.toThrow('Ca vừa được duyệt, tải lại');
    expect(shiftOf(tx).findFirst).toHaveBeenCalledTimes(2);
    expectOuterUntouched(outer);
  });

  it('copyWeek: khoá, đọc tuần nguồn, đọc tuần đích và tạo ca đều trên tx', async () => {
    const src = [{ workDate: new Date('2026-06-29'), startAt: new Date('2026-06-29T01:00:00Z'), endAt: new Date('2026-06-29T05:00:00Z'), templateId: null }];
    const findMany = jest.fn().mockResolvedValueOnce(src).mockResolvedValueOnce([]);
    const { prisma, tx, outer } = makeSplit({ shift: fullShift({ findMany }) });
    await mk(prisma).copyWeek('u1', new Date('2026-06-29T00:00:00Z'), new Date('2026-07-06T00:00:00Z'));
    expect(rawOf(tx)).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).findMany).toHaveBeenCalledTimes(2);
    expect(shiftOf(tx).create).toHaveBeenCalledTimes(1);
    expect(shiftOf(tx).createMany).not.toHaveBeenCalled();
    expectOuterUntouched(outer);
  });

  describe('thua tranh khoá của nhân viên', () => {
    const CALLS: [string, (svc: ShiftsService) => Promise<unknown>][] = [
      ['createShifts', (svc) => svc.createShifts('u1', [item])],
      ['updateShift', (svc) => svc.updateShift('u1', 's1', { endAt: new Date('2026-07-10T05:00:00Z') })],
      ['copyWeek', (svc) => svc.copyWeek('u1', new Date('2026-07-06T00:00:00Z'), new Date('2026-07-13T00:00:00Z'))],
    ];

    it.each(CALLS)('%s: hết hạn chờ khoá → 503 "Hệ thống đang bận", không phải 500', async (_name, call) => {
      const prisma = makePrisma({ $transaction: jest.fn().mockRejectedValue(new Error('canceling statement due to lock timeout')) });
      const err = await call(mk(prisma)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).message).toBe(LOCK_BUSY_MESSAGE);
    });

    it.each(CALLS)('%s: lỗi khác ném nguyên, không bị đổi thành 503', async (_name, call) => {
      const boom = new Error('boom');
      const prisma = makePrisma({ $transaction: jest.fn().mockRejectedValue(boom) });
      await expect(call(mk(prisma))).rejects.toBe(boom);
    });
  });
});

describe('ShiftsService.createTemplate — chống thêm ca chuẩn trùng', () => {
  const dto = { name: 'Ca sáng', startMin: 480, endMin: 720 };
  const withTx = (findMany: jest.Mock, create: jest.Mock) =>
    makePrisma({
      $executeRaw: jest.fn().mockResolvedValue(1),
      shiftTemplate: { findMany, findFirst: jest.fn(), create, updateMany: jest.fn(), delete: jest.fn() },
    });

  it('trùng tên (không phân biệt hoa thường, thừa khoảng trắng) → 409, không tạo', async () => {
    const create = jest.fn();
    const findMany = jest.fn().mockResolvedValue([{ id: 't1', name: 'ca sáng' }]);
    await expect(mk(withTx(findMany, create)).createTemplate({ ...dto, name: '  CA SÁNG ' })).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['Ca_1', '%', 'Ca%', '_'])('tên "%s" chứa ký tự đại diện của LIKE vẫn so đúng nghĩa đen, không trùng "Ca 1"', async (name) => {
    const create = jest.fn().mockResolvedValue({ id: 't2' });
    const findMany = jest.fn().mockResolvedValue([{ id: 't1', name: 'Ca 1' }, { id: 't3', name: 'Ca chiều' }]);
    await mk(withTx(findMany, create)).createTemplate({ ...dto, name });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ name }) });
  });

  it('chưa có tên trùng → tạo, tên đã cắt khoảng trắng', async () => {
    const create = jest.fn().mockResolvedValue({ id: 't2' });
    await mk(withTx(jest.fn().mockResolvedValue([]), create)).createTemplate({ ...dto, name: ' Ca chiều ' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Ca chiều' }) });
  });

  it('khoá advisory được lấy trước khi kiểm trùng (hai lần thêm song song xếp hàng)', async () => {
    const order: string[] = [];
    const exec = jest.fn(async () => { order.push('lock'); return 1; });
    const findMany = jest.fn(async () => { order.push('find'); return []; });
    const create = jest.fn(async () => { order.push('create'); return {}; });
    const prisma = makePrisma({
      $executeRaw: exec,
      shiftTemplate: { findMany, findFirst: jest.fn(), create, updateMany: jest.fn(), delete: jest.fn() },
    });
    await mk(prisma).createTemplate(dto);
    expect(order).toEqual(['lock', 'find', 'create']);
  });
});

describe('ShiftsService.updateTemplate — đổi tên không được trùng ca khác', () => {
  const make = (rows: { id: string; name: string }[]) => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      $executeRaw: jest.fn().mockResolvedValue(1),
      shiftTemplate: { findMany: jest.fn().mockResolvedValue(rows), findFirst: jest.fn(), create: jest.fn(), updateMany, delete: jest.fn() },
    });
    return { svc: mk(prisma), updateMany };
  };
  const rows = [{ id: 't1', name: 'Ca sáng' }, { id: 't2', name: 'Ca chiều' }];

  it('đổi sang tên của ca khác → 409, không ghi', async () => {
    const { svc, updateMany } = make(rows);
    await expect(svc.updateTemplate('t2', { name: ' CA SÁNG ' })).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('giữ nguyên tên của chính ca đang sửa (đổi giờ, đổi hoa thường) vẫn được; tên lưu đã cắt khoảng trắng', async () => {
    const { svc, updateMany } = make(rows);
    await svc.updateTemplate('t1', { name: ' ca SÁNG ', startMin: 420 });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'ca SÁNG', startMin: 420 } });
  });

  it('không gửi tên thì không kiểm trùng', async () => {
    const { svc, updateMany } = make(rows);
    await svc.updateTemplate('t1', { active: false });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 't1' }, data: { active: false } });
  });
});
