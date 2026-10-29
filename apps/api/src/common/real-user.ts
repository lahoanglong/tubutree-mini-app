import { Prisma } from '@prisma/client';

/**
 * "User thật" (Q-05): có zaloId Zalo thật hoặc SĐT. Khách đăng nhập theo deviceId mang zaloId
 * `guest_<deviceId>` (cả dòng guest đã gộp `guest_..._merged_...`) — tạo vô hạn chỉ bằng deviceId
 * mới nên không được nhận hay được đếm vào quyền lợi khuyến mãi (voucher chào mừng, mã công khai,
 * mua chung, nhiệm vụ mời bạn, Điểm Xanh từ điểm danh, nhiệm vụ và chặng mùa). SĐT chỉ được ghi từ phoneToken Zalo (auth.service) nên có SĐT = đã
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

/** Câu báo khi khách vãng lai làm việc có thưởng Điểm Xanh: điểm chỉ dành cho tài khoản đã đăng nhập Zalo. */
export const GUEST_POINTS_MSG = 'Đăng nhập Zalo để nhận Điểm Xanh';

/** Lý do không cộng Điểm Xanh cho `u`: 'GUEST' = chưa là user thật (xem REAL_USER_WHERE); undefined = được nhận. */
export function pointsBlockedFor(u: { phone?: string | null; zaloId?: string | null } | null | undefined): 'GUEST' | undefined {
  return isRealUser(u) ? undefined : 'GUEST';
}
