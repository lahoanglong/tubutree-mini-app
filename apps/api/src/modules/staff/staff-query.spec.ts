import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminShiftsController } from './admin-shifts.controller';
import { StaffController } from './staff.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { AdminPayrollController } from './payroll/admin-payroll.controller';
import { PayrollController } from './payroll/payroll.controller';
import { AdminShiftsQuery, DateRangeQuery, RecomputePayrollQuery, YearMonthQuery } from './dto/staff-query.dto';
import { isSaneDate, parseDateRange, parseYearMonth } from './date-range';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });

const BAD_DATES = ['+275760-09-13T00:00:00Z', '-271821-04-20T00:00:00Z', '0001-01-01', '10000-01-01', 'abc'];

describe('DTO query nhân sự/lương (ValidationPipe như main.ts)', () => {
  it('giá trị client đang gửi vẫn nhận', async () => {
    const range = { from: '2026-10-05T17:00:00.000Z', to: '2026-10-12T16:59:59.999Z' };
    await expect(as(DateRangeQuery, range)).resolves.toMatchObject(range);
    await expect(as(AdminShiftsQuery, { ...range, staffId: 'ck1' })).resolves.toMatchObject({ staffId: 'ck1' });
    await expect(as(AdminShiftsQuery, range)).resolves.toMatchObject(range);
    await expect(as(YearMonthQuery, { year: '2026', month: '10' })).resolves.toMatchObject({ year: '2026', month: '10' });
    await expect(as(RecomputePayrollQuery, { year: '2026', month: '10', reprice: '1' })).resolves.toMatchObject({ reprice: '1' });
    await expect(as(YearMonthQuery, {})).resolves.toEqual({});
  });

  it('mảng/object ở từ/đến/staffId/year/month/reprice → 400', async () => {
    for (const bad of [['a', 'b'], { a: 'b' }]) {
      await expect(as(DateRangeQuery, { from: bad })).rejects.toThrow();
      await expect(as(AdminShiftsQuery, { staffId: bad })).rejects.toThrow();
      await expect(as(YearMonthQuery, { year: bad })).rejects.toThrow();
      await expect(as(RecomputePayrollQuery, { reprice: bad })).rejects.toThrow();
    }
  });

  it('query lạ vẫn bị 400', async () => {
    await expect(as(YearMonthQuery, { foo: '1' })).rejects.toThrow();
  });
});

describe('khoảng ngày/kỳ lương nằm ngoài khoảng Prisma/Postgres xử lý được → 400', () => {
  it('isSaneDate', () => {
    expect(isSaneDate(new Date('2026-10-12T00:00:00Z'))).toBe(true);
    for (const d of BAD_DATES) expect(isSaneDate(new Date(d))).toBe(false);
  });

  it('parseDateRange giữ thông điệp cũ', () => {
    expect(() => parseDateRange(undefined, '2026-01-01')).toThrow('Thiếu khoảng thời gian (from/to).');
    expect(() => parseDateRange('abc', '2026-01-01')).toThrow('from/to không hợp lệ.');
    expect(() => parseDateRange('+275760-09-13T00:00:00Z', '2026-01-01')).toThrow(BadRequestException);
    expect(parseDateRange('2026-01-01', '2026-02-01').f.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('parseYearMonth', () => {
    expect(parseYearMonth('2026', '10')).toEqual({ y: 2026, m: 10 });
    for (const [y, m] of [['99999', '1'], ['-5', '1'], ['2147483648', '1'], ['1999', '1'], ['2026', '13'], ['2026', '0'], ['x', '1'], [undefined, undefined]] as const) {
      expect(() => parseYearMonth(y, m)).toThrow(BadRequestException);
    }
  });
});

describe('controller nhân sự/lương không chuyển ngày/kỳ cực đoan xuống service', () => {
  const shifts = { listShifts: jest.fn(), listAll: jest.fn() };
  const attendance = { history: jest.fn() };
  const payroll = { getMyPayroll: jest.fn(), adminMonth: jest.fn(), recomputeStaffMonth: jest.fn(), reopen: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it.each(BAD_DATES)('from=%s → BadRequest ở 3 endpoint lịch ca/chấm công', (bad) => {
    const q = { from: bad, to: '2026-01-01' };
    expect(() => new StaffController(shifts as never).listShifts('s', q)).toThrow(BadRequestException);
    expect(() => new AdminShiftsController(shifts as never).listAll(q)).toThrow(BadRequestException);
    expect(() => new AttendanceController(attendance as never, {} as never).history('s', q)).toThrow(BadRequestException);
    expect(shifts.listShifts).not.toHaveBeenCalled();
    expect(shifts.listAll).not.toHaveBeenCalled();
    expect(attendance.history).not.toHaveBeenCalled();
  });

  it('endpoint lịch ca vẫn gọi service với ngày hợp lệ', () => {
    new StaffController(shifts as never).listShifts('s', { from: '2026-01-01', to: '2026-01-08' });
    expect(shifts.listShifts).toHaveBeenCalledTimes(1);
    new AdminShiftsController(shifts as never).listAll({ from: '2026-01-01', to: '2026-01-08', staffId: 'st1' });
    expect(shifts.listAll).toHaveBeenCalledWith(new Date('2026-01-01'), new Date('2026-01-08'), 'st1');
  });

  it('endpoint lương: year cực đoan → BadRequest, hợp lệ vẫn chạy', () => {
    const admin = new AdminPayrollController(payroll as never, attendance as never);
    expect(() => admin.month({ year: '99999', month: '1' })).toThrow(BadRequestException);
    expect(() => admin.recompute('s', { year: '2147483648', month: '1' })).toThrow(BadRequestException);
    expect(() => admin.reopen('a', 's', { year: '-5', month: '1' })).toThrow(BadRequestException);
    expect(() => new PayrollController(payroll as never).myPayroll('s', { year: '99999', month: '1' })).toThrow(BadRequestException);
    expect(payroll.adminMonth).not.toHaveBeenCalled();
    admin.month({ year: '2026', month: '10' });
    expect(payroll.adminMonth).toHaveBeenCalledWith(2026, 10);
    admin.recompute('s', { year: '2026', month: '10', reprice: 'true' });
    expect(payroll.recomputeStaffMonth).toHaveBeenCalledWith('s', 2026, 10, { reprice: true });
  });

  // reprice định giá lại cả công đã làm xong (xem chú thích ở recompute): mặc định phải tắt, và chỉ '1'/'true' mới bật.
  it('recompute: không có reprice → tắt; chỉ "1" và "true" mới bật', () => {
    const admin = new AdminPayrollController(payroll as never, attendance as never);
    admin.recompute('s', { year: '2026', month: '10' });
    expect(payroll.recomputeStaffMonth).toHaveBeenLastCalledWith('s', 2026, 10, { reprice: false });
    for (const off of ['', '0', 'false', 'yes', 'TRUE']) {
      admin.recompute('s', { year: '2026', month: '10', reprice: off });
      expect(payroll.recomputeStaffMonth).toHaveBeenLastCalledWith('s', 2026, 10, { reprice: false });
    }
    admin.recompute('s', { year: '2026', month: '10', reprice: '1' });
    expect(payroll.recomputeStaffMonth).toHaveBeenLastCalledWith('s', 2026, 10, { reprice: true });
  });

  it('các controller khai báo query bằng DTO (để ValidationPipe chặn mảng/object)', () => {
    const t = (c: { prototype: object }, m: string) => Reflect.getMetadata('design:paramtypes', c.prototype, m) as unknown[];
    expect(t(StaffController, 'listShifts')).toContain(DateRangeQuery);
    expect(t(AttendanceController, 'history')).toContain(DateRangeQuery);
    expect(t(AdminShiftsController, 'listAll')).toContain(AdminShiftsQuery);
    expect(t(PayrollController, 'myPayroll')).toContain(YearMonthQuery);
    for (const m of ['month', 'detail', 'reopen']) expect(t(AdminPayrollController, m)).toContain(YearMonthQuery);
    expect(t(AdminPayrollController, 'recompute')).toContain(RecomputePayrollQuery);
  });
});
