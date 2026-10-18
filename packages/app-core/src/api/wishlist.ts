import type { HttpClient } from '../http';
import type { ProductCard } from './catalog';

export const getWishlist = (http: HttpClient) => http.get<ProductCard[]>('/me/wishlist');
export const getWishlistIds = (http: HttpClient) => http.get<string[]>('/me/wishlist/ids');
export const addWishlist = (http: HttpClient, productId: string) => http.post<{ ok: boolean }>('/me/wishlist', { productId });
export const removeWishlist = (http: HttpClient, productId: string) => http.delete<{ ok: boolean }>(`/me/wishlist/${productId}`);
