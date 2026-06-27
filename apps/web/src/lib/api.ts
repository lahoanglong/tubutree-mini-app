// API_BASE_URL (server-runtime, ưu tiên) cho phép đổi endpoint khi deploy mà không rebuild;
// NEXT_PUBLIC_* bị inline lúc build nên chỉ dùng làm fallback.
const BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export interface ProductCard {
  id: string;
  slug: string;
  brand: string;
  name: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  isFeatured: boolean;
  inStock: boolean;
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
    const res = await fetch(`${BASE}/products?${qs}`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const json = (await res.json()) as Page<ProductCard>;
    return json.data;
  } catch {
    return [];
  }
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  try {
    const res = await fetch(`${BASE}/products/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as ProductDetail;
  } catch {
    return null;
  }
}

export async function getBrands(): Promise<{ brand: string; count: number }[]> {
  try {
    const res = await fetch(`${BASE}/brands`, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    return (await res.json()) as { brand: string; count: number }[];
  } catch {
    return [];
  }
}

export async function getStorefront(slug: string): Promise<StorefrontDetail | null> {
  try {
    const res = await fetch(`${BASE}/storefront/public/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as StorefrontDetail;
  } catch {
    return null;
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
  type?: string | null;
  title: string;
  headerNote?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  theme?: string | null;
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
  try {
    const res = await fetch(`${BASE}/brand/public/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as BrandDetail;
  } catch {
    return null;
  }
}

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}
