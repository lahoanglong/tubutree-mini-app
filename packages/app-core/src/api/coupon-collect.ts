import type { HttpClient } from '../http';
import type { CouponDTO } from './loyalty';

/**
 * Mã admin cho hiện ở mục Nhận mã. Route công khai có cache nên không mang trạng thái riêng của khách:
 * "đã nhận" ghép phía client từ `/me/coupons`.
 */
export interface CollectableCouponDTO {
  code: string;
  title: string | null;
  type: CouponDTO['type'];
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  startAt: string;
  endAt: string;
  newCustomerOnly: boolean;
  claimedCount: number;
  /** null = không giới hạn tổng lượt nhận. */
  usageLimit: number | null;
}

export const fetchCollectableCoupons = (http: HttpClient) => http.get<CollectableCouponDTO[]>('/coupons/collectable');
