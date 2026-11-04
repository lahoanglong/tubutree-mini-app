import { BadRequestException } from '@nestjs/common';
import { searchPhone } from './admin-order-filter';

/** CSKH chỉ tra từng khách một: tối đa 5 trang × 20 dòng cho mỗi lượt tìm, không đủ để lật cả danh sách. */
export const STAFF_USER_LIST_MAX_PAGE = 5;
export const STAFF_USER_LIST_MAX_LIMIT = 20;
export const STAFF_USER_SEARCH_MIN_NAME = 3;

const PHONE_LIKE = /^\+?[\d\s.\-()]+$/;

export const STAFF_USER_SEARCH_REQUIRED =
  'Nhập số điện thoại đủ 10 số, mã khách hàng, hoặc ít nhất 3 ký tự của tên để tìm khách.';

/**
 * Quy tắc cho tài khoản CSKH trên danh sách người dùng: bắt buộc có từ khoá tìm (SĐT đủ 10 số, id, hoặc tên từ 3 ký tự), trang ≤ 5, mỗi trang ≤ 20.
 * Danh sách đầy đủ kèm SĐT và số dư tương đương bản xuất người dùng mà chỉ ADMIN có.
 */
export function assertStaffUserListQuery(q: { search?: string; page: number; limit: number }): void {
  const s = q.search?.trim() ?? '';
  if (!s) throw new BadRequestException(STAFF_USER_SEARCH_REQUIRED);
  if (PHONE_LIKE.test(s)) {
    const phone = searchPhone(s);
    if (!phone || !/^0\d{9}$/.test(phone)) {
      throw new BadRequestException('Số điện thoại cần đủ 10 số để tìm khách. Gõ thiếu số thì không tìm được.');
    }
  } else if ([...s].length < STAFF_USER_SEARCH_MIN_NAME) {
    throw new BadRequestException(STAFF_USER_SEARCH_REQUIRED);
  }
  if (q.page > STAFF_USER_LIST_MAX_PAGE) {
    throw new BadRequestException(`Chỉ xem tối đa ${STAFF_USER_LIST_MAX_PAGE} trang kết quả. Gõ cụ thể hơn để thu hẹp.`);
  }
  if (q.limit > STAFF_USER_LIST_MAX_LIMIT) {
    throw new BadRequestException(`Mỗi trang tối đa ${STAFF_USER_LIST_MAX_LIMIT} khách.`);
  }
}
