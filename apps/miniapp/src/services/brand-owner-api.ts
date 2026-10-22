import { api } from './api';

export interface OwnedPromotion {
  id: string;
  title: string;
  subtitle: string | null;
  /** Mã giảm giá khách nhập khi thanh toán — không có thì banner chỉ là lời quảng cáo. */
  couponCode: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
}
export interface OwnedBrand {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  tagline: string | null;
  story: string | null;
  origin: string | null;
  isVerified: boolean;
  isPublished: boolean;
  followerCount: number;
  promotions: OwnedPromotion[];
}

/** null = API cũ chưa có cờ → người gọi giữ cách cũ (hỏi /brand/owner/me). Không trả undefined vì react-query cấm. */
export const getOwnsBrand = () =>
  api.get('/auth/me').then((r) => (r.data as { ownsBrand?: boolean }).ownsBrand ?? null);
export const getOwnedBrand = () => api.get('/brand/owner/me').then((r) => r.data as OwnedBrand);
export const updateOwnedBrand = (dto: Partial<Pick<OwnedBrand, 'logoUrl' | 'coverUrl' | 'tagline' | 'story' | 'origin'>>) =>
  api.patch('/brand/owner/me', dto).then((r) => r.data as OwnedBrand);
export const createOwnedPromotion = (dto: { title: string; subtitle?: string; couponCode?: string; startAt: string; endAt: string }) =>
  api.post('/brand/owner/me/promotions', dto).then((r) => r.data as OwnedPromotion);
export const updateOwnedPromotion = (id: string, dto: { title?: string; subtitle?: string; couponCode?: string; startAt?: string; endAt?: string; isActive?: boolean }) =>
  api.patch(`/brand/owner/me/promotions/${id}`, dto).then((r) => r.data);
export const deleteOwnedPromotion = (id: string) =>
  api.delete(`/brand/owner/me/promotions/${id}`).then((r) => r.data);

export type BrandSalesPeriod = '7d' | '30d' | '90d' | 'month' | 'prev_month';
/** Chỉ số tổng hợp của nhãn — máy chủ không trả thông tin khách (Q-18). Doanh thu là giá bán hàng của nhãn, chưa trừ mã giảm giá toàn đơn, chưa gồm phí vận chuyển. */
export interface BrandSales {
  period: BrandSalesPeriod;
  from: string;
  to: string;
  orderCount: number;
  unitsSold: number;
  revenue: number;
  delivered: { orderCount: number; revenue: number };
  topProducts: { productId: string; name: string; slug: string; quantity: number; revenue: number }[];
}
export const getOwnedBrandSales = (period: BrandSalesPeriod) =>
  api.get('/brand/owner/me/sales', { params: { period } }).then((r) => r.data as BrandSales);
