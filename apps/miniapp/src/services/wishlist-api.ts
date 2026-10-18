import { addWishlist as coreAdd, getWishlist as coreGet, getWishlistIds as coreGetIds, removeWishlist as coreRemove } from '@tubutree/app-core/api/wishlist';
import { coreHttp } from './core-http';

export const getWishlist = () => coreGet(coreHttp);
export const getWishlistIds = () => coreGetIds(coreHttp);
export const addWishlist = (productId: string) => coreAdd(coreHttp, productId);
export const removeWishlist = (productId: string) => coreRemove(coreHttp, productId);
