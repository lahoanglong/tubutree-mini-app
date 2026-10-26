import { apiFetch } from './client-api';
import type { Page } from './admin-client';

export type StorefrontStatusFilter = 'PUBLISHED' | 'PENDING_APPROVAL' | 'DRAFT' | 'TAKEN_DOWN';
export type StorefrontTypeFilter = 'CTV' | 'MERCHANT' | 'BRAND';

export const STOREFRONT_STATUS_FILTERS: { k: StorefrontStatusFilter | ''; label: string }[] = [
  { k: '', label: 'Tất cả' },
  { k: 'PUBLISHED', label: 'Đang đăng' },
  { k: 'PENDING_APPROVAL', label: 'Chờ duyệt' },
  { k: 'DRAFT', label: 'Nháp' },
  { k: 'TAKEN_DOWN', label: 'Đã gỡ' },
];

export const STOREFRONT_TYPE_LABELS: Record<StorefrontTypeFilter, string> = {
  CTV: 'CTV',
  MERCHANT: 'Đối tác',
  BRAND: 'Nhãn hàng',
};

export interface AdminStorefrontOwner {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  isBlocked: boolean;
}

export interface AdminStorefrontRow {
  id: string;
  slug: string;
  title: string;
  type: StorefrontTypeFilter;
  isPartner: boolean;
  /** Gian hàng mẫu do hệ thống tạo để giới thiệu; không phải của khách thật. */
  isSample?: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  approved: boolean;
  approvedAt: string | null;
  takenDownAt: string | null;
  takenDownReason: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUserId: string | null;
  owner: AdminStorefrontOwner | null;
  itemCount: number;
  /** Khách thấy gian hàng này ngay bây giờ. */
  publicVisible: boolean;
  /** Vì sao gian hàng đã đăng mà khách không thấy (chủ bị khoá, bị hạ vai trò, bị gỡ, chờ duyệt). */
  hiddenReason: string | null;
}

export interface AdminStorefrontDetail extends AdminStorefrontRow {
  headerNote: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  subdomain: string | null;
  collections: {
    id: string;
    title: string;
    items: { id: string; productId: string; productName: string; productSlug: string; note: string | null; isHidden: boolean; isPinned: boolean }[];
  }[];
}

export const STOREFRONT_PAGE_SIZE = 50;

export const listAdminStorefronts = (
  page: number,
  filter: { status?: StorefrontStatusFilter | ''; type?: StorefrontTypeFilter | ''; q?: string },
) => {
  const sp = new URLSearchParams({ page: String(page), limit: String(STOREFRONT_PAGE_SIZE) });
  if (filter.status) sp.set('status', filter.status);
  if (filter.type) sp.set('type', filter.type);
  if (filter.q?.trim()) sp.set('q', filter.q.trim());
  return apiFetch<Page<AdminStorefrontRow>>(`/admin/storefronts?${sp.toString()}`);
};

export const getAdminStorefront = (id: string) => apiFetch<AdminStorefrontDetail>(`/admin/storefronts/${id}`);

export const takeDownStorefront = (id: string, reason: string) =>
  apiFetch<AdminStorefrontRow>(`/admin/storefronts/${id}/take-down`, { method: 'POST', body: { reason } });

export const reinstateStorefront = (id: string) => apiFetch<AdminStorefrontRow>(`/admin/storefronts/${id}/reinstate`, { method: 'POST' });

export const approveStorefront = (id: string, approved: boolean) =>
  apiFetch<AdminStorefrontRow>(`/admin/storefronts/${id}/approval`, { method: 'POST', body: { approved } });
