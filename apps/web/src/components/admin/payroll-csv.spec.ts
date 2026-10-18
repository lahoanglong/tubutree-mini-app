import { describe, expect, it } from 'vitest';
import type { AdminPayrollRow } from '@tubutree/app-core/api/payroll';
import { csvField, payrollCsv } from './payroll-csv';

const row = (over: Partial<AdminPayrollRow['staff']> = {}, month: Partial<AdminPayrollRow['month']> = {}): AdminPayrollRow => ({
  staff: { id: 's1', fullName: 'Nguyễn An', phone: '0912345678', ...over },
  month: { year: 2026, month: 10, totalMinutes: 125, gross: 500_000, totalFines: 20_000, net: 480_000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null, ...month },
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: null, bankAccountName: null, qrImageUrl: null, active: true },
  qrImageUrl: null,
});

describe('csvField', () => {
  it('bọc ngoặc kép khi có dấu phẩy, ngoặc kép hoặc xuống dòng', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('có "trích"')).toBe('"có ""trích"""');
    expect(csvField('dòng1\ndòng2')).toBe('"dòng1\ndòng2"');
    expect(csvField('thường')).toBe('thường');
  });

  it('vô hiệu hoá công thức Excel trong tên do người dùng tự nhập', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@a')).toBe("'@a");
  });

  it('null/undefined là ô rỗng, số giữ nguyên', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(480000)).toBe('480000');
  });
});

describe('payrollCsv', () => {
  it('một dòng tiêu đề và một dòng mỗi nhân viên, SĐT giữ số 0 đầu, thực nhận là số nguyên đồng', () => {
    const csv = payrollCsv([row()]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Nhân viên,Số điện thoại,Tháng,Tổng giờ,Đơn giá (VNĐ/giờ),Lương gộp (VNĐ),Tiền phạt (VNĐ),Thực nhận (VNĐ),Trạng thái');
    expect(lines[1]).toBe('Nguyễn An,"=""0912345678""",10/2026,2h05,40000,500000,20000,480000,Đã chốt');
  });

  it('thiếu tên thì dùng SĐT, thiếu hồ sơ thì đơn giá 0', () => {
    const r = row({ fullName: null });
    r.profile = null;
    expect(payrollCsv([r]).split('\r\n')[1]).toBe('0912345678,"=""0912345678""",10/2026,2h05,0,500000,20000,480000,Đã chốt');
  });
});
