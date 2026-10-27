import { resolveServedMedia } from '@tubutree/app-core/served-media';
import { formatVnd } from './format-vnd';
import { DEFAULT_LEGAL_VARS, type LegalVars } from './legal';
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
  return resolveServedMedia(await res.json(), PUBLIC_API_BASE) as T;
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
  return select(resolveServedMedia(await res.json(), PUBLIC_API_BASE));
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
  /** Slug trang nhãn hàng (/brand/:slug) khi nhãn đã công khai; null/thiếu → tên nhãn chỉ là chữ. */
  brandSlug?: string | null;
  variations: VariationDetail[];
  ratingAvg?: number;
  reviewCount?: number;
  /** Số đã bán; API cũ chưa trả. */
  sold?: number;
  /** Thành phần (niềm tin cho khách ngại hoá chất); null/thiếu thì không hiện mục. */
  ingredients?: { name: string; percentage?: string; benefit?: string }[] | null;
  fulfilment?: 'TUBU' | 'MERCHANT';
  /** Ai giao (D4): tên gian hàng lấy theo gian hàng hiện tại, phí giao riêng của gian hàng. API cũ chưa trả. */
  fulfiller?: ProductFulfiller;
  /** Hàng của gian hàng đối tác (tự giao hoặc Tubu giao hộ): chỉ bán giá lẻ, không dùng Điểm Xanh. API cũ chưa trả → hàng Tubu. */
  partnerOwned?: boolean;
}

export interface ProductFulfiller {
  /** UNAVAILABLE: gian hàng tạm nghỉ hoặc đã ngừng bán nên chưa nhận đơn (xem `reason`). */
  kind: 'TUBU' | 'MERCHANT' | 'UNAVAILABLE';
  name: string;
  shippingFee: number | null;
  freeShipFrom: number | null;
  reason?: 'STORE_PAUSED' | 'STORE_CLOSED';
}

/** Gian hàng chưa nhận đơn: câu báo cho khách và tắt nút mua; null khi mua được. */
export function pdpUnavailableText(p: Pick<ProductDetail, 'fulfiller'>): string | null {
  const f = p.fulfiller;
  if (f?.kind !== 'UNAVAILABLE') return null;
  const who = f.name || 'Gian hàng';
  return f.reason === 'STORE_PAUSED' ? `${who} đang tạm nghỉ, chưa nhận đơn.` : `${who} đã ngừng bán trên Tubu Tree.`;
}

/** Dòng "ai giao" trên trang sản phẩm; null khi API không nói (sản phẩm cũ) hoặc gian hàng chưa nhận đơn. */
export function pdpFulfillerText(p: Pick<ProductDetail, 'fulfilment' | 'fulfiller'>): string | null {
  const f = p.fulfiller;
  if (f?.kind === 'UNAVAILABLE') return null;
  if (f?.kind === 'TUBU' || (!f && p.fulfilment === 'TUBU')) return 'Tubu Tree giao hàng';
  if (!f && p.fulfilment !== 'MERCHANT') return null;
  const who = f ? `Do ${f.name} giao` : 'Gian hàng đối tác tự giao';
  const fee =
    f?.shippingFee != null
      ? `phí giao ${formatVnd(f.shippingFee)}${f.freeShipFrom != null ? ` (miễn phí từ ${formatVnd(f.freeShipFrom)})` : ''}`
      : 'phí giao riêng';
  return `${who}, đi kiện riêng · ${fee} · thanh toán COD hoặc Ví Tubu, không nhận chuyển khoản`;
}
/** Khách phải biết từ trang sản phẩm: hàng của gian hàng đối tác chỉ bán giá lẻ và không dùng Điểm Xanh (D4). null = hàng Tubu. */
export function pdpPartnerNote(p: Pick<ProductDetail, 'partnerOwned' | 'fulfilment' | 'fulfiller'>): string | null {
  const partner = p.partnerOwned === true || p.fulfiller?.kind === 'MERCHANT' || (!p.fulfiller && p.fulfilment === 'MERCHANT');
  return partner ? 'Hàng của gian hàng đối tác: chỉ bán theo giá lẻ, không dùng Điểm Xanh.' : null;
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

export interface BrandCount {
  brand: string;
  count: number;
  /** Slug trang /brand/:slug khi nhãn đã công khai; API cũ chưa trả → không có liên kết. */
  slug?: string | null;
}
export async function getBrands(): Promise<BrandCount[]> {
  return fetchList<BrandCount>('/brands', 600, (json) => json as BrandCount[]);
}

/**
 * Ảnh do chính API phục vụ (ảnh gian hàng base64) về JSON dưới dạng đường dẫn tương đối API. Ghép với gốc API CÔNG KHAI cho
 * thẻ img và thẻ chia sẻ (không dùng API_BASE_URL: giá trị đó có thể là địa chỉ nội bộ giữa các container mà trình duyệt không tới được).
 */
export const PUBLIC_API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
export function publicMediaUrl<T extends string | null | undefined>(src: T): T | string {
  return typeof src === 'string' && src.startsWith('/') && !src.startsWith('//') ? `${PUBLIC_API_BASE}${src}` : src;
}

export interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  /** Số sản phẩm đang bán; API cũ chưa trả thì thiếu. */
  productCount?: number;
}
export async function getCategories(): Promise<CategoryItem[]> {
  return fetchList<CategoryItem>('/categories', 600, (json) => json as CategoryItem[]);
}

export async function getStorefront(slug: string): Promise<StorefrontDetail | null> {
  const sf = await fetchDetail<StorefrontDetail>(`/storefront/public/${slug}`, 300);
  if (!sf) return sf;
  return { ...sf, ...(sf.avatarUrl !== undefined && { avatarUrl: publicMediaUrl(sf.avatarUrl) }), ...(sf.coverUrl !== undefined && { coverUrl: publicMediaUrl(sf.coverUrl) }) };
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
  isPartner?: boolean;
  /** Admin đã duyệt gian hàng (tick xanh, "CTV tuyển chọn"). API cũ chưa trả thì coi như chưa duyệt. */
  approved?: boolean;
  /** Gian hàng mẫu của máy thử: khách thấy nhãn "Gian hàng mẫu". */
  isSample?: boolean;
  /** Cờ link `<tên>.tubutree.com`: tắt (hoặc API cũ chưa trả) thì không hiện URL subdomain. */
  subdomainEnabled?: boolean;
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
  return fetchDetail<BrandDetail>(`/brand/public/${slug}`, 60);
}

/** Thông tin liên hệ hiển thị ở chân trang. */
export interface SupportContact {
  hotline: string;
  email: string;
  /** Chỉ có khi admin đã cấu hình tên Zalo OA; chưa có OA thì không có trường (Q-17: ẩn). */
  zaloOaName?: string;
  /** Kênh cộng đồng của chủ shop; chỉ có khoá nào admin đã nhập link https. */
  community?: { zaloGroupUrl?: string; facebookUrl?: string; tiktokUrl?: string };
  /** Đơn vị vận hành; chỉ có trường admin đã nhập (BCT chỉ nhận link https). */
  company?: { legalName?: string; taxCode?: string; address?: string; bctNoticeUrl?: string };
}

const trimmed = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const httpsOnly = (v: unknown): string | undefined => (typeof v === 'string' && /^https:\/\//.test(v.trim()) ? v.trim() : undefined);

/** Khớp giá trị mặc định của API (system-config.controller: support.hotline / support.email). */
export const DEFAULT_SUPPORT: SupportContact = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };

/**
 * Hotline/email do admin cấu hình (GET /config/public → support). Chân trang nằm trên MỌI trang
 * nên không được để API chậm/hỏng làm sập hay làm trống nó: lỗi gì cũng rơi về giá trị mặc định,
 * và trường admin để trống (null) chỉ thay đúng trường đó.
 */
export async function getPublicSupport(): Promise<SupportContact> {
  try {
    const res = await fetch(`${BASE}/config/public`, serverInit({ revalidate: 3600 }));
    if (!res.ok) return DEFAULT_SUPPORT;
    const json = (await res.json()) as { support?: { hotline?: string | null; email?: string | null; zaloOaName?: string | null }; community?: { zaloGroupUrl?: unknown; facebookUrl?: unknown; tiktokUrl?: unknown }; company?: { legalName?: unknown; taxCode?: unknown; address?: unknown; bctNoticeUrl?: unknown } };
    const community = Object.fromEntries(
      (['zaloGroupUrl', 'facebookUrl', 'tiktokUrl'] as const).flatMap((k) => {
        const u = httpsOnly(json.community?.[k]);
        return u ? [[k, u]] : [];
      }),
    );
    const zaloOaName = json.support?.zaloOaName?.trim();
    const company = {
      ...(trimmed(json.company?.legalName) ? { legalName: trimmed(json.company?.legalName) } : {}),
      ...(trimmed(json.company?.taxCode) ? { taxCode: trimmed(json.company?.taxCode) } : {}),
      ...(trimmed(json.company?.address) ? { address: trimmed(json.company?.address) } : {}),
      ...(httpsOnly(json.company?.bctNoticeUrl) ? { bctNoticeUrl: httpsOnly(json.company?.bctNoticeUrl) } : {}),
    };
    return {
      hotline: json.support?.hotline?.trim() || DEFAULT_SUPPORT.hotline,
      email: json.support?.email?.trim() || DEFAULT_SUPPORT.email,
      ...(zaloOaName ? { zaloOaName } : {}),
      ...(Object.keys(community).length ? { community } : {}),
      ...(Object.keys(company).length ? { company } : {}),
    };
  } catch {
    return DEFAULT_SUPPORT;
  }
}

/** Số ngày đổi trả (returns.window_days) cho trang server; không đọc được thì undefined để chữ nói chung, không số. */
export async function getReturnWindowDays(): Promise<number | undefined> {
  try {
    const res = await fetch(`${BASE}/config/public`, serverInit({ revalidate: 3600 }));
    if (!res.ok) return undefined;
    const json = (await res.json()) as { returnWindowDays?: unknown };
    return typeof json.returnWindowDays === 'number' ? json.returnWindowDays : undefined;
  } catch {
    return undefined;
  }
}

export interface LegalDoc {
  /** Markdown admin đã nhập; null = chưa nhập, trang dùng bản nháp mặc định. */
  content: string | null;
  vars: LegalVars;
}

/** 0 hợp lệ (freeship mọi đơn, hạn đổi trả 0 ngày); null, rỗng, sai kiểu, âm thì mặc định. */
function nonNegativeOr(v: unknown, fallback: number): number {
  if (typeof v !== 'number' && typeof v !== 'string') return fallback;
  if (typeof v === 'string' && v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Nội dung trang /chinh-sach/[loai] (GET /config/legal/:loai). 404 (API bản cũ chưa có endpoint) coi như admin chưa nhập.
 * Lỗi tạm thời thì ném: ISR giữ bản đã render thay vì thay nội dung đã duyệt bằng bản nháp.
 */
export async function getLegalDoc(loai: string): Promise<LegalDoc> {
  const json = await fetchDetail<{ content?: unknown; vars?: { returnWindowDays?: unknown; freeshipThreshold?: unknown; shippingFlatFee?: unknown; legalName?: unknown; taxCode?: unknown; address?: unknown } }>(
    `/config/legal/${encodeURIComponent(loai)}`,
    300,
  );
  return {
    content: typeof json?.content === 'string' && json.content.trim() !== '' ? json.content : null,
    vars: {
      returnWindowDays: nonNegativeOr(json?.vars?.returnWindowDays, DEFAULT_LEGAL_VARS.returnWindowDays),
      freeshipThreshold: nonNegativeOr(json?.vars?.freeshipThreshold, DEFAULT_LEGAL_VARS.freeshipThreshold),
      shippingFlatFee: nonNegativeOr(json?.vars?.shippingFlatFee, DEFAULT_LEGAL_VARS.shippingFlatFee ?? 0),
      ...(trimmed(json?.vars?.legalName) ? { legalName: trimmed(json?.vars?.legalName) } : {}),
      ...(trimmed(json?.vars?.taxCode) ? { taxCode: trimmed(json?.vars?.taxCode) } : {}),
      ...(trimmed(json?.vars?.address) ? { address: trimmed(json?.vars?.address) } : {}),
    },
  };
}

export { formatVnd };

/** "Đã bán" kiểu Shopee: <1 ẩn; <1000 "Đã bán 12"; ≥1000 "Đã bán 1,2k+"; ≥1tr "...tr+". */
export function formatSold(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return `Đã bán ${v}`;
  if (v < 1_000_000) return `Đã bán ${trim(v / 1000)}k+`;
  return `Đã bán ${trim(v / 1_000_000)}tr+`;
}
