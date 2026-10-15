import type { Prisma, PrismaClient } from '@prisma/client';

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

/** Trạng thái đánh giá của một dòng ở màn chi tiết đơn: đánh giá khách đã viết cho lần mua này, hoặc còn viết được không. */
export interface OrderLineReview {
  reviewId: string | null;
  reviewable: boolean;
}

const NO_REVIEW: OrderLineReview = { reviewId: null, reviewable: false };

type ReviewDb = Pick<PrismaClient, 'variation' | 'review'>;

/**
 * Trạng thái đánh giá từng dòng (theo id dòng) của một đơn, cùng luật với can-review: chỉ đơn REVIEWABLE_ORDER mới có, mỗi
 * sản phẩm của đơn một đánh giá nên hai biến thể cùng sản phẩm chung một trạng thái. Đơn khác thì mọi dòng NO_REVIEW, không
 * truy vấn gì.
 */
export async function orderLineReviews(
  db: ReviewDb,
  order: { id: string; userId: string; status: string; type: string; placedForCustomer: boolean; items: { id: string; variationId: string }[] },
): Promise<(itemId: string) => OrderLineReview> {
  const eligible =
    order.status === REVIEWABLE_ORDER.status && order.type === REVIEWABLE_ORDER.type && order.placedForCustomer === REVIEWABLE_ORDER.placedForCustomer;
  if (!eligible || order.items.length === 0) return () => NO_REVIEW;
  const variations = await db.variation.findMany({
    where: { id: { in: [...new Set(order.items.map((it) => it.variationId))] } },
    select: { id: true, productId: true },
  });
  const productOf = new Map(variations.map((v) => [v.id, v.productId]));
  const productIds = [...new Set(variations.map((v) => v.productId))];
  const reviews = productIds.length
    ? await db.review.findMany({
        where: { userId: order.userId, orderId: order.id, productId: { in: productIds } },
        select: { id: true, productId: true },
      })
    : [];
  const reviewOf = new Map(reviews.map((r) => [r.productId, r.id]));
  const byItem = new Map(
    order.items.map((it) => {
      const productId = productOf.get(it.variationId);
      if (!productId) return [it.id, NO_REVIEW] as const;
      const reviewId = reviewOf.get(productId) ?? null;
      return [it.id, { reviewId, reviewable: reviewId === null }] as const;
    }),
  );
  return (itemId) => byItem.get(itemId) ?? NO_REVIEW;
}
