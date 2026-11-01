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

/**
 * Phần riêng của khách trên kho mã (`GET /coupons/collectable/mine`, cần đăng nhập, không cache). Ví `/me/coupons` ẩn mã khách đã dùng hết
 * lượt và mã chỉ-khách-mới của khách đã có đơn, nên chỉ nhìn ví thì mã nhận rồi vẫn trông như "chưa nhận".
 */
export interface CollectableMineDTO {
  /** Mã trong kho mà khách đã nhận, dù còn trong ví hay không. */
  claimed: string[];
  /** Mã chỉ dành cho khách mới, khi khách đã có đơn. */
  newCustomerOnly: string[];
}

/**
 * `fresh` là một số bất kỳ khác nhau mỗi lần: route kho trả `Cache-Control: public, max-age=15` nên lần tải lại ngay sau một lần nhận bị
 * từ chối có thể lấy lại đúng bản cũ trong cache trình duyệt; tham số lạ đổi khoá cache để lần đó đi tới máy chủ. Chỉ dùng sau lỗi nhận mã.
 */
export const fetchCollectableCoupons = (http: HttpClient, fresh?: number) =>
  fresh === undefined ? http.get<CollectableCouponDTO[]>('/coupons/collectable') : http.get<CollectableCouponDTO[]>('/coupons/collectable', { query: { fresh } });

export const fetchCollectableMine = (http: HttpClient) => http.get<CollectableMineDTO>('/coupons/collectable/mine');
