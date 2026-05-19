/**
 * API Service — Giao tiếp với Tubu Tree Backend
 *
 * Tất cả API calls đi qua đây.
 * JWT token được tự động gắn vào header nếu đã đăng nhập.
 */
import axios from 'axios';
import type {
  AuthResponse, ProductsResponse, Product, Category,
  CartItem, OrderRef, OrderDetail, Address,
  WishlistItem, NotificationsResponse, Banner, Review,
  MyCapabilities, AffiliateApplication, AgentApplication,
  AdminUserItem, Paginated, AppStatus,
  PointsBalance, PointsLedgerItem,
  AffiliateProfile, Referral, CommissionItem, WalletItem,
  AgentTier, AgentProfileInfo, Payout,
  Voucher, VoucherApplyResult,
} from 'types';

// Base URL — đổi khi deploy production
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Tự động gắn JWT token
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('tubutree_token', token);
  } else {
    localStorage.removeItem('tubutree_token');
  }
}

export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem('tubutree_token');
  }
  return authToken;
}

// Interceptor: gắn token vào mỗi request
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ========== AUTH ==========
export const authApi = {
  login: (accessToken: string) =>
    api.post<AuthResponse>('/auth/login', { accessToken }).then(r => r.data),
};

// ========== PRODUCTS ==========
export const productApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<ProductsResponse>('/products', { params: { page, limit } }).then(r => r.data),

  getDetail: (sku: string) =>
    api.get<Product>(`/products/${sku}`).then(r => r.data),

  getCategories: () =>
    api.get<{ data: Category[] }>('/products/categories').then(r => r.data),
};

// ========== CART ==========
export const cartApi = {
  getAll: () =>
    api.get<CartItem[]>('/cart').then(r => r.data),

  add: (pos_product_id: string, qty: number, variant_id?: string) =>
    api.post<CartItem>('/cart', { pos_product_id, qty, variant_id }).then(r => r.data),

  update: (id: number, qty: number) =>
    api.put<CartItem>(`/cart/${id}`, { qty }).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/cart/${id}`).then(r => r.data),
};

// ========== ORDERS ==========
export const orderApi = {
  create: (data: {
    items: any[]; addressId: number; paymentMethod: string; notes?: string;
    subtotal_vnd?: number; voucher_code?: string; points_to_redeem?: number;
  }) =>
    api.post('/orders', data).then(r => r.data),

  getAll: () =>
    api.get<OrderRef[]>('/orders').then(r => r.data),

  getDetail: (posOrderId: string) =>
    api.get<OrderDetail>(`/orders/${posOrderId}`).then(r => r.data),

  cancel: (posOrderId: string, reason?: string) =>
    api.put(`/orders/${posOrderId}/cancel`, { reason }).then(r => r.data),

  reorder: (posOrderId: string) =>
    api.post(`/orders/${posOrderId}/reorder`).then(r => r.data),
};

// ========== ADDRESSES ==========
export const addressApi = {
  getAll: () =>
    api.get<Address[]>('/addresses').then(r => r.data),

  create: (data: Omit<Address, 'id' | 'user_id'>) =>
    api.post<Address>('/addresses', data).then(r => r.data),

  update: (id: number, data: Partial<Address>) =>
    api.put<Address>(`/addresses/${id}`, data).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/addresses/${id}`).then(r => r.data),
};

// ========== WISHLIST ==========
export const wishlistApi = {
  getAll: () =>
    api.get<WishlistItem[]>('/wishlists').then(r => r.data),

  add: (pos_product_id: string) =>
    api.post<WishlistItem>('/wishlists', { pos_product_id }).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/wishlists/${id}`).then(r => r.data),
};

// ========== NOTIFICATIONS ==========
export const notificationApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<NotificationsResponse>('/notifications', { params: { page, limit } }).then(r => r.data),

  markRead: (id: number) =>
    api.put(`/notifications/${id}/read`).then(r => r.data),

  markAllRead: () =>
    api.put('/notifications/read-all').then(r => r.data),
};

// ========== BANNERS ==========
export const bannerApi = {
  getActive: () =>
    api.get<Banner[]>('/banners').then(r => r.data),
};

// ========== REVIEWS ==========
export const reviewApi = {
  getByProduct: (productId: string) =>
    api.get<Review[]>(`/reviews/product/${productId}`).then(r => r.data),

  create: (data: { pos_product_id: string; rating: number; comment?: string; order_ref_id?: number }) =>
    api.post<Review>('/reviews', data).then(r => r.data),
};

// ========== ME / CAPABILITIES ==========
export const meApi = {
  getCapabilities: () =>
    api.get<MyCapabilities>('/me/capabilities').then(r => r.data),
};

// ========== AFFILIATE ==========
export const affiliateApi = {
  /** Nộp đơn CTV (multipart): bank info + ảnh CCCD mặt trước */
  submit: (data: {
    cccd_number: string;
    bank_name: string;
    bank_account_no: string;
    bank_account_name: string;
    email?: string;
    cccd_front: File;
  }) => {
    const fd = new FormData();
    fd.append('cccd_number', data.cccd_number);
    fd.append('bank_name', data.bank_name);
    fd.append('bank_account_no', data.bank_account_no);
    fd.append('bank_account_name', data.bank_account_name);
    if (data.email) fd.append('email', data.email);
    fd.append('cccd_front', data.cccd_front);
    return api.post<AffiliateApplication>('/affiliate/applications', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },

  getMine: () =>
    api.get<{ active: AffiliateApplication | null; history: AffiliateApplication[] }>(
      '/affiliate/applications/me',
    ).then(r => r.data),

  update: (data: Partial<{
    cccd_number: string;
    bank_name: string;
    bank_account_no: string;
    bank_account_name: string;
    email: string;
    cccd_front: File;
  }>) => {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, v as any);
    });
    return api.put<AffiliateApplication>('/affiliate/applications/me', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
};

// ========== AGENT ==========
export const agentApi = {
  submit: (data: {
    agent_type: 'INDIVIDUAL' | 'BUSINESS';
    cccd_number: string;
    bank_name: string;
    bank_account_no: string;
    bank_account_name: string;
    warehouse_address: string;
    expected_monthly_revenue: number;
    email?: string;
    company_name?: string;
    tax_code?: string;
    representative_name?: string;
    cccd_front: File;
    cccd_back: File;
    selfie: File;
    business_license?: File;
  }) => {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      fd.append(k, v as any);
    });
    return api.post<AgentApplication>('/agent/applications', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },

  getMine: () =>
    api.get<{ active: AgentApplication | null; history: AgentApplication[] }>(
      '/agent/applications/me',
    ).then(r => r.data),

  update: (data: Record<string, string | number | File | undefined | null>) => {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, v as any);
    });
    return api.put<AgentApplication>('/agent/applications/me', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
};

// ========== ADMIN ==========
type AppKind = 'affiliate' | 'agent';

export const adminApi = {
  listApplications: (kind: AppKind, params: { status?: AppStatus; page?: number; limit?: number }) =>
    api.get<Paginated<AffiliateApplication | AgentApplication>>(
      `/admin/${kind}/applications`,
      { params },
    ).then(r => r.data),

  getApplicationDetail: (kind: AppKind, id: number) =>
    api.get(`/admin/${kind}/applications/${id}`).then(r => r.data),

  approve: (kind: AppKind, id: number) =>
    api.post(`/admin/${kind}/applications/${id}/approve`).then(r => r.data),

  reject: (kind: AppKind, id: number, reason: string) =>
    api.post(`/admin/${kind}/applications/${id}/reject`, { reason }).then(r => r.data),

  suspend: (kind: AppKind, id: number, reason: string) =>
    api.post(`/admin/${kind}/applications/${id}/suspend`, { reason }).then(r => r.data),

  restore: (kind: AppKind, id: number) =>
    api.post(`/admin/${kind}/applications/${id}/restore`).then(r => r.data),

  listUsers: (params: { search?: string; banned?: 'true' | 'false'; page?: number; limit?: number }) =>
    api.get<Paginated<AdminUserItem>>('/admin/users', { params }).then(r => r.data),

  getUser: (userId: number) =>
    api.get(`/admin/users/${userId}`).then(r => r.data),

  banUser: (userId: number, reason: string) =>
    api.post(`/admin/users/${userId}/ban`, { reason }).then(r => r.data),

  unbanUser: (userId: number) =>
    api.post(`/admin/users/${userId}/unban`).then(r => r.data),
};

// ========== POINTS (B) ==========
export const pointsApi = {
  getBalance: () =>
    api.get<PointsBalance>('/points/balance').then(r => r.data),
  getHistory: (page = 1, limit = 20) =>
    api.get<Paginated<PointsLedgerItem>>('/points/history', { params: { page, limit } }).then(r => r.data),
  previewRedeem: (points_to_redeem: number, order_total: number) =>
    api.post('/points/preview-redeem', { points_to_redeem, order_total }).then(r => r.data),
};

// ========== AFFILIATE PROFILE / REFERRAL / COMMISSION (C) ==========
export const affiliateHubApi = {
  getProfile: () =>
    api.get<AffiliateProfile>('/affiliate/me/profile').then(r => r.data),
  getReferrals: (page = 1, limit = 20) =>
    api.get<Paginated<Referral>>('/affiliate/me/referrals', { params: { page, limit } }).then(r => r.data),
  getCommissions: (page = 1, limit = 20) =>
    api.get<Paginated<CommissionItem>>('/affiliate/me/commissions', { params: { page, limit } }).then(r => r.data),

  // Referral attribution (cho mọi user)
  attributeReferral: (ref_code: string) =>
    api.post('/referral/attribute', { ref_code }).then(r => r.data),
  getMyReferrer: () =>
    api.get('/referral/my-referrer').then(r => r.data),
};

// ========== WALLET (chung cho CTV nhận commission) ==========
export const walletApi = {
  getBalance: () =>
    api.get<{ balance: string }>('/wallet/balance').then(r => r.data),
  getHistory: (page = 1, limit = 20) =>
    api.get<Paginated<WalletItem>>('/wallet/history', { params: { page, limit } }).then(r => r.data),
};

// ========== AGENT PRICING (D) ==========
export const agentPricingApi = {
  getMyProfile: () =>
    api.get<AgentProfileInfo>('/agent/me/profile').then(r => r.data),
  previewWholesale: (retail: number) =>
    api.get<{ retail: string; wholesale: string | null }>('/agent/me/preview', { params: { retail } }).then(r => r.data),

  // Admin
  listTiers: () =>
    api.get<AgentTier[]>('/admin/agent/tiers').then(r => r.data),
  listAgentProfiles: () =>
    api.get('/admin/agent/profiles').then(r => r.data),
  setAgentTier: (userId: number, tier_id: number) =>
    api.put(`/admin/agent/profiles/${userId}/tier`, { tier_id }).then(r => r.data),
};

// ========== PAYOUT (E) ==========
export const payoutApi = {
  request: (amount_vnd: number) =>
    api.post<Payout>('/payouts', { amount_vnd }).then(r => r.data),
  listMine: (page = 1, limit = 20) =>
    api.get<Paginated<Payout>>('/payouts/me', { params: { page, limit } }).then(r => r.data),

  // Admin
  adminList: (params: { status?: string; page?: number; limit?: number }) =>
    api.get<Paginated<Payout>>('/admin/payouts', { params }).then(r => r.data),
  adminApprove: (id: number) =>
    api.post(`/admin/payouts/${id}/approve`).then(r => r.data),
  adminReject: (id: number, reason: string) =>
    api.post(`/admin/payouts/${id}/reject`, { reason }).then(r => r.data),
  adminComplete: (id: number, proof?: File) => {
    const fd = new FormData();
    if (proof) fd.append('proof', proof);
    return api.post(`/admin/payouts/${id}/complete`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
};

// ========== VOUCHER (F) ==========
export const voucherApi = {
  apply: (code: string, order_total: number) =>
    api.post<VoucherApplyResult>('/vouchers/apply', { code, order_total }).then(r => r.data),
  listActive: () =>
    api.get<Voucher[]>('/vouchers/active').then(r => r.data),

  // Admin
  adminList: (page = 1, limit = 50) =>
    api.get<Paginated<Voucher>>('/admin/vouchers', { params: { page, limit } }).then(r => r.data),
  adminCreate: (data: Partial<Voucher> & { code: string; type: 'PERCENT' | 'FIXED'; value: number; valid_from: string; valid_to: string; description: string }) =>
    api.post<Voucher>('/admin/vouchers', data).then(r => r.data),
  adminUpdate: (id: number, data: Partial<Voucher>) =>
    api.put<Voucher>(`/admin/vouchers/${id}`, data).then(r => r.data),
  adminDeactivate: (id: number) =>
    api.delete(`/admin/vouchers/${id}`).then(r => r.data),
};

// Helper để hiển thị URL ảnh KYC trong <img src>.
// Backend yêu cầu signed URL (HMAC + expiry). Component sẽ mint URL trước khi render.
// Helper này chỉ build absolute base URL từ relative path.
export const kycImageBaseUrl = (relativeUrl: string | null | undefined) => {
  if (!relativeUrl) return '';
  if (relativeUrl.startsWith('http')) return relativeUrl;
  const base = API_BASE.replace(/\/api$/, '');
  return `${base}${relativeUrl}`;
};

/**
 * Mint signed URL cho ảnh KYC. Trả về URL có thể đặt vào <img src> trực tiếp.
 * Pattern relativeUrl: /api/uploads/kyc/{userId}/{filename}
 */
export const mintKycSignedUrl = async (relativeUrl: string | null | undefined): Promise<string> => {
  if (!relativeUrl) return '';
  if (relativeUrl.startsWith('http')) return relativeUrl;
  // Parse userId & filename từ relativeUrl
  const m = relativeUrl.match(/^\/api\/uploads\/kyc\/(\d+)\/([^?]+)/);
  if (!m) return kycImageBaseUrl(relativeUrl);
  const [, userId, filename] = m;
  const base = API_BASE.replace(/\/api$/, '');
  try {
    const { data } = await api.get(`/uploads/kyc/${userId}/${filename}/sign`);
    return `${base}${data.url}`;
  } catch {
    return '';
  }
};

// Legacy alias để các page hiện có không vỡ — sẽ resolve async qua component wrapper.
export const kycImageUrl = kycImageBaseUrl;

export default api;
