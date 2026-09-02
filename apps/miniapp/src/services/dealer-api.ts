import { api } from './api';
import type { OrderDTO } from '@tubutree/shared-types';

export type DealerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface DealerMe {
  isDealer: boolean;
  status: DealerStatus;
  tier: { id: string; name: string; creditLimit: number } | null;
  currentDebt: number;
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

export const getDealerMe = () => api.get<DealerMe>('/dealer/me').then((r) => r.data);
export const applyDealer = (data: DealerApplyInput) =>
  api.post('/dealer/apply', data).then((r) => r.data);
export const getPricelist = () => api.get<PricelistRow[]>('/dealer/pricelist').then((r) => r.data);
/** Đặt đơn đại lý kèm Idempotency-Key (mirror checkout.placeOrder/wallet.withdraw) — double-tap/retry mạng không tạo đơn công nợ đôi. */
export const placeDealerOrder = (
  items: { variationId: string; quantity: number }[],
  paymentMethod: 'CREDIT' | 'PREPAID',
  note?: string,
  idempotencyKey?: string,
) =>
  api
    .post<OrderDTO>(
      '/dealer/orders',
      { items, paymentMethod, note },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    )
    .then((r) => r.data);
export const getDealerOrders = () => api.get<OrderDTO[]>('/dealer/orders').then((r) => r.data);
export const getCreditLedger = () =>
  api.get<{ balance: number; entries: CreditEntry[] }>('/dealer/credit-ledger').then((r) => r.data);
export const payCredit = (amount: number, note?: string) =>
  api.post<{ ok: boolean }>('/dealer/credit-payment', { amount, note }).then((r) => r.data);

// ── Báo cáo quý (#71) ──
export interface QuarterlyReport {
  quarter: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  orderCount: number;
  bonusPct: number;
  bonusAmount: number;
  nextTier: { min: number; pct: number; toNext: number } | null;
  tiers: { min: number; pct: number }[];
}
export const getQuarterlyReport = () =>
  api.get<QuarterlyReport>('/dealer/quarterly-report').then((r) => r.data);

export interface DealerRewardProgress {
  id: string;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  volume: number;
  achieved: boolean;
  toGo: number;
}
export interface DealerRewardsView {
  quarter: string;
  year: number;
  quarterVolume: number;
  yearVolume: number;
  rewards: DealerRewardProgress[];
}
export const getDealerRewards = () =>
  api.get<DealerRewardsView>('/dealer/rewards').then((r) => r.data);

// ── Mẫu đơn lưu sẵn (#64) ──
export interface DealerTemplate {
  id: string;
  name: string;
  items: { variationId: string; quantity: number }[];
  createdAt: string;
}
export const getTemplates = () => api.get<DealerTemplate[]>('/dealer/templates').then((r) => r.data);
export const saveTemplate = (name: string, items: { variationId: string; quantity: number }[]) =>
  api.post<DealerTemplate>('/dealer/templates', { name, items }).then((r) => r.data);
export const deleteTemplate = (id: string) =>
  api.delete<{ ok: boolean }>(`/dealer/templates/${id}`).then((r) => r.data);
