import type { HttpClient } from '../http';
import {
  getCouponHistory,
  getCoupons,
  getDailyCheckInStatus,
  getLoyalty,
  getLoyaltyPreview,
  getLoyaltyRewards,
  getMemberCard,
  getMyRedemptions,
  getNewCustomerOffer,
  getPointsTransactions,
  getPointsTransactionsPage,
  getReferral,
  nextPointsTxnCursor,
  type PointsTxn,
  type PointsTxnCursor,
} from '../api/loyalty';
import { fetchCollectableCoupons, fetchCollectableMine } from '../api/coupon-collect';
import { WASTE_QUERY_KEYS } from '../api/waste';

export const loyaltyQuery = (http: HttpClient) => ({ queryKey: ['loyalty'] as const, queryFn: () => getLoyalty(http) });
export const couponsQuery = (http: HttpClient) => ({ queryKey: ['coupons'] as const, queryFn: () => getCoupons(http) });
/**
 * Khoá con của ['coupons']: sau khi nhận mã, invalidate ['coupons'] làm mới cả ví, kho mã và lịch sử. staleTime 30 giây bằng `s-maxage` của route (CDN);
 * trình duyệt còn giữ thêm `max-age=15`, nên lần tải lại ngay sau một lần nhận bị từ chối dùng `freshCollectableCouponsQuery` để đổi khoá cache.
 */
export const collectableCouponsQuery = (http: HttpClient) => ({
  queryKey: ['coupons', 'collectable'] as const,
  queryFn: () => fetchCollectableCoupons(http),
  staleTime: 30_000,
});
/** Phần riêng của khách trên kho (mã đã nhận, mã chỉ dành khách mới); chỉ bật khi đã đăng nhập. Nằm dưới khoá kho nên mọi invalidate ['coupons'] làm mới nó cùng lúc. */
export const collectableMineQuery = (http: HttpClient) => ({
  queryKey: ['coupons', 'collectable', 'mine'] as const,
  queryFn: () => fetchCollectableMine(http),
});
/**
 * Tải lại kho sau khi nhận mã bị từ chối (hết lượt, hết hạn...): dùng với `queryClient.fetchQuery`, staleTime 0 để luôn đi mạng, và
 * `fresh` đổi khoá cache HTTP vì route kho có `max-age=15`. Cùng khoá react-query với `collectableCouponsQuery` nên mọi thẻ cập nhật theo.
 */
export const freshCollectableCouponsQuery = (http: HttpClient) => ({
  queryKey: ['coupons', 'collectable'] as const,
  queryFn: () => fetchCollectableCoupons(http, Date.now()),
  staleTime: 0,
});
export const couponHistoryQuery = (http: HttpClient) => ({ queryKey: ['coupons', 'history'] as const, queryFn: () => getCouponHistory(http) });
export const pointsTxnQuery = (http: HttpClient) => ({ queryKey: ['points-txn'] as const, queryFn: () => getPointsTransactions(http) });
/** Khoá con của ['points-txn'] để invalidate làm mới cả hai. Dùng với useInfiniteQuery: initialPageParam và getNextPageParam lấy từ đây. */
export const pointsTxnPagesQuery = (http: HttpClient) => ({
  queryKey: ['points-txn', 'pages'] as const,
  queryFn: ({ pageParam }: { pageParam: PointsTxnCursor | undefined }) => getPointsTransactionsPage(http, pageParam),
  initialPageParam: undefined as PointsTxnCursor | undefined,
  getNextPageParam: (last: PointsTxn[]) => nextPointsTxnCursor(last),
});
export const checkInQuery = (http: HttpClient) => ({ queryKey: ['loyalty-checkin'] as const, queryFn: () => getDailyCheckInStatus(http) });
export const memberCardQuery = (http: HttpClient) => ({ queryKey: ['loyalty-member-card'] as const, queryFn: () => getMemberCard(http) });
export const referralQuery = (http: HttpClient) => ({ queryKey: ['referral'] as const, queryFn: () => getReferral(http) });
export const newCustomerOfferQuery = (http: HttpClient, userId: string | undefined) => ({
  queryKey: ['new-customer-offer', userId] as const,
  queryFn: () => getNewCustomerOffer(http),
});
export const rewardsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.rewards, queryFn: () => getLoyaltyRewards(http) });
export const myRedemptionsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.rewardsMine, queryFn: () => getMyRedemptions(http) });
export const loyaltyPreviewQuery = (http: HttpClient) => ({ queryKey: ['loyalty-preview'] as const, queryFn: () => getLoyaltyPreview(http), staleTime: 5 * 60_000 });
