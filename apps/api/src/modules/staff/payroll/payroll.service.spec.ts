import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  it('phạt đã tồn tại, số tiền đúng → không tạo trùng, không sửa', async () => {
    const create = jest.fn();
    const update = jest.fn();
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: false, sessions: [{ isLate: true }] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue({ id: 'a1', amount: 10000 }), create, update },
    });
    await mk(prisma).ensureFines('u1', new Date('2026-07-03'), 30000);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * Phạt huỷ ca = 1 GIỜ CÔNG nên phụ thuộc đơn giá. Tạo một lần rồi không bao giờ cập nhật
   * nghĩa là: nhân viên mới chưa có hồ sơ lương (rate = 0) huỷ ca trễ → phiếu phạt amount = 0
   * VĨNH VIỄN, sau này admin đặt đơn giá thật cũng không sửa được.
   */
  it('phạt huỷ ca đã tồn tại với số tiền cũ (0đ vì chưa có đơn giá) → cập nhật theo đơn giá hiện tại', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', cancelPenalty: true, sessions: [] }]) },
      payrollAdjustment: { findFirst: jest.fn().mockResolvedValue({ id: 'a1', amount: 0 }), create: jest.fn(), update },
    });
    await mk(prisma).ensureFines('u1', new Date('2026-07-03'), 30000);
    expect(update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { amount: 30000 } });
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

  it('markPaid đã trả (updateMany count 0, bảng lương vẫn tồn tại) → BadRequest', async () => {
    const prisma = makePrisma({
      payrollMonth: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ status: 'PAID' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(
      mk(prisma).markPaid('u1', 2026, 7, 'http://img/proof.jpg', undefined, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markPaid khi CHƯA có bảng lương → NotFound (trước đây báo nhầm "đã trả", che mất lỗi gõ sai staffId)', async () => {
    const prisma = makePrisma({
      payrollMonth: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(
      mk(prisma).markPaid('u1', 2026, 7, 'http://img/proof.jpg', undefined, 'a1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markPaid tính lại tháng TRƯỚC khi đóng băng (tháng OPEN có thể vừa nhận thêm phiên)', async () => {
    const monthUpsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      payrollMonth: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: monthUpsert,
      },
    });
    await mk(prisma).markPaid('u1', 2026, 7, 'http://img/proof.jpg', undefined, 'a1');
    expect(monthUpsert).toHaveBeenCalled();
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

/**
 * FINALIZED từng là ngõ cụt: không có endpoint nào đưa tháng về OPEN, recompute bị chặn vĩnh
 * viễn, FE ẩn luôn nút "Chốt" khi khác OPEN. Phát hiện sai giờ sau khi chốt là hết cách sửa
 * trong app — mà sửa giờ phiên vẫn ghi đè PayrollDay trong khi tổng tháng đứng yên, nên màn
 * hình hiện đồng thời số ngày MỚI và tổng tháng CŨ.
 */
describe('PayrollService — tháng đã chốt là khoá, nhưng mở lại được', () => {
  const locked = (status: string) =>
    makePrisma({
      payrollMonth: {
        findUnique: jest.fn().mockResolvedValue({ status }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      payrollDay: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    });

  it('sửa giờ ngày thuộc tháng đã CHỐT → từ chối thay vì ghi đè lệch với tổng tháng', async () => {
    const prisma = locked('FINALIZED');
    await expect(mk(prisma).recomputeDay('u1', new Date('2026-07-03'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('điều chỉnh tay vào tháng đã TRẢ → từ chối', async () => {
    const prisma = locked('PAID');
    await expect(mk(prisma).adjust('u1', new Date('2026-07-03'), 50000, 'thưởng', 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('mở lại tháng đã chốt → về OPEN rồi tính lại', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      payrollMonth: { findUnique: jest.fn().mockResolvedValue(null), updateMany, upsert },
      payrollDay: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    });

    await mk(prisma).reopen('u1', 2026, 7, 'admin1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { staffId: 'u1', year: 2026, month: 7, status: { in: ['FINALIZED', 'PAID'] } },
      data: { status: 'OPEN', finalizedAt: null },
    });
    expect(upsert).toHaveBeenCalled();
  });

  it('mở lại tháng đang mở → BadRequest (không có gì để mở)', async () => {
    const prisma = makePrisma({
      payrollMonth: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(mk(prisma).reopen('u1', 2026, 7, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Unique (shiftId, type) không áp cho MANUAL vì shiftId là NULL, mà Postgres coi mỗi NULL là một
 * giá trị riêng. Một lần retry/timeout mạng khi gửi khoản trừ 500.000 trước đây tạo hai bản ghi
 * → trừ một triệu, và không có gì báo cho ai biết.
 */
describe('PayrollService.adjust — chống gửi trùng', () => {
  const base = () =>
    makePrisma({
      payrollMonth: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      payrollDay: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    });

  it('cùng ngày + cùng số tiền + cùng lý do trong 5 phút → bỏ qua lần thứ hai', async () => {
    const create = jest.fn();
    const prisma = base();
    (prisma as unknown as { payrollAdjustment: Record<string, jest.Mock> }).payrollAdjustment = {
      findFirst: jest.fn().mockResolvedValue({ id: 'adj-1' }),
      create,
      findMany: jest.fn().mockResolvedValue([]),
    };

    await expect(mk(prisma).adjust('u1', new Date('2026-07-03'), 500000, 'trừ tạm ứng', 'a1')).resolves.toMatchObject({
      deduped: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('chưa có khoản giống hệt → vẫn tạo bình thường', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = base();
    (prisma as unknown as { payrollAdjustment: Record<string, jest.Mock> }).payrollAdjustment = {
      findFirst: jest.fn().mockResolvedValue(null),
      create,
      findMany: jest.fn().mockResolvedValue([]),
    };

    await mk(prisma).adjust('u1', new Date('2026-07-03'), 500000, 'trừ tạm ứng', 'a1');
    expect(create).toHaveBeenCalled();
  });
});

/**
 * Mỗi lần admin mở tab Lương (kể cả chỉ để xem tháng cũ) trước đây chạy recompute tuần tự cho
 * từng nhân sự — một GET gây ghi PayrollDay/PayrollMonth cho cả tháng đã qua, kèm findUnique hồ
 * sơ trong vòng lặp (N+1).
 */
describe('PayrollService.adminMonth — GET không ghi dữ liệu tháng cũ', () => {
  const members = [
    { id: 'u1', fullName: 'A', phone: '01' },
    { id: 'u2', fullName: 'B', phone: '02' },
  ];

  function mkPrisma() {
    const monthUpsert = jest.fn().mockResolvedValue({});
    const profileFindMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      user: { findMany: jest.fn().mockResolvedValue(members) },
      staffProfile: { findMany: profileFindMany, findUnique: jest.fn().mockResolvedValue(null) },
      payrollMonth: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: monthUpsert,
      },
      payrollDay: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    });
    return { prisma, monthUpsert, profileFindMany };
  }

  it('xem THÁNG CŨ → không recompute, không ghi gì', async () => {
    const { prisma, monthUpsert } = mkPrisma();
    await mk(prisma).adminMonth(2020, 1);
    expect(monthUpsert).not.toHaveBeenCalled();
  });

  it('xem THÁNG HIỆN TẠI → vẫn tính lại để số liệu tươi', async () => {
    const { prisma, monthUpsert } = mkPrisma();
    const vnNow = new Date(Date.now() + 7 * 3600_000);
    await mk(prisma).adminMonth(vnNow.getUTCFullYear(), vnNow.getUTCMonth() + 1);
    expect(monthUpsert).toHaveBeenCalled();
  });

  it('nạp hồ sơ lương theo LÔ, không findUnique trong vòng lặp', async () => {
    const { prisma, profileFindMany } = mkPrisma();
    const rows = await mk(prisma).adminMonth(2020, 1);
    expect(rows).toHaveLength(2);
    expect(profileFindMany).toHaveBeenCalledTimes(1);
  });

  it('chưa có bảng lương tháng đó → trả số 0, không tạo bản ghi rỗng', async () => {
    const { prisma, monthUpsert } = mkPrisma();
    const rows = await mk(prisma).adminMonth(2020, 1);
    expect(rows[0]!.month).toMatchObject({ net: 0, status: 'OPEN' });
    expect(monthUpsert).not.toHaveBeenCalled();
  });
});

describe('PayrollService.recomputeStaffMonth — không kiểm trạng thái tháng lặp lại cho từng ngày', () => {
  it('tháng 26 ngày công → chỉ 1 lần đọc PayrollMonth để kiểm khoá, không phải 26', async () => {
    const days = Array.from({ length: 26 }, (_, i) => ({
      id: `sh${i}`,
      workDate: new Date(Date.UTC(2026, 6, i + 1)),
      cancelPenalty: false,
      sessions: [],
      startAt: new Date(Date.UTC(2026, 6, i + 1, 1)),
      endAt: new Date(Date.UTC(2026, 6, i + 1, 9)),
      approvedStart: null,
      approvedEnd: null,
    }));
    const monthFindUnique = jest.fn().mockResolvedValue(null);
    const prisma = makePrisma({
      shift: { findMany: jest.fn().mockResolvedValue(days) },
      payrollAdjustment: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      payrollDay: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      payrollMonth: { findUnique: monthFindUnique, upsert: jest.fn().mockResolvedValue({}) },
    });

    await mk(prisma).recomputeStaffMonth('u1', 2026, 7);

    // 1 lần duy nhất ở đầu recomputeStaffMonth — recomputeDay không kiểm lại.
    expect(monthFindUnique).toHaveBeenCalledTimes(1);
  });

  it('gọi recomputeDay TRỰC TIẾP (admin sửa giờ) → vẫn kiểm khoá tháng', async () => {
    const monthFindUnique = jest.fn().mockResolvedValue({ status: 'FINALIZED' });
    const prisma = makePrisma({
      payrollMonth: { findUnique: monthFindUnique, upsert: jest.fn() },
      payrollDay: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(mk(prisma).recomputeDay('u1', new Date('2026-07-03'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(monthFindUnique).toHaveBeenCalled();
  });
});
