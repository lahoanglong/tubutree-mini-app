'use client';

import { StaffGate } from '@/components/staff/staff-shell';
import { PayrollHub } from '@/components/staff/payroll-hub';

/**
 * `/nhan-vien/bang-luong` theo `my-payroll.tsx` của Mini App: chỉ STAFF/ADMIN, chọn tháng, ngày công và trạng thái, ảnh chứng
 * từ khi đã trả, lịch sử phiên chấm công trong tháng và tài khoản nhận lương (PUT /staff/bank).
 */
export default function MyPayrollPage() {
  return (
    <StaffGate
      title="Lương của tôi"
      loginMessage="Đăng nhập để xem lương của bạn."
      deniedMessage="Trang dành cho nhân viên."
      returnTo="/nhan-vien/bang-luong"
    >
      <PayrollHub />
    </StaffGate>
  );
}
