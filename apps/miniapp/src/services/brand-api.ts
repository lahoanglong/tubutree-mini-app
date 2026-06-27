import { api } from './api';

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

export const getPublicBrand = (slug: string) =>
  api.get(`/brand/public/${slug}`).then((r) => r.data as BrandView);

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
