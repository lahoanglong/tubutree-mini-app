// API_BASE_URL (server-runtime, ưu tiên) cho phép đổi endpoint khi deploy mà không rebuild;
// NEXT_PUBLIC_* bị inline lúc build nên chỉ dùng làm fallback.
const BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

/**
 * Mọi request SSR đi ra từ cùng một IP container web, nên nếu bị đếm như khách thì cả site chia
 * chung một bộ đếm throttle. API miễn throttle khi header khớp THROTTLE_BYPASS_TOKEN. Chỉ gửi ở
 * phía server: file này cũng được bundle cho client (formatVnd), và biến không có tiền tố
 * NEXT_PUBLIC_ nên ở trình duyệt vốn đã rỗng — kiểm `window` để không bao giờ phụ thuộc vào đó.
 */
function serverInit(next: { revalidate: number }): RequestInit {
  const token = typeof window === 'undefined' ? process.env.THROTTLE_BYPASS_TOKEN : undefined;
  return token ? { next, headers: { 'x-throttle-bypass': token } } : { next };
}

/** API trả lỗi tạm thời (429/5xx) hoặc không kết nối được — khác hẳn với "không tồn tại". */
export class ApiUnavailableError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(`API ${path} không sẵn sàng (${status ?? 'mất kết nối'})`, options);
    this.name = 'ApiUnavailableError';
  }
}

/**
 * Lấy một tài nguyên cho trang chi tiết. Chỉ 404 mới trả null (trang gọi notFound()); lỗi
 * khác ném ra để Next hiện error boundary và ISR giữ bản đã render, thay vì báo "không tìm
 * thấy" cho Googlebot với một sản phẩm còn bán chỉ vì API đang 429/5xx.
 */
async function fetchDetail<T>(path: string, revalidate: number): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, serverInit({ revalidate }));
  } catch (err) {
    throw new ApiUnavailableError(path, null, { cause: err });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiUnavailableError(path, res.status);
  return (await res.json()) as T;
}

/**
 * Lấy danh sách cho trang ISR. Lỗi lúc runtime phải ném: trả [] sẽ khiến Next lưu bản rỗng tới hết
 * revalidate, còn ném thì Next giữ bản đã render tốt. Riêng `next build` thường chạy khi API chưa
 * lên, nên lúc đó trả [] để build không hỏng (trang được tái tạo ở runtime sau đó).
 */
async function fetchList<T>(path: string, revalidate: number, select: (json: unknown) => T[]): Promise<T[]> {
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, serverInit({ revalidate }));
  } catch (err) {
    if (building) return [];
    throw new ApiUnavailableError(path, null, { cause: err });
  }
  if (!res.ok) {
    if (building) return [];
    throw new ApiUnavailableError(path, res.status);
  }
  return select(await res.json());
}

export interface ProductCard {
  id: string;
  slug: string;
  brand: string;
  name: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  isFeatured: boolean;
  sold?: number;
  inStock: boolean;
  ratingAvg?: number;
  reviewCount?: number;
}
export interface VariationDetail {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}
export interface ProductDetail {
  id: string;
  slug: string;
  brand: string;
  name: string;
  shortDesc: string | null;
  description: string;
  images: string[];
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  certifications: string[];
  variations: VariationDetail[];
  ratingAvg?: number;
  reviewCount?: number;
  fulfilment?: 'TUBU' | 'MERCHANT';
  /** Ai giao (D4): tên gian hàng lấy theo gian hàng hiện tại, phí giao riêng của gian hàng. API cũ chưa trả. */
  fulfiller?: ProductFulfiller;
}

export interface ProductFulfiller {
  kind: 'TUBU' | 'MERCHANT';
  name: string;
  shippingFee: number | null;
  freeShipFrom: number | null;
}

/** Dòng "ai giao" trên trang sản phẩm; null khi API không nói (sản phẩm cũ). */
export function pdpFulfillerText(p: Pick<ProductDetail, 'fulfilment' | 'fulfiller'>): string | null {
  const f = p.fulfiller;
  if (f?.kind === 'TUBU' || (!f && p.fulfilment === 'TUBU')) return 'Tubu Tree giao hàng';
  if (!f && p.fulfilment !== 'MERCHANT') return null;
  const who = f ? `Do ${f.name} giao` : 'Gian hàng đối tác tự giao';
  const fee =
    f?.shippingFee != null
      ? `phí giao ${formatVnd(f.shippingFee)}${f.freeShipFrom != null ? ` (miễn phí từ ${formatVnd(f.freeShipFrom)})` : ''}`
      : 'phí giao riêng';
  return `${who}, đi kiện riêng · ${fee} · thanh toán COD hoặc Ví Tubu, không nhận chuyển khoản`;
}
interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}
export type ProductPage = Page<ProductCard>;

/** 24 chia hết cho 2/3/4 cột của lưới trang chủ nên hàng cuối không bị lẻ. */
export const HOME_PAGE_SIZE = 24;

/** Fetch catalog server-side (ISR 5 phút). Lỗi API: xem fetchList. */
export async function getProducts(params: Record<string, string> = {}): Promise<ProductCard[]> {
  const qs = new URLSearchParams({ limit: '30', ...params }).toString();
  return fetchList<ProductCard>(`/products?${qs}`, 300, (json) => (json as Page<ProductCard>).data);
}

/**
 * Một trang catalog kèm tổng số sản phẩm (meta.total) — trang chủ cần tổng thật để phân trang và để nhãn
 * "N sản phẩm" không chỉ đếm những gì đang hiện. Lỗi API: xem fetchList.
 */
export async function getProductsPage(params: Record<string, string> = {}): Promise<ProductPage> {
  const qs = new URLSearchParams({ limit: String(HOME_PAGE_SIZE), ...params }).toString();
  const [page] = await fetchList<ProductPage>(`/products?${qs}`, 300, (json) => [json as ProductPage]);
  return page ?? { data: [], meta: { page: 1, limit: HOME_PAGE_SIZE, total: 0 } };
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  return fetchDetail<ProductDetail>(`/products/${slug}`, 300);
}

export async function getBrands(): Promise<{ brand: string; count: number }[]> {
  return fetchList<{ brand: string; count: number }>('/brands', 600, (json) => json as { brand: string; count: number }[]);
}

export async function getStorefront(slug: string): Promise<StorefrontDetail | null> {
  return fetchDetail<StorefrontDetail>(`/storefront/public/${slug}`, 300);
}

/** Danh sách nhẹ gian hàng đã đăng, dùng cho sitemap.ts. Lỗi API: xem fetchList. */
export async function getStorefrontList(): Promise<{ slug: string; updatedAt: string }[]> {
  return fetchList<{ slug: string; updatedAt: string }>(
    '/storefront/public-list',
    3600,
    (json) => json as { slug: string; updatedAt: string }[],
  );
}

export interface StorefrontItem {
  id: string;
  note?: string | null;
  variationId?: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    thumbnail?: string | null;
    brand?: string | null;
    basePrice: number;
    salePrice?: number | null;
    ratingAvg?: number | null;
    reviewCount?: number | null;
    sold?: number | null;
  };
}

export interface StorefrontCollection {
  id: string;
  title: string;
  kind?: string | null;
  layout?: string | null;
  comboDiscountPct?: number | null;
  items: StorefrontItem[];
}

export interface StorefrontDetail {
  id: string;
  slug: string;
  subdomain?: string | null;
  customDomain?: string | null;
  type?: string | null;
  title: string;
  headerNote?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  theme?: string | null;
  themeColor?: string | null;
  warehouseAddress?: string | null;
  warehouseCity?: string | null;
  warehouseDistrict?: string | null;
  warehouseWard?: string | null;
  warehousePhone?: string | null;
  ownerTier?: { name: string; emoji: string } | null;
  /** Mã giới thiệu của chủ gian hàng CTV (null với gian hàng khác) — không suy từ slug/subdomain. */
  referralCode?: string | null;
  collections: StorefrontCollection[];
}

export interface BrandDetail {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  tagline?: string | null;
  story?: string | null;
  storyImages: string[];
  origin?: string | null;
  isVerified: boolean;
  followerCount: number;
  certifications: { code: string; label: string; proofUrl?: string | null }[];
  promotions: {
    id: string;
    title: string;
    subtitle?: string | null;
    themeColor?: string | null;
    couponCode?: string | null;
    startAt: string;
    endAt: string;
  }[];
  products: {
    id: string;
    name: string;
    slug: string;
    thumbnail?: string | null;
    basePrice: number;
    salePrice?: number | null;
    ratingAvg?: number | null;
    reviewCount?: number | null;
    sold?: number | null;
  }[];
  dealerRewards: {
    id: string;
    type: string;
    title: string;
    description?: string | null;
    threshold: number;
    period: string;
  }[];
}

export async function getBrand(slug: string): Promise<BrandDetail | null> {
  return fetchDetail<BrandDetail>(`/brand/public/${slug}`, 300);
}

/** Thông tin liên hệ hiển thị ở chân trang. */
export interface SupportContact {
  hotline: string;
  email: string;
  /** Chỉ có khi admin đã cấu hình tên Zalo OA; chưa có OA thì không có trường (Q-17: ẩn). */
  zaloOaName?: string;
}

/** Khớp giá trị mặc định của API (system-config.controller: support.hotline / support.email). */
export const DEFAULT_SUPPORT: SupportContact = { hotline: '0899 149 229', email: 'tubutree@gmail.com' };

/**
 * Hotline/email do admin cấu hình (GET /config/public → support). Chân trang nằm trên MỌI trang
 * nên không được để API chậm/hỏng làm sập hay làm trống nó: lỗi gì cũng rơi về giá trị mặc định,
 * và trường admin để trống (null) chỉ thay đúng trường đó.
 */
export async function getPublicSupport(): Promise<SupportContact> {
  try {
    const res = await fetch(`${BASE}/config/public`, serverInit({ revalidate: 3600 }));
    if (!res.ok) return DEFAULT_SUPPORT;
    const json = (await res.json()) as { support?: { hotline?: string | null; email?: string | null; zaloOaName?: string | null } };
    const zaloOaName = json.support?.zaloOaName?.trim();
    return {
      hotline: json.support?.hotline?.trim() || DEFAULT_SUPPORT.hotline,
      email: json.support?.email?.trim() || DEFAULT_SUPPORT.email,
      ...(zaloOaName ? { zaloOaName } : {}),
    };
  } catch {
    return DEFAULT_SUPPORT;
  }
}

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

/** "Đã bán" kiểu Shopee: <1 ẩn; <1000 "Đã bán 12"; ≥1000 "Đã bán 1,2k+"; ≥1tr "...tr+". */
export function formatSold(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return `Đã bán ${v}`;
  if (v < 1_000_000) return `Đã bán ${trim(v / 1000)}k+`;
  return `Đã bán ${trim(v / 1_000_000)}tr+`;
}
