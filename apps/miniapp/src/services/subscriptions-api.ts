import { api } from './api';
import { takeMeBlock } from './home-feed';

/** Cổng ZaloPay/VNPAY cần khách thao tác mỗi kỳ nên gói định kỳ chỉ nhận 3 cách này (Q-13, khớp API). */
export const SUBSCRIPTION_PAYMENT_METHODS = ['COD', 'WALLET', 'BANK_TRANSFER'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

/** Khớp `MAX_START_DAYS_AHEAD` của API: ngày bắt đầu xa hơn bị trả 400. */
export const MAX_START_DAYS_AHEAD = 60;

export interface SubscriptionDTO {
  id: string;
  quantity: number;
  intervalWeeks: number;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  nextRunAt: string;
  // Tuỳ chọn: khối "subscriptions" của home feed có thể còn trong cache từ bản API cũ chưa trả các trường này.
  addressId?: string;
  paymentMethod?: SubscriptionPaymentMethod;
  lastOrderId?: string | null;
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
}

export interface SubscriptionFirstOrder {
  id: string;
  code: string;
  status: string;
  paymentMethod: SubscriptionPaymentMethod;
  total: number;
}

export type CreatedSubscription = SubscriptionDTO & { firstOrder?: SubscriptionFirstOrder | null };

export const getSubscriptions = async () =>
  (await takeMeBlock('subscriptions')) ?? api.get<SubscriptionDTO[]>('/me/subscriptions').then((r) => r.data);

export const createSubscription = (data: {
  variationId: string;
  quantity: number;
  intervalWeeks: number;
  addressId: string;
  /** YYYY-MM-DD giờ Việt Nam; bỏ trống = giao đơn đầu ngay. */
  startDate?: string;
  paymentMethod: SubscriptionPaymentMethod;
}) => api.post<CreatedSubscription>('/me/subscriptions', data).then((r) => r.data);

export const updateSubscription = (
  id: string,
  data: { quantity?: number; addressId?: string; paymentMethod?: SubscriptionPaymentMethod },
) => api.patch<SubscriptionDTO>(`/me/subscriptions/${id}`, data).then((r) => r.data);

export const setSubscriptionStatus = (id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') =>
  api.post<SubscriptionDTO>(`/me/subscriptions/${id}/status`, { status }).then((r) => r.data);

export const skipSubscriptionCycle = (id: string) =>
  api.post<SubscriptionDTO>(`/me/subscriptions/${id}/skip`).then((r) => r.data);
