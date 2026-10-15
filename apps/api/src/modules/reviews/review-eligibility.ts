import type { Prisma } from '@prisma/client';

/**
 * Đơn được tính là một lần mua để viết đánh giá: đơn đã nhận, mua lẻ cho chính mình. Đơn CTV lên hộ mang userId của CTV
 * và đơn đại lý là hàng buôn: người đặt không phải người dùng sản phẩm, và mỗi đơn như thế mà được một đánh giá thì một
 * tài khoản đặt hộ/đặt buôn nhiều lần đổ được hàng loạt đánh giá "Đã mua" cho một sản phẩm. Cùng định nghĩa với tin mời
 * đánh giá (ReviewInviteService) và nhiệm vụ đơn đã giao.
 */
export const REVIEWABLE_ORDER = {
  status: 'DELIVERED',
  type: 'RETAIL',
  placedForCustomer: false,
} as const satisfies Prisma.OrderWhereInput;

/**
 * Khoá advisory theo cặp (khách, sản phẩm) cho mọi lượt ghi sổ điểm đánh giá của cặp đó. Đánh giá cho hai đơn khác nhau
 * không đụng nhau ở khoá unique nên hai lượt tạo song song đều đọc sổ trống và cùng thưởng nếu không có khoá này.
 */
export const reviewRewardLockKey = (userId: string, productId: string): string => `review-reward:${userId}:${productId}`;
