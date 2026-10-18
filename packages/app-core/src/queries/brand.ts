import type { HttpClient } from '../http';
import { getBrandFollowState, getBrandShareToEarn, getPublicBrand } from '../api/brand';

export const publicBrandQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['public-brand', slug] as const,
  queryFn: () => getPublicBrand(http, slug),
});
export const brandFollowQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['brand-follow', slug] as const,
  queryFn: () => getBrandFollowState(http, slug),
});
export const brandShareToEarnQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['brand-ste', slug] as const,
  queryFn: () => getBrandShareToEarn(http, slug),
});
