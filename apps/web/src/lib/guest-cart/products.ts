'use client';

import { useQueries } from '@tanstack/react-query';
import type { ProductDetail } from '../api';
import { ApiError, apiFetch } from '../client-api';

export const guestProductKey = (slug: string) => ['guest-cart-product', slug] as const;

/** Chi tiết công khai của một món trong giỏ khách; 404 (sản phẩm đã gỡ) trả null, lỗi khác ném để màn cho thử lại. */
export async function fetchGuestProduct(slug: string): Promise<ProductDetail | null> {
  try {
    return await apiFetch<ProductDetail>(`/products/${encodeURIComponent(slug)}`, { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export type GuestProductState =
  | { status: 'loading' }
  | { status: 'error'; refetch: () => void }
  | { status: 'missing' }
  | { status: 'ok'; product: ProductDetail };

/** Một request cho mỗi sản phẩm (không theo phân loại); giá và tồn không lưu ở máy khách nên luôn lấy lại khi mở giỏ. */
export function useGuestCartProducts(slugs: readonly string[]): ReadonlyMap<string, GuestProductState> {
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: guestProductKey(slug),
      queryFn: () => fetchGuestProduct(slug),
      staleTime: 30_000,
      retry: 1,
    })),
  });
  const out = new Map<string, GuestProductState>();
  slugs.forEach((slug, i) => {
    const q = results[i]!;
    if (q.data === null) out.set(slug, { status: 'missing' });
    else if (q.data) out.set(slug, { status: 'ok', product: q.data });
    else if (q.isError) out.set(slug, { status: 'error', refetch: () => void q.refetch() });
    else out.set(slug, { status: 'loading' });
  });
  return out;
}
