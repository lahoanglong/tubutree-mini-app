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

const DAY_MS = 864e5;

/**
 * Đơn đã giao đã qua hạn đổi/trả (`returns.window_days`): khách không còn gửi được yêu cầu trả mới. Cùng mốc giao và cùng phép
 * so sánh (`>` chặt) với OrderReturnsService.request; đơn cũ thiếu deliveredAt dùng updatedAt (muộn hơn mốc thật nên chỉ chậm mở).
 */
export function returnWindowClosed(order: { deliveredAt: Date | null; updatedAt: Date }, windowDays: number, now: Date): boolean {
  const deliveredAt = order.deliveredAt ?? order.updatedAt;
  return now.getTime() - deliveredAt.getTime() > windowDays * DAY_MS;
}

/**
 * Khoá advisory theo cặp (khách, sản phẩm) cho mọi lượt ghi sổ điểm đánh giá của cặp đó. Đánh giá cho hai đơn khác nhau
 * không đụng nhau ở khoá unique nên hai lượt tạo song song đều đọc sổ trống và cùng thưởng nếu không có khoá này.
 */
export const reviewRewardLockKey = (userId: string, productId: string): string => `review-reward:${userId}:${productId}`;

/** Trạng thái đánh giá của một dòng ở màn chi tiết đơn: đánh giá khách đã viết cho lần mua này, hoặc còn viết được không. */
export interface OrderLineReview {
  reviewId: string | null;
  reviewable: boolean;
  /**
   * Số đơn vị của chính dòng này đã có yêu cầu trả được duyệt (cộng mọi lần trả). Chỉ có khi lớn hơn 0 và dòng không phải quà
   * tặng: chi tiết đơn thay lối "Viết đánh giá" bằng một dòng trạng thái của lần trả.
   */
  returnedQty?: number;
  /**
   * Đi cùng `returnedQty`: true khi mọi yêu cầu trả đã duyệt của dòng đều có khoản hoàn trả hàng đã xong (tiền đã vào Ví hoặc Tubu đã
   * chuyển khoản). Khoản chuyển khoản còn chờ, hay lần trả không có tiền để hoàn (đơn XU, số hoàn 0đ), là false: app không được ghi
   * "Đã hoàn tiền" khi ô Thanh toán cùng màn còn ghi "Đang hoàn tiền".
   */
  refundDone?: boolean;
}

const NO_REVIEW: OrderLineReview = { reviewId: null, reviewable: false };

type ReviewDb = Pick<PrismaClient, 'variation' | 'review' | 'returnRequestItem' | 'orderCustomerRefund'>;

/**
 * Trạng thái đánh giá từng dòng (theo id dòng) của một đơn, cùng luật với can-review: chỉ đơn REVIEWABLE_ORDER mới có, mỗi
 * sản phẩm của đơn một đánh giá nên hai biến thể cùng sản phẩm chung một đánh giá (`reviewId`). Đơn khác thì mọi dòng NO_REVIEW,
 * không truy vấn gì.
 *
 * Dòng đã có yêu cầu trả được duyệt (mọi số lượng) thì không viết mới được. Luật xét theo DÒNG, không theo sản phẩm (PO A2.1,
 * 24/11): đơn có hai biến thể của cùng sản phẩm mà khách chỉ trả một thì biến thể còn lại vẫn mời viết. Cùng luật với
 * `pendingReviewCounts` để "Đánh giá (n SP)" ở thẻ đơn khớp chi tiết đơn. Đánh giá viết như thế không được thưởng (createFirst
 * xét `returnedProductsByOrder` theo sản phẩm) và can-review báo `returned` cho đơn đó để ô soạn không hứa điểm. Đánh giá đã viết
 * trước lần trả vẫn sửa được (`reviewId` giữ nguyên). Khoản hoàn chỉ được tra khi đơn có dòng trả đã duyệt.
 */
export async function orderLineReviews(
  db: ReviewDb,
  order: { id: string; userId: string; status: string; type: string; placedForCustomer: boolean; items: { id: string; variationId: string; isGift?: boolean }[] },
): Promise<(itemId: string) => OrderLineReview> {
  const eligible =
    order.status === REVIEWABLE_ORDER.status && order.type === REVIEWABLE_ORDER.type && order.placedForCustomer === REVIEWABLE_ORDER.placedForCustomer;
  if (!eligible || order.items.length === 0) return () => NO_REVIEW;
  const [variations, returnedLines] = await Promise.all([
    db.variation.findMany({
      where: { id: { in: [...new Set(order.items.map((it) => it.variationId))] } },
      select: { id: true, productId: true },
    }),
    db.returnRequestItem.findMany({
      where: { quantity: { gt: 0 }, returnRequest: { orderId: order.id, status: 'APPROVED' } },
      select: { orderItemId: true, quantity: true, returnRequestId: true },
    }),
  ]);
  const productOf = new Map(variations.map((v) => [v.id, v.productId]));
  const productIds = [...new Set(variations.map((v) => v.productId))];
  const returnedQtyOf = new Map<string, number>();
  const requestsOf = new Map<string, Set<string>>();
  for (const l of returnedLines) {
    returnedQtyOf.set(l.orderItemId, (returnedQtyOf.get(l.orderItemId) ?? 0) + l.quantity);
    requestsOf.set(l.orderItemId, (requestsOf.get(l.orderItemId) ?? new Set<string>()).add(l.returnRequestId));
  }
  const requestIds = [...new Set(returnedLines.map((l) => l.returnRequestId))];
  const [reviews, doneRefunds] = await Promise.all([
    productIds.length
      ? db.review.findMany({
          where: { userId: order.userId, orderId: order.id, productId: { in: productIds } },
          select: { id: true, productId: true },
        })
      : [],
    requestIds.length
      ? db.orderCustomerRefund.findMany({
          where: { orderId: order.id, kind: 'RETURN', refKey: { in: requestIds }, status: 'COMPLETED' },
          select: { refKey: true },
        })
      : [],
  ]);
  const reviewOf = new Map(reviews.map((r) => [r.productId, r.id]));
  const refunded = new Set(doneRefunds.map((r) => r.refKey));
  const byItem = new Map(
    order.items.map((it): readonly [string, OrderLineReview] => {
      if (it.isGift) return [it.id, NO_REVIEW];
      const returnedQty = returnedQtyOf.get(it.id) ?? 0;
      const returned = returnedQty > 0 ? { returnedQty, refundDone: [...(requestsOf.get(it.id) ?? [])].every((id) => refunded.has(id)) } : null;
      const productId = productOf.get(it.variationId);
      if (!productId) return [it.id, { ...NO_REVIEW, ...returned }];
      const reviewId = reviewOf.get(productId) ?? null;
      return [it.id, { reviewId, reviewable: reviewId === null && returned === null, ...returned }];
    }),
  );
  return (itemId) => byItem.get(itemId) ?? NO_REVIEW;
}

/** Dòng đơn để đếm đánh giá còn chờ: `productId` null khi biến thể đã bị xoá; `open` = trang sản phẩm còn mở và dòng có slug (nút "Viết đánh giá" dẫn tới được). */
export interface PendingReviewLine {
  id: string;
  productId: string | null;
  isGift: boolean;
  open: boolean;
}

export interface PendingReviewOrder {
  id: string;
  userId: string;
  status: string;
  type: string;
  placedForCustomer: boolean;
  items: PendingReviewLine[];
}

type PendingReviewDb = Pick<PrismaClient, 'review' | 'returnRequestItem'>;

const isReviewableOrder = (o: Pick<PendingReviewOrder, 'status' | 'type' | 'placedForCustomer'>): boolean =>
  o.status === REVIEWABLE_ORDER.status && o.type === REVIEWABLE_ORDER.type && o.placedForCustomer === REVIEWABLE_ORDER.placedForCustomer;

/**
 * Số sản phẩm còn chờ khách đánh giá trên từng đơn của một trang danh sách (orderId → số), cho nút "Đánh giá (n SP)" ở thẻ đơn. Cùng luật với nút
 * "Viết đánh giá" ở chi tiết đơn (`orderLineReviews`): chỉ đơn REVIEWABLE_ORDER, mỗi sản phẩm của đơn một đánh giá, bỏ quà tặng và dòng không mở được
 * trang sản phẩm. Dòng đã có yêu cầu trả được duyệt không mời: sản phẩm chỉ bị bỏ khi MỌI dòng mời được của nó trên đơn đều đã trả (PO A2.1: hai biến
 * thể cùng sản phẩm, trả một thì biến thể kia vẫn được đếm, cùng luật với nút "Viết đánh giá" của từng dòng).
 *
 * Đơn không đủ điều kiện không có trong Map; đơn đủ điều kiện mà hết sản phẩm để mời thì là 0. Cả trang tốn đúng hai truy vấn theo lô chạy song song
 * (đánh giá, dòng trả đã duyệt), không truy vấn nào khi trang không có đơn đã nhận còn sản phẩm để mời. Sản phẩm của dòng trả lấy từ dòng đơn đã có
 * trong bộ nhớ, không tra lại `orderItem`/`variation`.
 */
export async function pendingReviewCounts(db: PendingReviewDb, orders: readonly PendingReviewOrder[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // orderId → productId → các dòng còn mời viết của sản phẩm đó; sản phẩm hết dòng (đã trả hết) thì không đếm.
  const invite = new Map<string, Map<string, Set<string>>>();
  const productOfLine = new Map<string, { orderId: string; productId: string }>();
  const ownerOf = new Map<string, string>();
  for (const o of orders) {
    if (!isReviewableOrder(o)) continue;
    out.set(o.id, 0);
    const products = new Map<string, Set<string>>();
    for (const it of o.items) {
      if (!it.productId || it.isGift || !it.open) continue;
      productOfLine.set(it.id, { orderId: o.id, productId: it.productId });
      products.set(it.productId, (products.get(it.productId) ?? new Set<string>()).add(it.id));
    }
    if (products.size === 0) continue;
    invite.set(o.id, products);
    ownerOf.set(o.id, o.userId);
  }
  if (invite.size === 0) return out;
  const orderIds = [...invite.keys()];
  const [reviews, returnedLines] = await Promise.all([
    db.review.findMany({
      where: { orderId: { in: orderIds }, userId: { in: [...new Set(ownerOf.values())] } },
      select: { orderId: true, productId: true, userId: true },
    }),
    db.returnRequestItem.findMany({
      where: { quantity: { gt: 0 }, returnRequest: { orderId: { in: orderIds }, status: 'APPROVED' } },
      select: { orderItemId: true },
    }),
  ]);
  for (const r of reviews) if (ownerOf.get(r.orderId) === r.userId) invite.get(r.orderId)?.delete(r.productId);
  for (const l of returnedLines) {
    const line = productOfLine.get(l.orderItemId);
    if (line) invite.get(line.orderId)?.get(line.productId)?.delete(l.orderItemId);
  }
  for (const [orderId, products] of invite) out.set(orderId, [...products.values()].filter((lines) => lines.size > 0).length);
  return out;
}

type ReturnedLinesDb = Pick<Prisma.TransactionClient, 'returnRequestItem' | 'orderItem' | 'variation'>;

/**
 * Sản phẩm đã có dòng trả được duyệt (mọi số lượng) trên từng đơn: orderId → tập productId. Sản phẩm bị trả một phần cũng mất
 * thưởng đánh giá (thưởng bị thu hồi lúc duyệt trả nếu đã có đánh giá), nên đánh giá viết SAU lần duyệt không được thưởng và
 * không tính vào nhiệm vụ. Đơn chưa có lần trả nào chỉ tốn một truy vấn.
 */
export async function returnedProductsByOrder(db: ReturnedLinesDb, orderIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (orderIds.length === 0) return out;
  const lines = await db.returnRequestItem.findMany({
    where: { quantity: { gt: 0 }, returnRequest: { orderId: { in: [...orderIds] }, status: 'APPROVED' } },
    select: { orderItemId: true },
  });
  if (lines.length === 0) return out;
  const items = await db.orderItem.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.orderItemId))] } },
    select: { orderId: true, variationId: true },
  });
  const variations = await db.variation.findMany({
    where: { id: { in: [...new Set(items.map((it) => it.variationId))] } },
    select: { id: true, productId: true },
  });
  const productOf = new Map(variations.map((v) => [v.id, v.productId]));
  for (const it of items) {
    const productId = productOf.get(it.variationId);
    if (!productId) continue;
    const set = out.get(it.orderId) ?? new Set<string>();
    set.add(productId);
    out.set(it.orderId, set);
  }
  return out;
}
