import type { HttpClient } from '../http';
import type { StorefrontStatusCode } from '../storefront-signup';

export interface StorefrontItem {
  id: string;
  note: string | null;
  variationId: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    thumbnail: string | null;
    brand: string;
    basePrice: number;
    salePrice: number | null;
    ratingAvg: number;
    reviewCount: number;
    sold?: number;
    inStock: boolean;
  };
}
export interface StorefrontItemEdit extends StorefrontItem {
  isPinned: boolean;
  isHidden: boolean;
  sortOrder: number;
  productId: string;
  /** Lý do khách không thấy món này (null = khách thấy); món vừa thêm chưa có trường này cho tới lần tải lại. */
  hiddenReason?: string | null;
}
export interface StorefrontCollection {
  id: string;
  title: string;
  kind: 'NORMAL' | 'COMBO';
  layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct: number | null;
  items: StorefrontItem[];
}
export interface StorefrontCollectionEdit extends Omit<StorefrontCollection, 'items'> {
  sortOrder: number;
  items: StorefrontItemEdit[];
}
export interface Storefront {
  id: string;
  slug: string;
  subdomain?: string | null;
  customDomain?: string | null;
  type: 'CTV' | 'BRAND' | 'MERCHANT';
  isPartner?: boolean;
  /** Gian hàng mẫu (chỉ có trên máy thử): hiện nhãn "Gian hàng mẫu". */
  isSample?: boolean;
  title: string;
  headerNote: string | null;
  /** Mã giới thiệu của chủ gian hàng CTV (API trả ở trang công khai; null với gian hàng khác). */
  referralCode?: string | null;
  ownerTier: { name: string; emoji: string } | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  theme: string;
  themeColor?: string | null;
  bankName?: string | null;
  bankBin?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  warehouseAddress?: string | null;
  warehouseCity?: string | null;
  warehouseDistrict?: string | null;
  warehouseWard?: string | null;
  warehousePhone?: string | null;
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
  /** Trạng thái do API tính cho chủ (DRAFT, PENDING_APPROVAL, LIVE, TAKEN_DOWN, HIDDEN); API cũ có thể chưa trả. */
  status?: StorefrontStatusCode;
  /** Gian hàng còn phải qua Tubu duyệt trước khi khách thấy (cờ duyệt bật và chưa được duyệt); API cũ chưa trả. */
  needsApproval?: boolean;
  /** Lý do khách không thấy gian hàng dù đã đăng (bị gỡ, chủ không còn là CTV…); null khi khách thấy bình thường. */
  publicHiddenReason?: string | null;
  collections: StorefrontCollectionEdit[];
}
export interface PickerProduct {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  brand: string;
  basePrice: number;
  salePrice: number | null;
  ratingAvg: number;
  reviewCount: number;
  maxAffiliateRate: number;
}

export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  image: string | null;
}
/** Danh mục sản phẩm hiện có — dùng làm danh sách mẫu gian hàng (mỗi mẫu = 1 danh mục). */
export const getStorefrontCategories = (http: HttpClient) =>
  http.get<StorefrontCategory[]>('/categories');
export const applyStorefrontTemplate = (http: HttpClient, categoryId: string) =>
  http.post<{ collectionId: string; title: string; itemCount: number }>(
    '/storefront/me/apply-template',
    { categoryId },
  );

export const createStorefront = (http: HttpClient) => http.post<StorefrontEdit>('/storefront');
/** null khi khách chưa có gian hàng (máy chủ trả 200 rỗng, không 404). */
export const getMyStorefront = (http: HttpClient) => http.get<StorefrontEdit | null>('/storefront/me');
export const getPublicStorefront = (http: HttpClient, slug: string) =>
  http.get<Storefront>(`/storefront/public/${slug}`);
export const updateStorefront = (
  http: HttpClient,
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
) => http.patch<StorefrontEdit>('/storefront/me', dto);
export const publishStorefront = (http: HttpClient, isPublished: boolean) =>
  http.post<StorefrontEdit>('/storefront/me/publish', { isPublished });

export const createCollection = (
  http: HttpClient,
  dto: {
    title: string;
    kind?: 'NORMAL' | 'COMBO';
    layout?: 'GRID' | 'CAROUSEL' | 'STACK';
    comboDiscountPct?: number;
  },
) => http.post<StorefrontCollectionEdit>('/storefront/me/collections', dto);
export const updateCollection = (
  http: HttpClient,
  id: string,
  dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
) => http.patch(`/storefront/me/collections/${id}`, dto);
export const deleteCollection = (http: HttpClient, id: string) =>
  http.delete(`/storefront/me/collections/${id}`);

export const addItem = (
  http: HttpClient,
  collectionId: string,
  dto: { productId: string; variationId?: string; note?: string },
) => http.post<StorefrontItemEdit>(`/storefront/me/collections/${collectionId}/items`, dto);
export const updateItem = (
  http: HttpClient,
  id: string,
  dto: { note?: string; isPinned?: boolean; isHidden?: boolean },
) => http.patch(`/storefront/me/items/${id}`, dto);
export const removeItem = (http: HttpClient, id: string) =>
  http.delete(`/storefront/me/items/${id}`);
export const pickerProducts = (http: HttpClient, search?: string) =>
  http.get<PickerProduct[]>('/storefront/me/products', { query: { search } });

export interface StorefrontQuest {
  code: string;
  title: string;
  hint: string;
  goal: number;
  rewardPoints: number;
  progress: number;
  done: boolean;
  claimed: boolean;
}
export interface QuestList {
  quests: StorefrontQuest[];
  totalEarnedPoints: number;
  level: number;
  levelMax: number;
}

export interface StorefrontProductStat {
  productSlug: string;
  productName: string;
  qty: number;
  revenue: number;
}
export interface StorefrontStats {
  orders7d: number;
  orders30d: number;
  revenue30d: number;
  commission30d: number;
  byProduct: StorefrontProductStat[];
  /**
   * revenue30d − tổng byProduct.revenue: phí ship, giảm giá cấp đơn và chênh lệch giữa tiền hoàn thực tế với phần trừ theo tỷ lệ
   * dòng (trả 1/2 dòng 200k mà hoàn 80k thì dòng này +20k). Có thể âm.
   */
  shippingAndOrderDiscount30d?: number;
}
export const getStorefrontStats = (http: HttpClient) =>
  http.get<StorefrontStats>('/storefront/me/stats');

export const getQuests = (http: HttpClient) => http.get<QuestList>('/storefront/me/quests');
export const claimQuest = (http: HttpClient, code: string) =>
  http.post<{ claimed: boolean; code: string; rewardPoints: number; pointsBalance: number }>(
    `/storefront/me/quests/${code}/claim`,
  );
