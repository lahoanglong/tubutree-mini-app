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
}
interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** Fetch catalog server-side (ISR 5 phút). Trả mảng rỗng nếu API chưa chạy. */
export async function getProducts(params: Record<string, string> = {}): Promise<ProductCard[]> {
  const qs = new URLSearchParams({ limit: '30', ...params }).toString();
  try {
    const res = await fetch(`${BASE}/products?${qs}`, serverInit({ revalidate: 300 }));
    if (!res.ok) return [];
    const json = (await res.json()) as Page<ProductCard>;
    return json.data;
  } catch {
    return [];
  }
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  return fetchDetail<ProductDetail>(`/products/${slug}`, 300);
}

export async function getBrands(): Promise<{ brand: string; count: number }[]> {
  try {
    const res = await fetch(`${BASE}/brands`, serverInit({ revalidate: 600 }));
    if (!res.ok) return [];
    return (await res.json()) as { brand: string; count: number }[];
  } catch {
    return [];
  }
}

export async function getStorefront(slug: string): Promise<StorefrontDetail | null> {
  return fetchDetail<StorefrontDetail>(`/storefront/public/${slug}`, 300);
}

/** Danh sách nhẹ gian hàng đã đăng, dùng cho sitemap.ts. Mảng rỗng nếu API chưa chạy. */
export async function getStorefrontList(): Promise<{ slug: string; updatedAt: string }[]> {
  try {
    const res = await fetch(`${BASE}/storefront/public-list`, serverInit({ revalidate: 3600 }));
    if (!res.ok) return [];
    return (await res.json()) as { slug: string; updatedAt: string }[];
  } catch {
    return [];
  }
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
  bankName?: string | null;
  bankBin?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  warehouseAddress?: string | null;
  warehouseCity?: string | null;
  warehouseDistrict?: string | null;
  warehouseWard?: string | null;
  warehousePhone?: string | null;
  ownerTier?: { name: string; emoji: string } | null;
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
