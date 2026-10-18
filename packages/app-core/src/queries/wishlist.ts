import type { HttpClient } from '../http';
import { getWishlist, getWishlistIds } from '../api/wishlist';

export const wishlistQuery = (http: HttpClient) => ({ queryKey: ['wishlist'] as const, queryFn: () => getWishlist(http) });
export const wishlistIdsQuery = (http: HttpClient) => ({ queryKey: ['wishlist-ids'] as const, queryFn: () => getWishlistIds(http) });
