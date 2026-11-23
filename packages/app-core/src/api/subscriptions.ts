import type { HttpClient } from '../http';

/** Cổng ZaloPay/VNPAY cần khách thao tác mỗi kỳ nên gói định kỳ chỉ nhận 3 cách này (Q-13, khớp API). */
export const SUBSCRIPTION_PAYMENT_METHODS = ['COD', 'WALLET', 'BANK_TRANSFER'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

/** Khớp `MAX_START_DAYS_AHEAD` của API: ngày bắt đầu xa hơn bị trả 400. */
export const MAX_START_DAYS_AHEAD = 60;

/** Khớp `RESCHEDULE_MAX_DAYS_AHEAD` của API: dời ngày giao kỳ tới xa hơn bị trả 400. */
export const RESCHEDULE_MAX_DAYS_AHEAD = 90;

/** Bậc giảm kế tiếp của thang `subscribe.discount_tiers`: còn thiếu bao nhiêu gói đang chạy, % (0..1) của bậc đó. */
export interface SubscriptionNextTier {
  countNeeded: number;
  discountPct: number;
}

export interface SubscriptionDTO {
  id: string;
  quantity: number;
  intervalWeeks: number;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  /** Vì sao gói đang PAUSED (mã trong `subscription-pause-copy`), null khi không PAUSED hoặc gói dừng từ trước. Optional: API cũ chưa trả. */
  pausedReason?: string | null;
  nextRunAt: string;
  // Tuỳ chọn: khối "subscriptions" của home feed có thể còn trong cache từ bản API cũ chưa trả các trường này.
  addressId?: string;
  paymentMethod?: SubscriptionPaymentMethod;
  lastOrderId?: string | null;
  /** Ngày đơn kỳ gần nhất, để tính ngày giao kế khi đổi chu kỳ. Optional: API cũ chưa trả. */
  lastOrderAt?: string | null;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  slug: string | null;
  unitPrice: number;
  effectiveDiscountPct: number;
  /** Tiền hàng mỗi kỳ trước giảm, phần giảm và tiền hàng sau giảm theo đúng công thức đơn kỳ của server. Optional: API cũ chưa trả. */
  cycleSubtotal?: number;
  cycleDiscount?: number;
  cycleGoods?: number;
  /** Cùng một giá trị trên mọi gói của khách; null khi đã ở bậc cao nhất hay không có gói đang chạy. Optional: API cũ chưa trả. */
  nextTier?: SubscriptionNextTier | null;
}

export interface SubscriptionFirstOrder {
  id: string;
  code: string;
  status: string;
  paymentMethod: SubscriptionPaymentMethod;
  total: number;
}

export type CreatedSubscription = SubscriptionDTO & { firstOrder?: SubscriptionFirstOrder | null };

/** Trả về của "Đặt kỳ này ngay": gói sau khi dời kỳ sau, kèm đơn vừa tạo. */
export type RunNowSubscription = Pick<SubscriptionDTO, 'id' | 'status' | 'nextRunAt'> & { order: SubscriptionFirstOrder };

/** Trường PATCH của gói: chỉ gửi trường đã đổi. `nextRunDate` là YYYY-MM-DD giờ Việt Nam, từ ngày mai tới `RESCHEDULE_MAX_DAYS_AHEAD` ngày. */
export interface SubscriptionPatch {
  quantity?: number;
  addressId?: string;
  paymentMethod?: SubscriptionPaymentMethod;
  intervalWeeks?: number;
  nextRunDate?: string;
}

export const getSubscriptions = (http: HttpClient) => http.get<SubscriptionDTO[]>('/me/subscriptions');

/** `GET /me/subscriptions/suggestions` (cờ subscriptions.smart_interval_enabled): đọc kết quả qua `readSubscriptionSuggestions` (commerce/green-box). */
export const getSubscriptionSuggestions = (http: HttpClient) => http.get<unknown>('/me/subscriptions/suggestions');

export const createSubscription = (
  http: HttpClient,
  data: {
    variationId: string;
    quantity: number;
    intervalWeeks: number;
    addressId: string;
    /** YYYY-MM-DD giờ Việt Nam; bỏ trống = giao đơn đầu ngay. */
    startDate?: string;
    paymentMethod: SubscriptionPaymentMethod;
  },
) => http.post<CreatedSubscription>('/me/subscriptions', data);

export const updateSubscription = (http: HttpClient, id: string, data: SubscriptionPatch) => http.patch<SubscriptionDTO>(`/me/subscriptions/${id}`, data);

export const setSubscriptionStatus = (http: HttpClient, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') =>
  http.post<SubscriptionDTO>(`/me/subscriptions/${id}/status`, { status });

export const skipSubscriptionCycle = (http: HttpClient, id: string) => http.post<SubscriptionDTO>(`/me/subscriptions/${id}/skip`);

/** "Đặt kỳ này ngay": ra đơn kỳ tới hôm nay; đã có đơn hôm nay thì 409. */
export const runSubscriptionNow = (http: HttpClient, id: string) => http.post<RunNowSubscription>(`/me/subscriptions/${id}/run-now`);
