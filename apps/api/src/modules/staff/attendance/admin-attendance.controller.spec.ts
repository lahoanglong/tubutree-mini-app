import { BadRequestException } from '@nestjs/common';
import { AdminAttendanceController } from './admin-attendance.controller';
import { AttendanceService } from './attendance.service';
import type { PayrollService } from '../payroll/payroll.service';

/**
 * ADMINOPS-17: nút "Chốt ra ca" trên web admin — đóng phiên đang mở phải theo khoá tháng lương và tính lại công ngày đó.
 * Kiểm khoá tháng, ghi phiên, tính lại chạy trong MỘT khoá tháng (PayrollService.writeInMonth) nên mock ở đây chạy lại
 * đúng thứ tự đó với một tx giả.
 */
describe('AdminAttendanceController.manualCheckout', () => {
  const workDate = new Date('2026-10-14T00:00:00.000Z');

  function setup(opts: { locked?: boolean; closed?: number } = {}) {
    const calls: string[] = [];
    const sessionDb = {
      findUnique: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', checkoutAt: null, shift: { workDate } }),
      updateMany: jest.fn().mockImplementation(async () => {
        calls.push('close');
        return { count: opts.closed ?? 1 };
      }),
    };
    const tx = { attendanceSession: sessionDb };
    const prisma = { attendanceSession: sessionDb };
    const attendance = new AttendanceService(prisma as never, {} as never);
    const payroll = {
      writeInMonth: jest.fn().mockImplementation(async (_staffId: string, _workDate: Date, write: (t: unknown) => Promise<unknown>) => {
        calls.push('lock-check');
        if (opts.locked) throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.');
        const out = await write(tx);
        calls.push('recompute');
        return out;
      }),
    };
    return { ctrl: new AdminAttendanceController(attendance, payroll as unknown as PayrollService), sessionDb, payroll, calls, tx };
  }

  it('kiểm khoá tháng trước, đóng phiên chỉ khi còn mở, rồi tính lại lương ngày đó', async () => {
    const { ctrl, sessionDb, payroll, calls } = setup();
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).resolves.toEqual({ checkedOut: true });
    expect(calls).toEqual(['lock-check', 'close', 'recompute']);
    expect(sessionDb.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', checkoutAt: null },
      data: { checkoutAt: expect.any(Date), closeReason: 'ADMIN' },
    });
    expect(payroll.writeInMonth).toHaveBeenCalledWith('u1', workDate, expect.any(Function));
  });

  it('tháng đã chốt → 400, không đóng phiên', async () => {
    const { ctrl, calls } = setup({ locked: true });
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual(['lock-check']);
  });

  it('nhân viên vừa tự ra ca cùng lúc → 400 "Phiên đã đóng", không tính lại', async () => {
    const { ctrl, calls } = setup({ closed: 0 });
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).rejects.toThrow('Phiên đã đóng');
    expect(calls).not.toContain('recompute');
  });
});

describe('AdminAttendanceController.editSession / addSession', () => {
  const workDate = new Date('2026-10-14T00:00:00.000Z');

  function setup() {
    const tx = { marker: 'tx' };
    const attendance = {
      sessionOwner: jest.fn().mockResolvedValue({ staffId: 'u1', workDate }),
      shiftOwner: jest.fn().mockResolvedValue({ staffId: 'u1', workDate }),
      adminEditSession: jest.fn().mockResolvedValue({ staffId: 'u1', workDate }),
      adminAddSession: jest.fn().mockResolvedValue({ staffId: 'u1', workDate }),
    };
    const payroll = {
      writeInMonth: jest.fn().mockImplementation(async (_s: string, _d: Date, write: (t: unknown) => Promise<unknown>) => write(tx)),
    };
    return { ctrl: new AdminAttendanceController(attendance as never, payroll as unknown as PayrollService), attendance, payroll, tx };
  }

  it('sửa giờ phiên: ghi bằng tx của khoá tháng (không bằng prisma ngoài khoá)', async () => {
    const { ctrl, attendance, payroll, tx } = setup();
    await expect(ctrl.editSession('s1', { checkoutAt: '2026-10-14T05:00:00.000Z' })).resolves.toEqual({ updated: true });
    expect(payroll.writeInMonth).toHaveBeenCalledWith('u1', workDate, expect.any(Function));
    expect(attendance.adminEditSession).toHaveBeenCalledWith(
      's1',
      { checkinAt: undefined, checkoutAt: new Date('2026-10-14T05:00:00.000Z') },
      tx,
    );
  });

  it('thêm phiên: ghi bằng tx của khoá tháng', async () => {
    const { ctrl, attendance, tx } = setup();
    await expect(
      ctrl.addSession({ shiftId: 'sh1', checkinAt: '2026-10-14T01:00:00.000Z', checkoutAt: '2026-10-14T05:00:00.000Z' }),
    ).resolves.toEqual({ added: true });
    expect(attendance.adminAddSession).toHaveBeenCalledWith(
      'sh1',
      new Date('2026-10-14T01:00:00.000Z'),
      new Date('2026-10-14T05:00:00.000Z'),
      tx,
    );
  });
});
