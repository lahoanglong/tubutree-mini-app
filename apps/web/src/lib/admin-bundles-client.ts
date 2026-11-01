import { apiFetch } from './client-api';

export type AdminBundleKind = 'BUNDLE_PCT' | 'ADDON';
export type AdminBundleStatus = 'live' | 'scheduled' | 'ended' | 'off';

export interface AdminBundleItem {
  productId: string;
  productName: string;
  productSlug: string;
  variationId: string | null;
  variationName: string | null;
  addonPrice: number | null;
  maxQty: number;
  /** Giá đang bán của món (phân loại ghim hoặc đại diện), để form báo mức giảm. */
  price: number;
}

export interface AdminBundle {
  id: string;
  kind: AdminBundleKind;
  title: string;
  pct: number | null;
  anchorProductId: string | null;
  anchorProductName: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  sortOrder: number;
  status: AdminBundleStatus;
  createdById: string | null;
  /** Nhân viên chỉ sửa/xoá được bộ do nhân viên tạo: màn quản trị khoá nút khi false. */
  createdByStaff: boolean;
  items: AdminBundleItem[];
}

export interface AdminBundleItemInput {
  productId: string;
  variationId?: string | null;
  addonPrice?: number | null;
  maxQty?: number;
}

export interface AdminBundleInput {
  kind: AdminBundleKind;
  title: string;
  pct?: number;
  anchorProductId?: string;
  startAt: string;
  endAt: string;
  isActive?: boolean;
  sortOrder?: number;
  items: AdminBundleItemInput[];
}

/** Sửa không đổi `kind` (đổi loại là tạo bộ mới); có `items` thì thay cả danh sách món. */
export type AdminBundlePatch = Partial<Omit<AdminBundleInput, 'kind'>>;

const BASE = '/admin/bundles';
const path = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const listAdminBundles = (status?: AdminBundleStatus) => apiFetch<AdminBundle[]>(status ? `${BASE}?status=${status}` : BASE);
export const getAdminBundle = (id: string) => apiFetch<AdminBundle>(path(id));
export const createAdminBundle = (body: AdminBundleInput) => apiFetch<AdminBundle>(BASE, { method: 'POST', body });
export const updateAdminBundle = (id: string, body: AdminBundlePatch) => apiFetch<AdminBundle>(path(id), { method: 'PATCH', body });
export const deleteAdminBundle = (id: string) => apiFetch<{ ok: boolean }>(path(id), { method: 'DELETE' });
