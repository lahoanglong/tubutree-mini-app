import type { PayrollStatus } from './api/payroll';

/** Lời hỏi xác nhận mở lại bảng lương. Tháng đã trả thì máy chủ xoá dấu đã trả và ảnh chứng từ, nên phải nói trước ở mọi nền. */
export function payrollReopenMessage(month: number, year: number, name: string, status: PayrollStatus): string {
  return (
    `Mở lại bảng lương T${month}/${year} của ${name}? Cần chốt lại sau khi sửa.` +
    (status === 'PAID' ? ' Mở lại sẽ xoá dấu đã trả và ảnh chứng từ chuyển khoản của tháng này.' : '')
  );
}
