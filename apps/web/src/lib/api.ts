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

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}
