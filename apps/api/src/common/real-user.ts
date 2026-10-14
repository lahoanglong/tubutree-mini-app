import { Prisma } from '@prisma/client';

/**
 * "User thật" (Q-05): có zaloId Zalo thật hoặc SĐT. Khách đăng nhập theo deviceId mang zaloId
 * `guest_<deviceId>` (cả dòng guest đã gộp `guest_..._merged_...`) — tạo vô hạn chỉ bằng deviceId
 * mới nên không được nhận hay được đếm vào quyền lợi khuyến mãi (voucher chào mừng, mã công khai,
 * mua chung, nhiệm vụ mời bạn). SĐT chỉ được ghi từ phoneToken Zalo (auth.service) nên có SĐT = đã
 * xác thực, kể cả khi dòng vẫn mang zaloId guest.
 */
export const REAL_USER_WHERE: Prisma.UserWhereInput = {
  OR: [
    { phone: { not: null } },
    { AND: [{ zaloId: { not: null } }, { NOT: { zaloId: { startsWith: 'guest_' } } }] },
  ],
};

/** Bản SQL của REAL_USER_WHERE, bảng users phải có alias `u`. `left()` thay LIKE vì `_` là ký tự đại diện. */
export const REAL_USER_SQL = Prisma.sql`(u.phone IS NOT NULL OR (u."zaloId" IS NOT NULL AND left(u."zaloId", 6) <> 'guest_'))`;

export function isRealUser(u: { phone?: string | null; zaloId?: string | null } | null | undefined): boolean {
  if (!u) return false;
  if (u.phone) return true;
  return !!u.zaloId && !u.zaloId.startsWith('guest_');
}

export const REAL_USER_REQUIRED_MSG =
  'Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Vui lòng đăng nhập bằng Zalo rồi thử lại.';
