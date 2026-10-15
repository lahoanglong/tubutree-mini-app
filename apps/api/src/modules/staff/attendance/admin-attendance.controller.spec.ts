import { BadRequestException } from '@nestjs/common';
import { AdminAttendanceController } from './admin-attendance.controller';
import { AttendanceService } from './attendance.service';
import type { PayrollService } from '../payroll/payroll.service';

/** ADMINOPS-17: nút "Chốt ra ca" trên web admin — đóng phiên đang mở phải theo khoá tháng lương và tính lại công ngày đó. */
describe('AdminAttendanceController.manualCheckout', () => {
  const workDate = new Date('2026-10-14T00:00:00.000Z');

  function setup(opts: { locked?: boolean; closed?: number } = {}) {
    const calls: string[] = [];
    const prisma = {
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', staffId: 'u1', checkoutAt: null, shift: { workDate } }),
        updateMany: jest.fn().mockImplementation(async () => {
          calls.push('close');
          return { count: opts.closed ?? 1 };
        }),
      },
    };
    const attendance = new AttendanceService(prisma as never, {} as never);
    const payroll = {
      assertMonthEditable: jest.fn().mockImplementation(async () => {
        calls.push('lock-check');
        if (opts.locked) throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.');
      }),
      recomputeDay: jest.fn().mockImplementation(async () => {
        calls.push('recompute');
      }),
    };
    return { ctrl: new AdminAttendanceController(attendance, payroll as unknown as PayrollService), prisma, payroll, calls };
  }

  it('kiểm khoá tháng trước, đóng phiên chỉ khi còn mở, rồi tính lại lương ngày đó', async () => {
    const { ctrl, prisma, payroll, calls } = setup();
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).resolves.toEqual({ checkedOut: true });
    expect(calls).toEqual(['lock-check', 'close', 'recompute']);
    expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', checkoutAt: null },
      data: { checkoutAt: expect.any(Date), closeReason: 'ADMIN' },
    });
    expect(payroll.recomputeDay).toHaveBeenCalledWith('u1', workDate);
  });

  it('tháng đã chốt → 400, không đóng phiên', async () => {
    const { ctrl, calls } = setup({ locked: true });
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual(['lock-check']);
  });

  it('nhân viên vừa tự ra ca cùng lúc → 400 "Phiên đã đóng", không tính lại', async () => {
    const { ctrl, payroll } = setup({ closed: 0 });
    await expect(ctrl.manualCheckout({ sessionId: 's1' })).rejects.toThrow('Phiên đã đóng');
    expect(payroll.recomputeDay).not.toHaveBeenCalled();
  });
});
