import { SetMetadata } from '@nestjs/common';

/**
 * Nhóm việc của STAFF (ADMINOPS-10, D1-05). STAFF không có nhóm nào chỉ dùng quầy thu ngân, đổi vỏ và chấm công như trước.
 *  - CSKH: xem đơn, đổi trạng thái đơn (chỉ huỷ theo yêu cầu khách), duyệt đổi/trả, xem người dùng, mẫu tin nhanh, kiểm duyệt cộng đồng.
 *  - KHO: xem đơn, đổi trạng thái đơn (chỉ đánh dấu đã đóng gói), đẩy lại Pancake, xử lý vận đơn thu gom, nhận hàng trả về.
 *  - MARKETING: voucher, flash sale, FAQ, Content Kit, Academy, mẫu thông báo, kiểm duyệt cộng đồng, báo cáo nguồn khách.
 *  - KE_TOAN: xem đơn (SĐT che) + "Đã nhận tiền" + hoá đơn VAT, công nợ và thưởng đại lý (chi thưởng ĐÃ được ADMIN duyệt), duyệt hoàn tiền sàn ngoài,
 *    hoàn tiền khách, chi lệnh rút tiền ĐÃ được ADMIN duyệt, đối soát gian hàng đối tác, báo cáo doanh thu, CSV tài chính. Không đổi trạng thái đơn.
 * Không nhóm nào được đụng cấu hình, phân quyền, khoá tài khoản, % hoa hồng/giá sỉ, lương, duyệt rút tiền hay xuất người dùng.
 * Bảng route → nhóm đầy đủ nằm ở staff-permissions.matrix.spec.ts.
 */
export const STAFF_PERMISSIONS = ['CSKH', 'KHO', 'MARKETING', 'KE_TOAN'] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/** Kiểm duyệt cộng đồng hằng ngày: route kiểm duyệt và quyền xem ảnh bài chưa đăng dùng chung danh sách này. */
export const COMMUNITY_MODERATORS: readonly StaffPermission[] = ['CSKH', 'MARKETING'];

export const STAFF_PERMISSIONS_KEY = 'staffPermissions';

/** STAFF có một trong các nhóm này cũng vào được route (kể cả route @Roles('ADMIN')). ADMIN luôn vào được. */
export const AllowStaff = (...perms: StaffPermission[]) => SetMetadata(STAFF_PERMISSIONS_KEY, perms);

export function isStaffPermission(v: unknown): v is StaffPermission {
  return typeof v === 'string' && (STAFF_PERMISSIONS as readonly string[]).includes(v);
}
