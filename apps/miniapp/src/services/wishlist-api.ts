import { api } from './api';
import type { ProductCard } from './shop-api';

export const getWishlist = () => api.get<ProductCard[]>('/me/wishlist').then((r) => r.data);
export const getWishlistIds = () => api.get<string[]>('/me/wishlist/ids').then((r) => r.data);
export const addWishlist = (productId: string) =>
  api.post<{ ok: boolean }>('/me/wishlist', { productId }).then((r) => r.data);
export const removeWishlist = (productId: string) =>
  api.delete<{ ok: boolean }>(`/me/wishlist/${productId}`).then((r) => r.data);
