import type { HttpClient } from '../http';

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
  products: BrandProductView[];
  dealerRewards: DealerRewardView[];
}
export type ShareToEarn =
  | { eligible: false }
  | { eligible: true; maxAffiliateRate: number; referralCode: string; brandSlug: string };

export const getPublicBrand = (http: HttpClient, slug: string) => http.get<BrandView>(`/brand/public/${slug}`);

export const getBrandShareToEarn = (http: HttpClient, slug: string) => http.get<ShareToEarn>(`/brand/${slug}/share-to-earn`);

export interface FollowState {
  following: boolean;
  followerCount: number;
}
export const getBrandFollowState = (http: HttpClient, slug: string) => http.get<FollowState>(`/brand/${slug}/follow-state`);
export const followBrand = (http: HttpClient, slug: string) => http.post<FollowState>(`/brand/${slug}/follow`);
export const unfollowBrand = (http: HttpClient, slug: string) => http.delete<FollowState>(`/brand/${slug}/follow`);
