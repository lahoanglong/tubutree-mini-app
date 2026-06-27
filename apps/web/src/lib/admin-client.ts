'use client';

import { apiFetch } from './client-api';

export interface DealerApp {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  address: string;
  taxCode: string | null;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  status: string;
  createdAt: string;
}
export interface AdminUser {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  pointsBalance: number;
  createdAt: string;
}
export interface AdminOrder {
  code: string;
  status: string;
  total: number;
  paymentMethod: string;
  createdAt: string;
}
export interface ConfigRow {
  key: string;
  value: unknown;
  description: string | null;
  category: string;
}
interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export const listDealerApps = (status?: string) =>
  apiFetch<DealerApp[]>(`/admin/dealer-applications${status ? `?status=${status}` : ''}`);
export const reviewDealerApp = (id: string, approve: boolean, tierId?: string, reason?: string) =>
  apiFetch(`/admin/dealer-applications/${id}/review`, { method: 'POST', body: { approve, tierId, reason } });
export const listUsers = (page = 1) =>
  apiFetch<Page<AdminUser>>(`/admin/users?page=${page}&limit=20`);
export const listOrders = (page = 1, status?: string) =>
  apiFetch<Page<AdminOrder>>(`/admin/orders?page=${page}&limit=20${status ? `&status=${status}` : ''}`);
export const getConfig = (category?: string) =>
  apiFetch<ConfigRow[]>(`/admin/config${category ? `?category=${category}` : ''}`);
export const setConfig = (key: string, value: unknown) =>
  apiFetch<{ ok: boolean }>('/admin/config', { method: 'PUT', body: { key, value } });
export interface CreateCouponInput {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  startAt: string;
  endAt: string;
  usageLimit?: number;
  perUserLimit?: number;
  scope: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
}
export const createCoupon = (input: CreateCouponInput) =>
  apiFetch('/admin/coupons', { method: 'POST', body: input });

// ── Nhãn hàng (storefront Lớp 3) ──
export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  isVerified: boolean;
  isPublished: boolean;
  followerCount: number;
}
export interface AdminBrandProduct {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  brand: string;
  isActive: boolean;
}
export interface AdminPromotion {
  id: string;
  title: string;
  subtitle: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
}
export interface AdminDealerReward {
  id: string;
  brandId: string | null;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  isActive: boolean;
}

export const listBrands = () => apiFetch<AdminBrand[]>('/admin/brands');
export const createBrand = (body: { name: string; tagline?: string; isPublished?: boolean }) =>
  apiFetch<AdminBrand>('/admin/brands', { method: 'POST', body });
export const updateBrand = (id: string, body: Partial<{ name: string; tagline: string; isPublished: boolean }>) =>
  apiFetch<AdminBrand>(`/admin/brands/${id}`, { method: 'PATCH', body });
export const verifyBrand = (id: string, isVerified: boolean) =>
  apiFetch<AdminBrand>(`/admin/brands/${id}/verify`, { method: 'PATCH', body: { isVerified } });
export const listBrandProducts = (id: string) =>
  apiFetch<AdminBrandProduct[]>(`/admin/brands/${id}/products`);
export const linkBrandByName = (id: string) =>
  apiFetch<{ linked: number }>(`/admin/brands/${id}/link-by-name`, { method: 'POST' });
export const detachBrandProducts = (id: string, productIds: string[]) =>
  apiFetch<{ detached: number }>(`/admin/brands/${id}/products`, { method: 'DELETE', body: { productIds } });
export const listPromotions = (id: string) =>
  apiFetch<AdminPromotion[]>(`/admin/brands/${id}/promotions`);
export const createPromotion = (id: string, body: { title: string; subtitle?: string; startAt: string; endAt: string }) =>
  apiFetch<AdminPromotion>(`/admin/brands/${id}/promotions`, { method: 'POST', body });
export const deletePromotion = (id: string) =>
  apiFetch(`/admin/promotions/${id}`, { method: 'DELETE' });
export const listDealerRewards = () => apiFetch<AdminDealerReward[]>('/admin/dealer-rewards');
export const createDealerReward = (body: { brandId?: string; type: 'TOUR' | 'GIFT' | 'OTHER'; title: string; description?: string; threshold: number; period?: string }) =>
  apiFetch<AdminDealerReward>('/admin/dealer-rewards', { method: 'POST', body });
export const deleteDealerReward = (id: string) =>
  apiFetch(`/admin/dealer-rewards/${id}`, { method: 'DELETE' });
