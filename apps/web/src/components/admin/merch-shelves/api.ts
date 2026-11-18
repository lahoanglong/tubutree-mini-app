import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { apiFetch } from '@/lib/client-api';

/** Kiểu khớp `apps/api/src/modules/merch-shelves/merch-shelves.service.ts` (khai lại vì shared-types nằm ngoài phạm vi wave này). */
export type MerchShelfKind = 'home' | 'best_sellers' | 'category';
export type MerchPinWarning = 'NOT_ON_SALE' | 'OUT_OF_STOCK' | 'NO_IMAGE' | 'NO_SHORT_DESC' | 'NO_CATEGORY' | 'OUTSIDE_CATEGORY';

export interface MerchShelfStatus {
  /** Cờ `merch.shelves_enabled`: tắt thì khách chưa thấy món ghim. */
  enabled: boolean;
  /** Bảng Bán chạy nhất chưa đủ số bán thật: kệ `best_sellers` (nếu có ghim) hiện "Tubu chọn cho bạn". */
  curated: boolean;
}

export interface MerchShelfSummary {
  key: string;
  label: string;
  kind: MerchShelfKind;
  pinCount: number;
}

export interface MerchProductView {
  productId: string;
  name: string;
  brand: string;
  slug: string;
  thumbnail: string | null;
  warnings: MerchPinWarning[];
  /** Thẻ cửa hàng của món; null khi khách không thấy món (đang ẩn, chưa duyệt). */
  card: ProductCard | null;
}

export interface MerchPinView extends MerchProductView {
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  live: boolean;
}

export interface MerchShelfView {
  key: string;
  label: string;
  version: string;
  maxPins: number;
  status: MerchShelfStatus;
  pins: MerchPinView[];
}

export interface EmptyEntrance {
  key: string;
  label: string;
  detail: string;
  adminTab: string | null;
}

export interface MerchPinInput {
  productId: string;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
}

const BASE = '/admin/merch-shelves';
const keyQuery = (key: string) => `key=${encodeURIComponent(key)}`;

// Kệ vừa lưu phải đọc bản mới nhất, nên không cho trình duyệt dùng lại bản đã nhớ.
export const getMerchOverview = () => apiFetch<{ status: MerchShelfStatus; shelves: MerchShelfSummary[] }>(BASE, { cache: 'no-store' });

export const getMerchShelf = (key: string) => apiFetch<MerchShelfView>(`${BASE}/shelf?${keyQuery(key)}`, { cache: 'no-store' });

/** Lưu cả kệ theo thứ tự `pins`; kệ đã bị người khác lưu sau lần đọc `version` thì máy chủ trả 409 (`SHELF_CHANGED`). */
export const saveMerchShelf = (key: string, version: string, pins: readonly MerchPinInput[]) =>
  apiFetch<MerchShelfView>(`${BASE}/shelf`, { method: 'PUT', body: { key, version, pins } });

/** Chỉ đọc: máy chủ không ghi gì, admin xem rồi tự thêm vào bản nháp. */
export const suggestMerchPins = (key: string, exclude: readonly string[]) =>
  apiFetch<{ items: MerchProductView[] }>(`${BASE}/suggest?${keyQuery(key)}${exclude.length > 0 ? `&exclude=${encodeURIComponent(exclude.join(','))}` : ''}`, {
    cache: 'no-store',
  });

export const getMerchProduct = (productId: string, key: string) =>
  apiFetch<MerchProductView>(`${BASE}/product?productId=${encodeURIComponent(productId)}&${keyQuery(key)}`, { cache: 'no-store' });

export const getEmptyEntrances = () => apiFetch<{ checkedAt: string; entrances: EmptyEntrance[] }>(`${BASE}/empty-entrances`, { cache: 'no-store' });
