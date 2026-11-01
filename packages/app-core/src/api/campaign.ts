import type { HttpClient } from '../http';
import type { PageResponse, ProductCard } from './catalog';
import type { CouponDTO } from './loyalty';

export type CampaignPlacement = 'HOME_TOP' | 'OFFERS_TOP';
export type CampaignLinkType = 'CAMPAIGN_PAGE' | 'PRODUCT' | 'CATEGORY' | 'URL_INTERNAL';
export type CampaignAudience = 'ALL' | 'NEW' | 'RETURNING';

/** Một banner đang chạy (`GET /campaigns`, cũng là khối `campaigns` của `GET /home`). `image` luôn dùng được: API bỏ chiến dịch có ảnh hỏng. */
export interface CampaignBanner {
  id: string;
  slug: string;
  title: string;
  image: string;
  linkType: CampaignLinkType;
  linkValue: string | null;
  audience: CampaignAudience;
  startAt: string;
  endAt: string;
}

export interface CampaignCouponDTO {
  code: string;
  type: CouponDTO['type'];
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
}

/** `GET /campaigns/:slug`. `image` null khi ảnh không phục vụ được: trang vẫn mở để khách xem mã và sản phẩm. */
export interface CampaignDetail extends Omit<CampaignBanner, 'image'> {
  image: string | null;
  subtitle: string | null;
  productCount: number;
  coupons: CampaignCouponDTO[];
}

// Công khai và cache được: `anonymous` để khách đã đăng nhập không bị preflight CORS/refresh token vì dữ liệu không theo người.
export const fetchCampaigns = (http: HttpClient, placement: CampaignPlacement) =>
  http.get<CampaignBanner[]>('/campaigns', { query: { placement }, anonymous: true });

export const fetchCampaign = (http: HttpClient, slug: string) =>
  http.get<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`, { anonymous: true });

export const fetchCampaignProducts = (http: HttpClient, slug: string, q: { page?: number; limit?: number } = {}) =>
  http.get<PageResponse<ProductCard>>(`/campaigns/${encodeURIComponent(slug)}/products`, {
    query: { ...(q.page ? { page: q.page } : {}), ...(q.limit ? { limit: q.limit } : {}) },
    anonymous: true,
  });
