'use client';

import { StaffGate } from '@/components/staff/staff-shell';
import { StaffHub } from '@/components/staff/staff-hub';

/**
 * `/nhan-vien` theo `staff.tsx` của Mini App: chỉ STAFF/ADMIN, lịch ca theo tuần (thêm, sửa, xoá, đăng ký nhanh, copy tuần,
 * huỷ ca có phạt). Chấm công không làm được trên web (cần token vị trí Zalo) nên thẻ hôm nay chỉ hiện trạng thái.
 */
export default function StaffPage() {
  return (
    <StaffGate
      title="Ca làm của tôi"
      loginMessage="Đăng nhập để xem ca làm của bạn."
      returnTo="/nhan-vien"
    >
      <StaffHub />
    </StaffGate>
  );
}
