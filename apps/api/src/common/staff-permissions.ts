import { SetMetadata } from '@nestjs/common';

/**
 * Nhóm việc của STAFF (ADMINOPS-10). STAFF không có nhóm nào chỉ dùng quầy thu ngân, đổi vỏ và chấm công như trước.
 *  - CSKH: xem đơn, đổi trạng thái đơn (chỉ huỷ theo yêu cầu khách), duyệt đổi/trả, xem người dùng, mẫu tin nhanh.
 *  - KHO: xem đơn, đổi trạng thái đơn (chỉ đánh dấu đã đóng gói), đẩy lại Pancake, xử lý vận đơn thu gom, nhận hàng trả về.
 * Không nhóm nào được đụng cấu hình, phân quyền, lương, duyệt rút tiền, hoàn tiền chuyển khoản hay xuất dữ liệu.
 */
export const STAFF_PERMISSIONS = ['CSKH', 'KHO'] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const STAFF_PERMISSIONS_KEY = 'staffPermissions';

/** STAFF có một trong các nhóm này cũng vào được route (kể cả route @Roles('ADMIN')). ADMIN luôn vào được. */
export const AllowStaff = (...perms: StaffPermission[]) => SetMetadata(STAFF_PERMISSIONS_KEY, perms);

export function isStaffPermission(v: unknown): v is StaffPermission {
  return typeof v === 'string' && (STAFF_PERMISSIONS as readonly string[]).includes(v);
}
