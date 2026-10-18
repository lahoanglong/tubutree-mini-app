import type { HttpClient } from '../http';
import {
  getMyStorefront,
  getPublicStorefront,
  getQuests,
  getStorefrontCategories,
  getStorefrontStats,
  pickerProducts,
} from '../api/storefront';

export const myStorefrontQuery = (http: HttpClient) => ({
  queryKey: ['my-storefront'] as const,
  queryFn: () => getMyStorefront(http),
});
export const publicStorefrontQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['public-storefront', slug] as const,
  queryFn: () => getPublicStorefront(http, slug),
});
export const storefrontCategoriesQuery = (http: HttpClient) => ({
  queryKey: ['storefront-categories'] as const,
  queryFn: () => getStorefrontCategories(http),
});
export const storefrontStatsQuery = (http: HttpClient) => ({
  queryKey: ['storefront-stats'] as const,
  queryFn: () => getStorefrontStats(http),
});
export const storefrontQuestsQuery = (http: HttpClient) => ({
  queryKey: ['storefront-quests'] as const,
  queryFn: () => getQuests(http),
});
export const pickerQuery = (http: HttpClient, search: string) => ({
  queryKey: ['picker', search] as const,
  queryFn: () => pickerProducts(http, search),
});
