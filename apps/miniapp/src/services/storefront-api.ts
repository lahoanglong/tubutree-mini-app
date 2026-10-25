import { api } from './api';
import type { StorefrontStatusCode } from '@tubutree/app-core/storefront-signup';

export interface StorefrontItem {
  id: string;
  note: string | null;
  variationId: string | null;
  product: {
    id: string; name: string; slug: string; thumbnail: string | null; brand: string;
    basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number; sold?: number;
    inStock: boolean;
  };
}
export interface StorefrontItemEdit extends StorefrontItem {
  isPinned: boolean; isHidden: boolean; sortOrder: number; productId: string;
  /** Lý do khách không thấy món này (null = khách thấy); món vừa thêm chưa có trường này cho tới lần tải lại. */
  hiddenReason?: string | null;
}
export interface StorefrontCollection {
  id: string; title: string; kind: 'NORMAL' | 'COMBO'; layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct: number | null; items: StorefrontItem[];
}
export interface StorefrontCollectionEdit extends Omit<StorefrontCollection, 'items'> { sortOrder: number; items: StorefrontItemEdit[]; }
export interface Storefront {
  id: string; slug: string; subdomain?: string | null; customDomain?: string | null;
  type: 'CTV' | 'BRAND' | 'MERCHANT'; isPartner?: boolean;
  /** Gian hàng mẫu (chỉ có trên máy thử): hiện nhãn "Gian hàng mẫu". */
  isSample?: boolean;
  title: string; headerNote: string | null;
  /** Mã giới thiệu của chủ gian hàng CTV (API trả ở trang công khai; null với gian hàng khác). */
  referralCode?: string | null;
  ownerTier: { name: string; emoji: string } | null;
  avatarUrl: string | null; coverUrl: string | null; theme: string; themeColor?: string | null;
  bankName?: string | null; bankBin?: string | null; bankAccountNo?: string | null; bankAccountName?: string | null;
  warehouseAddress?: string | null; warehouseCity?: string | null; warehouseDistrict?: string | null; warehouseWard?: string | null; warehousePhone?: string | null;
  /** Admin đã duyệt gian hàng: chỉ khi đó mới có nhãn "CTV tuyển chọn". */
  approved?: boolean;
  /** Cờ link subdomain; tắt thì `subdomain`/`customDomain` luôn null và chỉ dùng /s/<slug>. */
  subdomainEnabled?: boolean;
  collections: StorefrontCollection[];
}
// GET /storefront/me KHÔNG trả ownerTier (chỉ trang công khai getPublicBySlug mới tính bậc) —
// loại field này khỏi view chỉnh sửa để type khớp đúng response thật.
export interface StorefrontEdit extends Omit<Storefront, 'collections' | 'ownerTier'> {
  isPublished: boolean;
  /** Trạng thái do API tính cho chủ; API cũ chưa trả thì màn suy từ isPublished. */
  status?: StorefrontStatusCode;
  /** Lý do khách không thấy gian hàng dù đã đăng (bị gỡ, chủ không còn là CTV…); null khi khách thấy bình thường. */
  publicHiddenReason?: string | null;
  collections: StorefrontCollectionEdit[];
}
export interface PickerProduct {
  id: string; name: string; slug: string; thumbnail: string | null; brand: string;
  basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number; maxAffiliateRate: number;
}

export interface StorefrontCategory { id: string; name: string; slug: string; image: string | null }
/** Danh mục sản phẩm hiện có — dùng làm danh sách mẫu gian hàng (mỗi mẫu = 1 danh mục). */
export const getStorefrontCategories = () => api.get('/categories').then((r) => r.data as StorefrontCategory[]);
export const applyStorefrontTemplate = (categoryId: string) =>
  api.post('/storefront/me/apply-template', { categoryId }).then((r) => r.data as { collectionId: string; title: string; itemCount: number });

export const createStorefront = () => api.post('/storefront').then((r) => r.data as StorefrontEdit);
export const getMyStorefront = () => api.get('/storefront/me').then((r) => r.data as StorefrontEdit);
export const getPublicStorefront = (slug: string) => api.get(`/storefront/public/${slug}`).then((r) => r.data as Storefront);
export const updateStorefront = (
  dto: Partial<
    Pick<
      Storefront,
      | 'title'
      | 'headerNote'
      | 'avatarUrl'
      | 'coverUrl'
      | 'theme'
      | 'themeColor'
      | 'subdomain'
      | 'bankName'
      | 'bankBin'
      | 'bankAccountNo'
      | 'bankAccountName'
      | 'warehouseAddress'
      | 'warehouseCity'
      | 'warehouseDistrict'
      | 'warehouseWard'
      | 'warehousePhone'
    >
  >,
) => api.patch('/storefront/me', dto).then((r) => r.data as StorefrontEdit);
export const publishStorefront = (isPublished: boolean) =>
  api.post('/storefront/me/publish', { isPublished }).then((r) => r.data as StorefrontEdit);

export const createCollection = (dto: { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.post('/storefront/me/collections', dto).then((r) => r.data as StorefrontCollectionEdit);
export const updateCollection = (id: string, dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.patch(`/storefront/me/collections/${id}`, dto).then((r) => r.data);
export const deleteCollection = (id: string) => api.delete(`/storefront/me/collections/${id}`).then((r) => r.data);

export const addItem = (collectionId: string, dto: { productId: string; variationId?: string; note?: string }) =>
  api.post(`/storefront/me/collections/${collectionId}/items`, dto).then((r) => r.data as StorefrontItemEdit);
export const updateItem = (id: string, dto: { note?: string; isPinned?: boolean; isHidden?: boolean }) =>
  api.patch(`/storefront/me/items/${id}`, dto).then((r) => r.data);
export const removeItem = (id: string) => api.delete(`/storefront/me/items/${id}`).then((r) => r.data);
export const pickerProducts = (search?: string) =>
  api.get('/storefront/me/products', { params: { search } }).then((r) => r.data as PickerProduct[]);

export interface StorefrontQuest {
  code: string; title: string; hint: string; goal: number; rewardPoints: number;
  progress: number; done: boolean; claimed: boolean;
}
export interface QuestList { quests: StorefrontQuest[]; totalEarnedPoints: number; level: number; levelMax: number; }

export interface StorefrontProductStat { productSlug: string; productName: string; qty: number; revenue: number }
export interface StorefrontStats {
  orders7d: number; orders30d: number; revenue30d: number; commission30d: number;
  byProduct: StorefrontProductStat[];
  /**
   * revenue30d − tổng byProduct.revenue: phí ship, giảm giá cấp đơn và chênh lệch giữa tiền hoàn thực tế với phần trừ theo tỷ lệ
   * dòng (trả 1/2 dòng 200k mà hoàn 80k thì dòng này +20k). Có thể âm.
   */
  shippingAndOrderDiscount30d?: number;
}
export const getStorefrontStats = () => api.get('/storefront/me/stats').then((r) => r.data as StorefrontStats);

export const getQuests = () => api.get('/storefront/me/quests').then((r) => r.data as QuestList);
export const claimQuest = (code: string) =>
  api.post(`/storefront/me/quests/${code}/claim`).then((r) => r.data as { claimed: boolean; code: string; rewardPoints: number; pointsBalance: number });
