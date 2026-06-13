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
