import { api } from './api';

export interface StorefrontItem {
  id: string;
  note: string | null;
  variationId: string | null;
  product: {
    id: string; name: string; slug: string; thumbnail: string | null; brand: string;
    basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number;
  };
}
export interface StorefrontItemEdit extends StorefrontItem { isPinned: boolean; isHidden: boolean; sortOrder: number; productId: string; }
export interface StorefrontCollection {
  id: string; title: string; kind: 'NORMAL' | 'COMBO'; layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct: number | null; items: StorefrontItem[];
}
export interface StorefrontCollectionEdit extends Omit<StorefrontCollection, 'items'> { sortOrder: number; items: StorefrontItemEdit[]; }
export interface Storefront {
  id: string; slug: string; type: 'CTV' | 'BRAND'; title: string; headerNote: string | null;
  avatarUrl: string | null; coverUrl: string | null; theme: string; collections: StorefrontCollection[];
}
export interface StorefrontEdit extends Omit<Storefront, 'collections'> { isPublished: boolean; collections: StorefrontCollectionEdit[]; }
export interface PickerProduct {
  id: string; name: string; slug: string; thumbnail: string | null; brand: string;
  basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number; maxAffiliateRate: number;
}

export const createStorefront = () => api.post('/storefront').then((r) => r.data as StorefrontEdit);
export const getMyStorefront = () => api.get('/storefront/me').then((r) => r.data as StorefrontEdit);
export const getPublicStorefront = (slug: string) => api.get(`/storefront/public/${slug}`).then((r) => r.data as Storefront);
export const updateStorefront = (dto: Partial<Pick<Storefront, 'title' | 'headerNote' | 'avatarUrl' | 'coverUrl' | 'theme'>>) =>
  api.patch('/storefront/me', dto).then((r) => r.data as StorefrontEdit);
export const publishStorefront = (isPublished: boolean) =>
  api.post('/storefront/me/publish', { isPublished }).then((r) => r.data as StorefrontEdit);

export const createCollection = (dto: { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.post('/storefront/me/collections', dto).then((r) => r.data as StorefrontCollectionEdit);
export const updateCollection = (id: string, dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.patch(`/storefront/me/collections/${id}`, dto).then((r) => r.data);
export const deleteCollection = (id: string) => api.delete(`/storefront/me/collections/${id}`).then((r) => r.data);
export const reorderCollections = (orderedIds: string[]) => api.post('/storefront/me/collections/reorder', { orderedIds }).then((r) => r.data);

export const addItem = (collectionId: string, dto: { productId: string; variationId?: string; note?: string }) =>
  api.post(`/storefront/me/collections/${collectionId}/items`, dto).then((r) => r.data as StorefrontItemEdit);
export const updateItem = (id: string, dto: { note?: string; isPinned?: boolean; isHidden?: boolean }) =>
  api.patch(`/storefront/me/items/${id}`, dto).then((r) => r.data);
export const removeItem = (id: string) => api.delete(`/storefront/me/items/${id}`).then((r) => r.data);
export const reorderItems = (collectionId: string, orderedIds: string[]) =>
  api.post(`/storefront/me/collections/${collectionId}/items/reorder`, { orderedIds }).then((r) => r.data);

export const pickerProducts = (search?: string) =>
  api.get('/storefront/me/products', { params: { search } }).then((r) => r.data as PickerProduct[]);

export interface StorefrontQuest {
  code: string; title: string; hint: string; goal: number; rewardXu: number;
  progress: number; done: boolean; claimed: boolean;
}
export interface QuestList { quests: StorefrontQuest[]; totalEarnedXu: number; level: number; levelMax: number; }

export const getQuests = () => api.get('/storefront/me/quests').then((r) => r.data as QuestList);
export const claimQuest = (code: string) =>
  api.post(`/storefront/me/quests/${code}/claim`).then((r) => r.data as { claimed: boolean; code: string; rewardXu: number; coinsBalance: number });
