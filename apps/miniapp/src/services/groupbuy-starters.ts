import { api } from './api';
import type { PageResponse, ProductCard } from './shop-api';

/**
 * Kệ sản phẩm đủ điều kiện mở nhóm Mua chung trực tiếp tại `/group-buy` (còn hàng, do Tubu giao).
 * Lùi êm về `[]` khi mất mạng hoặc môi trường kiểm thử chưa giả lập `api`.
 */
export async function fetchGroupBuyStarterProducts(): Promise<ProductCard[]> {
  try {
    const res = await api?.get<PageResponse<ProductCard>>('/products', {
      params: { page: 1, limit: 8, sort: 'best_seller' },
    });
    const raw = Array.isArray(res?.data?.data) ? res.data.data : [];
    return raw
      .filter((p) => p.inStock !== false && p.fulfiller?.kind !== 'MERCHANT' && p.fulfiller?.kind !== 'UNAVAILABLE')
      .slice(0, 6);
  } catch {
    return [];
  }
}
