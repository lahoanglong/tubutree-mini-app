import type { AdminPayrollRow, PayrollStatus } from '@tubutree/app-core/api/payroll';

/** Ký tự mở đầu khiến Excel/Google Sheets coi ô là CÔNG THỨC. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Tên nhân viên do chính họ nhập: không vô hiệu hoá công thức thì file lương mở trên máy quản trị sẽ chạy công thức đó. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** SĐT toàn số ghi thành văn bản ="09..." để Excel không bỏ số 0 đầu. */
const csvPhone = (p: string | null) => (p && /^\+?\d+$/.test(p) ? `"=""${p}"""` : csvField(p));

const STATUS: Record<PayrollStatus, string> = { OPEN: 'Đang tính', FINALIZED: 'Đã chốt', PAID: 'Đã trả' };
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

const HEADERS = ['Nhân viên', 'Số điện thoại', 'Tháng', 'Tổng giờ', 'Đơn giá (VNĐ/giờ)', 'Lương gộp (VNĐ)', 'Tiền phạt (VNĐ)', 'Thực nhận (VNĐ)', 'Trạng thái'];

export function payrollCsv(rows: AdminPayrollRow[]): string {
  const lines = rows.map((r) =>
    [
      csvField(r.staff.fullName ?? r.staff.phone ?? 'NV'),
      csvPhone(r.staff.phone),
      `${r.month.month}/${r.month.year}`,
      hm(r.month.totalMinutes),
      csvField(r.profile?.hourlyRate ?? 0),
      csvField(r.month.gross),
      csvField(r.month.totalFines),
      csvField(r.month.net),
      STATUS[r.month.status],
    ].join(','),
  );
  return [HEADERS.join(','), ...lines].join('\r\n');
}
