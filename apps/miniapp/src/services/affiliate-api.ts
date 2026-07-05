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

/** Ghi "chạm" giới thiệu để attribution sống 3 ngày (fallback khi phiên mất). Fire-and-forget. */
export const recordReferralTouch = (dto: { referralCode: string; storefrontSlug?: string; kind?: 'ctv' | 'brand' }) =>
  api.post('/affiliate/touch', dto).then((r) => r.data as { ok: boolean });

// ── CTV lên đơn hộ khách (CTV đặt hộ, hưởng hoa hồng) ──
export interface CtvOrderItemInput {
  variationId: string;
  quantity: number;
}
export interface CtvOrderCustomerInput {
  recipient: string;
  phone: string;
  province: string;
  district?: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode?: string;
  wardCode: string;
}
export interface CtvOrderItemResult {
  productName: string;
  variationName: string;
  unitPrice: number;
  quantity: number;
  total: number;
}
export interface CtvOrderResult {
  id: string;
  code: string;
  total: number;
  status: string;
  items: CtvOrderItemResult[];
}
export const createCtvOrder = (dto: {
  items: CtvOrderItemInput[];
  customer: CtvOrderCustomerInput;
  paymentMethod: 'COD' | 'BANK_TRANSFER';
  note?: string;
}) => api.post<CtvOrderResult>('/affiliate/orders', dto).then((r) => r.data);

// ── Content Kit (bộ nội dung bán hàng theo từng sản phẩm) ──
export interface ContentKitFaq {
  q: string;
  a: string;
}
export interface ContentKit {
  productName: string;
  images: string[];
  /** Đã tự chèn tên CTV + link giới thiệu (thay {ten_ctv}/{link}) — copy là dùng luôn. */
  captions: string[];
  usps: string[];
  faqs: ContentKitFaq[];
  videoUrls: string[];
  shareLink: string;
}
export const fetchContentKit = (slug: string) =>
  api.get<ContentKit>(`/affiliate/content-kit/${slug}`).then((r) => r.data);
