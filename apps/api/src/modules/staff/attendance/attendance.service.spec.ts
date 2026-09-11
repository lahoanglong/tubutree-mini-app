import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

const CFG: Record<string, unknown> = {
  'attendance.office_ips': ['113.161.1.0/24'],
  'attendance.office_lat': 10.7769,
  'attendance.office_lng': 106.7009,
  'attendance.radius_m': 150,
  'attendance.enforce_ip': true,
  'attendance.late_grace_min': 30,
  'attendance.checkin_early_min': 60,
  'attendance.heartbeat_stale_min': 10,
};
const config = {
  get: jest.fn(async (k: string, d: unknown) => (k in CFG ? CFG[k] : d)),
} as unknown as SystemConfigService;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    shift: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    attendanceSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'sess1' }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { ...base, ...over } as unknown as PrismaService;
}
const mk = (p: PrismaService) => new AttendanceService(p, config);

const IN = { lat: 10.7769, lng: 106.7009 };
const GOOD_IP = '113.161.1.5';

describe('AttendanceService.checkin', () => {
  it('ca không APPROVED/không thuộc mình → NotFound', async () => {
    const prisma = makePrisma({ shift: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sai IP → BadRequest', async () => {
    const prisma = makePrisma({
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', status: 'APPROVED', startAt: new Date(), endAt: new Date(Date.now() + 8 * 3600_000), approvedStart: null, approvedEnd: null }) },
    });
    await expect(mk(prisma).checkin('u1', '8.8.8.8', { shiftId: 's1', ...IN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đang có phiên mở → BadRequest', async () => {
    const prisma = makePrisma({
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', status: 'APPROVED', startAt: new Date(), endAt: new Date(Date.now() + 8 * 3600_000), approvedStart: null, approvedEnd: null }) },
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'open1' }),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('race: 2 checkin() song song — pre-check đọc "chưa có phiên mở" nhưng create() đụng unique index partial → BadRequest (không tạo 2 phiên mở, không khai khống giờ payroll)', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    const prisma = makePrisma({
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', status: 'APPROVED', startAt: new Date(), endAt: new Date(Date.now() + 8 * 3600_000), approvedStart: null, approvedEnd: null }) },
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue(null), // pre-check: chưa thấy phiên mở (thua race)
        count: jest.fn().mockResolvedValue(0),
        create,
        update: jest.fn(),
      },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).rejects.toThrow(
      'Bạn đang trong ca, hãy checkout trước.',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('checkin đúng, đúng giờ → tạo phiên, isLate=false', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'sess1' });
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          staffId: 'u1',
          status: 'APPROVED',
          startAt: new Date(Date.now() - 5 * 60000), // ca vừa bắt đầu 5' trước
          endAt: new Date(Date.now() + 8 * 3600_000),
          approvedStart: null,
          approvedEnd: null,
        }),
      },
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create,
        update: jest.fn(),
      },
    });
    const out = await mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN });
    expect(out).toEqual({ sessionId: 'sess1', isLate: false });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isLate: false, shiftId: 's1' }) }),
    );
  });

  it('checkin phiên đầu ca trễ > grace → isLate=true', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'sess1' });
    const prisma = makePrisma({
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          staffId: 'u1',
          status: 'APPROVED',
          startAt: new Date(Date.now() - 60 * 60000), // ca bắt đầu 60' trước, grace 30' → trễ
          endAt: new Date(Date.now() + 7 * 3600_000),
          approvedStart: null,
          approvedEnd: null,
        }),
      },
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create,
        update: jest.fn(),
      },
    });
    const out = await mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN });
    expect(out.isLate).toBe(true);
  });
});

describe('AttendanceService.checkin — cửa sổ thời gian của ca', () => {
  const shiftAt = (startOffsetMs: number, durationMs = 9 * 3600_000) => ({
    shift: {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        staffId: 'u1',
        status: 'APPROVED',
        startAt: new Date(Date.now() + startOffsetMs),
        endAt: new Date(Date.now() + startOffsetMs + durationMs),
        approvedStart: null,
        approvedEnd: null,
      }),
    },
  });

  /**
   * Trước đây checkin nhận BẤT KỲ ca đã duyệt nào của mình, không xét ngày giờ. NV đang ở công
   * ty lúc 17:05 có thể checkin vào ca 08:00–17:00 NGÀY MAI: phiên mở ra, cron chỉ đóng phiên
   * khi đã quá giờ hết ca nên tới 17:00 hôm sau nó mới đóng — payroll lấy phần giao nhau với
   * cửa sổ ca = 9 giờ công đầy đủ cho một ngày không đi làm phút nào.
   */
  it('ca ngày mai (chưa tới cửa sổ) → BadRequest, không tạo phiên', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      ...shiftAt(24 * 3600_000),
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create, update: jest.fn() },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('tới sớm trong hạn cho phép (30 phút trước giờ vào) → vẫn checkin được', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'sess1' });
    const prisma = makePrisma({
      ...shiftAt(30 * 60000),
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create, update: jest.fn() },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).resolves.toMatchObject({ sessionId: 'sess1' });
  });

  it('ca đã kết thúc → BadRequest (bổ sung phiên là việc của quản lý, không phải mở phiên mới)', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      ...shiftAt(-10 * 3600_000),
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create, update: jest.fn() },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('ca qua đêm: checkin lúc 00:30 của ngày hôm sau vẫn hợp lệ (không chặn theo ngày lịch)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'sess1' });
    const prisma = makePrisma({
      ...shiftAt(-90 * 60000, 3 * 3600_000), // ca bắt đầu 1,5h trước, còn 1,5h nữa mới hết
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create, update: jest.fn() },
    });
    await expect(mk(prisma).checkin('u1', GOOD_IP, { shiftId: 's1', ...IN })).resolves.toMatchObject({ sessionId: 'sess1' });
  });
});

describe('AttendanceService.checkout / heartbeat', () => {
  it('checkout không có phiên mở → BadRequest', async () => {
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });
    await expect(mk(prisma).checkout('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checkout lùi giờ hợp lệ (quá khứ, sau checkin) → dùng giờ đó', async () => {
    const update = jest.fn().mockResolvedValue({});
    const checkinAt = new Date(Date.now() - 4 * 3600 * 1000); // 4h trước
    const at = new Date(Date.now() - 1 * 3600 * 1000); // 1h trước
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'open1', checkinAt }), update },
    });
    await mk(prisma).checkout('u1', at);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checkoutAt: at, closeReason: 'MANUAL' }) }),
    );
  });

  it('checkout lùi giờ tương lai → BadRequest', async () => {
    const checkinAt = new Date(Date.now() - 4 * 3600 * 1000);
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'open1', checkinAt }), update: jest.fn() },
    });
    await expect(mk(prisma).checkout('u1', new Date(Date.now() + 3600 * 1000))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('checkout lùi giờ trước/bằng checkin → BadRequest', async () => {
    const checkinAt = new Date(Date.now() - 2 * 3600 * 1000);
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'open1', checkinAt }), update: jest.fn() },
    });
    await expect(
      mk(prisma).checkout('u1', new Date(checkinAt.getTime() - 60000)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('heartbeat không phiên → {open:false}', async () => {
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    expect(await mk(prisma).heartbeat('u1', GOOD_IP, IN)).toEqual({ open: false });
  });

  it('heartbeat rớt vùng → đóng OUT_OF_RANGE', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'open1' }), update },
    });
    const out = await mk(prisma).heartbeat('u1', '8.8.8.8', IN);
    expect(out).toEqual({ open: false, closed: true, reason: 'IP_NOT_ALLOWED' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closeReason: 'OUT_OF_RANGE' }) }),
    );
  });

  it('heartbeat còn trong vùng → cập nhật lastHeartbeatAt, {open:true}', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'open1' }), update },
    });
    const out = await mk(prisma).heartbeat('u1', GOOD_IP, IN);
    expect(out).toEqual({ open: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastHeartbeatAt: expect.any(Date) }) }),
    );
  });
});

describe('AttendanceService.adminEditSession / adminAddSession', () => {
  it('sửa checkout ≤ checkin → BadRequest', async () => {
    const checkinAt = new Date('2026-07-03T02:00:00Z');
    const prisma = makePrisma({
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', checkinAt, checkoutAt: null, shift: { workDate: new Date('2026-07-03') } }),
        update: jest.fn(),
      },
    });
    await expect(
      mk(prisma).adminEditSession('s1', { checkoutAt: new Date('2026-07-03T01:00:00Z') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sửa hợp lệ → update + trả {staffId, workDate}', async () => {
    const checkinAt = new Date('2026-07-03T02:00:00Z');
    const workDate = new Date('2026-07-03');
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', shiftId: 'sh1', checkinAt, checkoutAt: null, shift: { workDate } }),
        findMany: jest.fn().mockResolvedValue([]),
        update,
      },
    });
    const out = await mk(prisma).adminEditSession('s1', { checkoutAt: new Date('2026-07-03T05:00:00Z') });
    expect(out).toEqual({ staffId: 'u1', workDate });
    expect(update).toHaveBeenCalled();
  });

  it('thêm phiên checkout ≤ checkin → BadRequest', async () => {
    await expect(
      mk(makePrisma()).adminAddSession('sh1', new Date('2026-07-03T05:00:00Z'), new Date('2026-07-03T05:00:00Z')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('thêm phiên hợp lệ → create + trả {staffId, workDate}', async () => {
    const workDate = new Date('2026-07-03');
    const create = jest.fn().mockResolvedValue({ id: 'new1' });
    const prisma = makePrisma({
      shift: { findUnique: jest.fn().mockResolvedValue({ id: 'sh1', staffId: 'u1', workDate }) },
      attendanceSession: { create, findMany: jest.fn().mockResolvedValue([]) },
    });
    const out = await mk(prisma).adminAddSession('sh1', new Date('2026-07-03T01:00:00Z'), new Date('2026-07-03T05:00:00Z'));
    expect(out).toEqual({ staffId: 'u1', workDate });
    expect(create).toHaveBeenCalled();
  });
});

/**
 * sumWorkedMinutes cộng phần giao của TỪNG phiên với cửa sổ ca, nên hai phiên 08:00–17:00 của
 * cùng một ca cho ra 18 giờ công trong một ngày. Quản lý tưởng nhân viên quên chấm rồi thêm tay
 * một phiên nữa là đủ để xảy ra — mà endpoint thêm phiên còn không có UI nên rất dễ lọt.
 */
describe('AttendanceService — không cho phiên chấm công chồng giờ', () => {
  const workDate = new Date('2026-07-03');
  const existing = { checkinAt: new Date('2026-07-03T01:00:00Z'), checkoutAt: new Date('2026-07-03T10:00:00Z') };

  it('thêm phiên trùng giờ với phiên đã có của cùng ca → BadRequest', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      shift: { findUnique: jest.fn().mockResolvedValue({ id: 'sh1', staffId: 'u1', workDate }) },
      attendanceSession: { create, findMany: jest.fn().mockResolvedValue([existing]) },
    });
    await expect(
      mk(prisma).adminAddSession('sh1', new Date('2026-07-03T02:00:00Z'), new Date('2026-07-03T08:00:00Z')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('thêm phiên nối tiếp (không chồng) → cho qua', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'new1' });
    const prisma = makePrisma({
      shift: { findUnique: jest.fn().mockResolvedValue({ id: 'sh1', staffId: 'u1', workDate }) },
      attendanceSession: { create, findMany: jest.fn().mockResolvedValue([existing]) },
    });
    await mk(prisma).adminAddSession('sh1', new Date('2026-07-03T10:00:00Z'), new Date('2026-07-03T12:00:00Z'));
    expect(create).toHaveBeenCalled();
  });

  /**
   * Phiên CHƯA ĐÓNG kết thúc ở "bây giờ", không phải vô hạn: coi là vô hạn sẽ chặn đúng tình
   * huống cần sửa nhất — nhân viên quên checkout, quản lý muốn thêm phiên bù giúp.
   */
  it('phiên chưa đóng (bắt đầu trong quá khứ) → chặn khoảng giờ TRÙNG, kèm thông báo chỉ đúng việc cần làm', async () => {
    const create = jest.fn();
    const openStart = new Date(Date.now() - 4 * 3600_000);
    const prisma = makePrisma({
      shift: { findUnique: jest.fn().mockResolvedValue({ id: 'sh1', staffId: 'u1', workDate }) },
      attendanceSession: { create, findMany: jest.fn().mockResolvedValue([{ checkinAt: openStart, checkoutAt: null }]) },
    });
    await expect(
      mk(prisma).adminAddSession('sh1', new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 3600_000)),
    ).rejects.toThrow(/CHƯA ĐÓNG/);
    expect(create).not.toHaveBeenCalled();
  });

  it('phiên chưa đóng → thêm phiên ở khoảng giờ TƯƠNG LAI vẫn được (không coi là vô hạn)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'new1' });
    const openStart = new Date(Date.now() - 4 * 3600_000);
    const prisma = makePrisma({
      shift: { findUnique: jest.fn().mockResolvedValue({ id: 'sh1', staffId: 'u1', workDate }) },
      attendanceSession: { create, findMany: jest.fn().mockResolvedValue([{ checkinAt: openStart, checkoutAt: null }]) },
    });
    await mk(prisma).adminAddSession('sh1', new Date(Date.now() + 3600_000), new Date(Date.now() + 2 * 3600_000));
    expect(create).toHaveBeenCalled();
  });

  it('sửa phiên: không tự so với CHÍNH NÓ (loại trừ theo id)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', staffId: 'u1', shiftId: 'sh1',
          checkinAt: existing.checkinAt, checkoutAt: existing.checkoutAt,
          shift: { workDate },
        }),
        findMany: jest.fn().mockResolvedValue([]), // đã loại trừ chính nó
        update,
      },
    });
    await mk(prisma).adminEditSession('s1', { checkoutAt: new Date('2026-07-03T11:00:00Z') });
    expect(update).toHaveBeenCalled();
  });
});

describe('AttendanceService.sessionOwner / shiftOwner', () => {
  it('trả {staffId, workDate} để controller kiểm khoá tháng TRƯỚC khi ghi', async () => {
    const workDate = new Date('2026-07-03');
    const prisma = makePrisma({
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({ staffId: 'u1', shift: { workDate } }),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      shift: { findUnique: jest.fn().mockResolvedValue({ staffId: 'u2', workDate }), findMany: jest.fn(), findFirst: jest.fn() },
    });

    await expect(mk(prisma).sessionOwner('s1')).resolves.toEqual({ staffId: 'u1', workDate });
    await expect(mk(prisma).shiftOwner('sh1')).resolves.toEqual({ staffId: 'u2', workDate });
  });

  it('không tìm thấy → NotFound (không để controller đọc undefined)', async () => {
    const prisma = makePrisma({
      attendanceSession: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      shift: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn(), findFirst: jest.fn() },
    });
    await expect(mk(prisma).sessionOwner('sX')).rejects.toBeInstanceOf(NotFoundException);
    await expect(mk(prisma).shiftOwner('shX')).rejects.toBeInstanceOf(NotFoundException);
  });
});
