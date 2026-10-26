import type { OrderDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export type DealerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface DealerOrderRules {
  minOrderValue: number;
  freeShipThreshold: number;
  shippingFee: number;
}

export interface DealerMe {
  isDealer: boolean;
  status: DealerStatus;
  tier: { id: string; name: string; creditLimit: number } | null;
  currentDebt: number;
  /** Đại lý có gian hàng đối tác thật; thiếu (API cũ) thì coi như không có. */
  hasPartnerStorefront?: boolean;
  /** Luật đơn sỉ do máy chủ cấu hình; thiếu thì màn đặt đơn không tự tính phí/tối thiểu. */
  orderRules?: DealerOrderRules;
  /** Lý do admin từ chối hồ sơ gần nhất (chỉ có khi status REJECTED). */
  rejectionReason?: string | null;
}

export interface DealerApplyInput {
  businessName: string;
  taxCode?: string;
  ownerName: string;
  phone: string;
  address: string;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  storeFrontUrl?: string;
  monthlyVolumeEstimate?: number;
  notes?: string;
}

export interface PricelistRow {
  variationId: string;
  sku: string;
  product: string;
  brand: string;
  variation: string;
  retailPrice: number;
  dealerPrice: number;
  discountPct: number;
  stock: number;
}

export interface CreditEntry {
  id: string;
  delta: number;
  refType: string;
  note: string | null;
  createdAt: string;
}

export const getDealerMe = (http: HttpClient) => http.get<DealerMe>('/dealer/me');
export const applyDealer = (http: HttpClient, data: DealerApplyInput) =>
  http.post('/dealer/apply', data);
export const getPricelist = (http: HttpClient) => http.get<PricelistRow[]>('/dealer/pricelist');
/** Đặt đơn đại lý kèm Idempotency-Key (mirror checkout.placeOrder/wallet.withdraw) — double-tap/retry mạng không tạo đơn công nợ đôi. */
export const placeDealerOrder = (
  http: HttpClient,
  items: { variationId: string; quantity: number }[],
  paymentMethod: 'CREDIT' | 'PREPAID',
  note?: string,
  idempotencyKey?: string,
) =>
    http.post<OrderDTO>(
      '/dealer/orders',
      { items, paymentMethod, note },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    );
export const getDealerOrders = (http: HttpClient) => http.get<OrderDTO[]>('/dealer/orders');
export const getCreditLedger = (http: HttpClient) =>
  http.get<{ balance: number; entries: CreditEntry[] }>('/dealer/credit-ledger');
/** Báo đã chuyển khoản trả nợ, kèm Idempotency-Key BẮT BUỘC (mirror placeDealerOrder/wallet.withdraw)
 * — double-tap/retry mạng của 1 lần báo không được trừ nợ 2 lần. */
export const payCredit = (http: HttpClient, amount: number, idempotencyKey: string, note?: string) =>
    http.post<{ ok: boolean }>(
      '/dealer/credit-payment',
      { amount, note },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );

// ── Báo cáo quý (#71) ──
export interface QuarterlyReport {
  quarter: string;
  periodStart: string;
  periodEnd: string;
  /** Doanh số ĐÃ CHỐT (đã thanh toán/ghi công nợ + đã đóng gói trở đi) — nền tính thưởng. */
  revenue: number;
  orderCount: number;
  /** Đơn trong quý chưa thanh toán / chưa đóng gói — chưa tính thưởng. */
  pendingRevenue: number;
  pendingOrderCount: number;
  bonusPct: number;
  bonusAmount: number;
  nextTier: { min: number; pct: number; toNext: number } | null;
  tiers: { min: number; pct: number }[];
}
export const getQuarterlyReport = (http: HttpClient) =>
  http.get<QuarterlyReport>('/dealer/quarterly-report');

/** Vòng đời yêu cầu nhận thưởng: PENDING → APPROVED | REJECTED; APPROVED → PAID. */
export type DealerRewardClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface DealerRewardProgress {
  id: string;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  /** 'Q3/2026' | '2026' — gửi kèm khi yêu cầu nhận thưởng. */
  periodKey: string;
  periodLabel: string;
  /** false = dòng của kỳ trước (còn trong thời gian gia hạn / đã có yêu cầu). */
  isCurrentPeriod: boolean;
  /** Doanh số ĐÃ CHỐT của kỳ. */
  volume: number;
  /** Đơn trong kỳ chưa thanh toán / chưa đóng gói — chưa tính. */
  pendingVolume: number;
  achieved: boolean;
  toGo: number;
  claimStatus: DealerRewardClaimStatus | null;
  claimId: string | null;
  rejectionReason: string | null;
  /** Mốc (loại trừ) hết hạn gửi yêu cầu cho kỳ này. */
  claimDeadline: string;
  canClaim: boolean;
}
export interface DealerRewardsView {
  quarter: string;
  year: number;
  quarterVolume: number;
  yearVolume: number;
  quarterPendingVolume: number;
  yearPendingVolume: number;
  claimGraceDays: number;
  rewards: DealerRewardProgress[];
}
export const getDealerRewards = (http: HttpClient) =>
  http.get<DealerRewardsView>('/dealer/rewards');

export interface DealerRewardClaimResult {
  success: boolean;
  /** true = đã gửi trước đó (bấm lại/2 request) — backend trả yêu cầu cũ, không tạo thêm. */
  alreadyClaimed: boolean;
  claimStatus: DealerRewardClaimStatus;
  message: string;
  claim: { id: string; status: DealerRewardClaimStatus; periodKey: string; volumeAtClaim: number; createdAt: string };
  reward: { id: string | null; title: string; type: string; threshold: number };
  periodKey: string;
  periodLabel: string;
  currentVolume: number;
}
/** Gửi yêu cầu nhận thưởng mốc cho 1 kỳ — idempotent phía backend (đại lý + kỳ + phần thưởng). */
export const claimDealerReward = (http: HttpClient, rewardId: string, periodKey?: string, note?: string) =>
    http.post<DealerRewardClaimResult>(`/dealer/rewards/${encodeURIComponent(rewardId)}/claim`, { periodKey, note });

// ── Mẫu đơn lưu sẵn (#64) ──
export interface DealerTemplate {
  id: string;
  name: string;
  items: { variationId: string; quantity: number }[];
  createdAt: string;
}
export const getTemplates = (http: HttpClient) => http.get<DealerTemplate[]>('/dealer/templates');
export const saveTemplate = (http: HttpClient, name: string, items: { variationId: string; quantity: number }[]) =>
  http.post<DealerTemplate>('/dealer/templates', { name, items });
export const deleteTemplate = (http: HttpClient, id: string) =>
  http.delete<{ ok: boolean }>(`/dealer/templates/${id}`);
