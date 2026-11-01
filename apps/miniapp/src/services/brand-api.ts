import { fetchBrandProducts as fetchBrandProductsCore, type BrandProductsQuery } from '@tubutree/app-core/api/brand';
import type { PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import { api } from './api';
import { coreHttp } from './core-http';

export interface BrandCert {
  code: string;
  label: string;
  proofUrl: string | null;
}
export interface BrandPromotionView {
  id: string;
  title: string;
  subtitle: string | null;
  themeColor: string | null;
  couponCode: string | null;
  startAt: string;
  endAt: string;
}
export interface BrandProductView {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  ratingAvg: number;
  reviewCount: number;
  sold?: number;
  inStock: boolean;
}
export interface DealerRewardView {
  id: string;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
}
export interface BrandView {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  tagline: string | null;
  story: string | null;
  storyImages: string[];
  origin: string | null;
  isVerified: boolean;
  followerCount: number;
  certifications: BrandCert[];
  promotions: BrandPromotionView[];
  /** Tổng sản phẩm công khai của nhãn; API cũ hoặc bản cache cũ không trả: nơi đọc dùng `products.length`. */
  productCount?: number;
  /** Tối đa 30 món đầu; danh sách đầy đủ lấy bằng `fetchBrandProducts`. */
  products: BrandProductView[];
  dealerRewards: DealerRewardView[];
}
export type ShareToEarn =
  | { eligible: false }
  | { eligible: true; maxAffiliateRate: number; referralCode: string; brandSlug: string };

export const getPublicBrand = (slug: string) =>
  api.get(`/brand/public/${slug}`).then((r) => r.data as BrandView);

/** Sản phẩm của nhãn, phân trang thật, cùng dạng thẻ với `GET /products`. */
export const fetchBrandProducts = (slug: string, q: BrandProductsQuery = {}): Promise<PageResponse<ProductCard>> =>
  fetchBrandProductsCore(coreHttp, slug, q);

export const getBrandShareToEarn = (slug: string) =>
  api.get(`/brand/${slug}/share-to-earn`).then((r) => r.data as ShareToEarn);

export interface FollowState {
  following: boolean;
  followerCount: number;
}
export const getBrandFollowState = (slug: string) =>
  api.get(`/brand/${slug}/follow-state`).then((r) => r.data as FollowState);
export const followBrand = (slug: string) =>
  api.post(`/brand/${slug}/follow`).then((r) => r.data as FollowState);
export const unfollowBrand = (slug: string) =>
  api.delete(`/brand/${slug}/follow`).then((r) => r.data as FollowState);
