import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AdminShiftsController } from './admin-shifts.controller';
import { PAYROLL_MONTH_LOCKED_MSG } from './payroll/payroll.service';

const OCT = new Date('2026-10-05T00:00:00Z');
const OCT_LATE = new Date('2026-10-28T00:00:00Z');
const SEP = new Date('2026-09-30T00:00:00Z');

function setup(owners: { id: string; staffId: string; workDate: Date }[], lockedMonths: string[] = []) {
  const tx = { shift: { tag: 'tx' } };
  const shifts = {
    owners: jest.fn().mockResolvedValue(owners),
    approve: jest.fn().mockResolvedValue({ approved: true }),
    bulkApprove: jest.fn().mockImplementation(async (_a: string, ids: string[]) => ({ approved: ids.length })),
  };
  const payroll = {
    writeInMonth: jest.fn().mockImplementation(async (staffId: string, workDate: Date, write: (t: unknown) => unknown) => {
      if (lockedMonths.includes(`${staffId}:${workDate.getUTCMonth() + 1}`)) throw new BadRequestException(PAYROLL_MONTH_LOCKED_MSG);
      return write(tx);
    }),
  };
  return { ctrl: new AdminShiftsController(shifts as never, payroll as never), shifts, payroll, tx };
}

describe('AdminShiftsController — duyệt ca là đầu vào của lương, đi qua khoá tháng', () => {
  it('duyệt một ca: ghi bằng tx của khoá tháng (staff, ngày của ca), không tính lại ngày', async () => {
    const { ctrl, shifts, payroll, tx } = setup([{ id: 's1', staffId: 'u1', workDate: OCT }]);
    await expect(ctrl.approve('a1', 's1', {} as never)).resolves.toEqual({ approved: true });
    expect(payroll.writeInMonth).toHaveBeenCalledWith('u1', OCT, expect.any(Function), undefined, { recompute: false });
    expect(shifts.approve).toHaveBeenCalledWith('a1', 's1', { approvedStart: undefined, approvedEnd: undefined }, tx);
  });

  it('tháng đã chốt/đã trả → 400 và không duyệt', async () => {
    const { ctrl, shifts } = setup([{ id: 's1', staffId: 'u1', workDate: OCT }], ['u1:10']);
    await expect(ctrl.approve('a1', 's1', {} as never)).rejects.toThrow('đã chốt/đã trả');
    expect(shifts.approve).not.toHaveBeenCalled();
  });

  it('ca không tồn tại: giữ nguyên đường cũ của service (400 "không ở trạng thái chờ duyệt")', async () => {
    const { ctrl, shifts, payroll } = setup([]);
    await ctrl.approve('a1', 'nope', {} as never);
    expect(payroll.writeInMonth).not.toHaveBeenCalled();
    expect(shifts.approve).toHaveBeenCalledWith('a1', 'nope', { approvedStart: undefined, approvedEnd: undefined });
  });

  it('duyệt hàng loạt: gom theo (nhân viên, tháng), tháng đã chốt bị bỏ qua và báo số ca bỏ qua, các ca còn lại vẫn duyệt', async () => {
    const { ctrl, shifts, payroll } = setup(
      [
        { id: 's1', staffId: 'u1', workDate: OCT },
        { id: 's2', staffId: 'u1', workDate: OCT_LATE },
        { id: 's3', staffId: 'u1', workDate: SEP },
        { id: 's4', staffId: 'u2', workDate: OCT },
      ],
      ['u1:9'],
    );
    await expect(ctrl.bulkApprove('a1', { ids: ['s1', 's2', 's3', 's4'] } as never)).resolves.toEqual({ approved: 3, skipped: 1 });
    expect(payroll.writeInMonth).toHaveBeenCalledTimes(3);
    expect(shifts.bulkApprove.mock.calls.map((c: unknown[]) => c[1])).toEqual([['s1', 's2'], ['s4']]);
  });

  it('lỗi khác "tháng đã chốt" không bị nuốt', async () => {
    const { ctrl, payroll } = setup([{ id: 's1', staffId: 'u1', workDate: OCT }]);
    payroll.writeInMonth.mockRejectedValueOnce(new Error('db down'));
    await expect(ctrl.bulkApprove('a1', { ids: ['s1'] } as never)).rejects.toThrow('db down');
  });
});
