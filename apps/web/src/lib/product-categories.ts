'use client';

import { apiFetch } from './client-api';

export interface CategoryProduct {
  id: string;
  name: string;
  thumbnail: string | null;
  brand: string;
  pancakeId: string | null;
  isActive: boolean;
  categoryIds: string[];
}
export interface CategoryProductsPage {
  items: CategoryProduct[];
  total: number;
  nextCursor: string | null;
}
export interface CategoryOption {
  id: string;
  name: string;
  productCount?: number;
}
export interface PancakeCategoryRow {
  id: string;
  name: string;
  path: string;
  mappedTo: string | null;
}
export interface AssignResult {
  requested: number;
  changed: number;
  unchanged: number;
  category: { id: string; name: string };
}

export const CATEGORY_PRODUCTS_PAGE_SIZE = 50;
/** Khớp CATEGORY_ASSIGN_MAX_PRODUCTS của API. */
export const ASSIGN_MAX = 500;

export const listCategoryProducts = (p: { q?: string; uncategorized: boolean; pancakeOnly: boolean; cursor?: string }) => {
  const sp = new URLSearchParams({ take: String(CATEGORY_PRODUCTS_PAGE_SIZE), source: p.pancakeOnly ? 'pancake' : 'all' });
  if (p.q?.trim()) sp.set('q', p.q.trim());
  if (p.uncategorized) sp.set('uncategorized', '1');
  if (p.cursor) sp.set('cursor', p.cursor);
  return apiFetch<CategoryProductsPage>(`/admin/product-categories/products?${sp.toString()}`);
};
export const listCategoryOptions = () => apiFetch<CategoryOption[]>('/categories');
export const assignCategory = (productIds: string[], categoryId: string, mode: 'ADD' | 'REMOVE') =>
  apiFetch<AssignResult>('/admin/product-categories/assign', { method: 'POST', body: { productIds, categoryId, mode } });
export const listPancakeCategories = () => apiFetch<PancakeCategoryRow[]>('/admin/pancake/categories');
