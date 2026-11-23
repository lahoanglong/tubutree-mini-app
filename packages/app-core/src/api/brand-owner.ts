import type { HttpClient } from '../http';

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

/** null khi tài khoản chưa sở hữu nhãn nào (máy chủ trả 200 rỗng, không 404). */
export const getOwnedBrand = (http: HttpClient) => http.get<OwnedBrand | null>('/brand/owner/me');
export const updateOwnedBrand = (http: HttpClient, dto: Partial<Pick<OwnedBrand, 'logoUrl' | 'coverUrl' | 'tagline' | 'story' | 'origin'>>) =>
  http.patch<OwnedBrand>('/brand/owner/me', dto);
export const createOwnedPromotion = (http: HttpClient, dto: { title: string; subtitle?: string; couponCode?: string; startAt: string; endAt: string }) =>
  http.post<OwnedPromotion>('/brand/owner/me/promotions', dto);
export const updateOwnedPromotion = (http: HttpClient, id: string, dto: { title?: string; subtitle?: string; couponCode?: string; startAt?: string; endAt?: string; isActive?: boolean }) =>
  http.patch(`/brand/owner/me/promotions/${id}`, dto);
export const deleteOwnedPromotion = (http: HttpClient, id: string) =>
  http.delete(`/brand/owner/me/promotions/${id}`);

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
export const getOwnedBrandSales = (http: HttpClient, period: BrandSalesPeriod) =>
  http.get<BrandSales>('/brand/owner/me/sales', { query: { period } });

/**
 * Sức khoẻ catalog của nhãn mình sở hữu (máy chủ lấy nhãn theo tài khoản, không nhận mã nhãn). SKU = biến thể đang bật của sản phẩm đang bật;
 * thiếu thành phần (INCI) xét theo sản phẩm. Hai danh sách cắt ở `listMax` dòng, các con số tổng vẫn đếm đủ.
 */
export interface BrandCatalogHealth {
  totalProducts: number;
  totalSkus: number;
  outOfStockSkus: number;
  /** null: tạm không đọc được bảng cặp chai ↔ gói Refill. */
  refillPairedSkus: number | null;
  missingInciProducts: number;
  missingInci: { productId: string; name: string; skuCount: number }[];
  outOfStock: { productId: string; productName: string; sku: string; name: string }[];
  listMax: number;
}
export const getOwnedBrandCatalogHealth = (http: HttpClient) => http.get<BrandCatalogHealth>('/brand/owner/me/catalog-health');
