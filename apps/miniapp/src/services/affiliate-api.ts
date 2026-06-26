import { api } from './api';

export interface AffiliateMe {
  isAffiliate: boolean;
  referralCode: string;
  walletBalance: number;
}

export interface AffiliateTier {
  name: string;
  emoji: string;
  bonusPct: number;
  nextName: string | null;
  nextThreshold: number | null;
  toNext: number;
}
export interface AffiliateDashboard {
  todayCommission: number;
  monthCommission: number;
  pendingCommission: number;
  withdrawableCommission: number;
  totalClicks: number;
  totalConversions: number;
  monthRevenue: number;
  tier: AffiliateTier;
}

export interface AffiliateLink {
  id: string;
  shortCode: string;
  targetType: string;
  targetId: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  createdAt: string;
}

export type CommissionStatus = 'PENDING' | 'LOCKED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface Commission {
  id: string;
  orderId: string;
  orderTotal: number;
  rate: string;
  amount: number;
  status: CommissionStatus;
  createdAt: string;
}

export const getAffiliateMe = () => api.get<AffiliateMe>('/affiliate/me').then((r) => r.data);
export const registerAffiliate = () =>
  api.post<{ ok: boolean; referralCode: string }>('/affiliate/register').then((r) => r.data);
export const getAffiliateDashboard = () =>
  api.get<AffiliateDashboard>('/affiliate/dashboard').then((r) => r.data);
export const getAffiliateLinks = () =>
  api.get<AffiliateLink[]>('/affiliate/links').then((r) => r.data);
export const createAffiliateLink = (targetType: string, targetId?: string) =>
  api.post<AffiliateLink>('/affiliate/links', { targetType, targetId }).then((r) => r.data);
export const getCommissions = () =>
  api.get<Commission[]>('/affiliate/commissions').then((r) => r.data);
export interface PayoutResult {
  ok: boolean;
  method?: string;
  credited?: number;
  note?: string;
  payoutId?: string;
  status?: string;
}
export const requestPayout = (
  amount: number,
  method: 'BANK' | 'WALLET_BALANCE' | 'ZALOPAY',
  bankInfo?: { bankName: string; accountNumber: string; accountName: string },
) => api.post<PayoutResult>('/affiliate/payouts', { amount, method, bankInfo }).then((r) => r.data);

export interface StorefrontStat {
  slug: string;
  title?: string;
  orders: number;
  revenue: number;
  commission: number;
}
export interface ProductStat {
  productName: string;
  commission: number;
  orders: number;
}
export const getStorefrontAnalytics = () =>
  api.get('/affiliate/analytics/storefronts').then((r) => r.data as { storefronts: StorefrontStat[] });
export const getProductBreakdown = () =>
  api.get('/affiliate/analytics/products').then((r) => r.data as ProductStat[]);
