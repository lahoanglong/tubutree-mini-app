import type { HttpClient } from '../http';
import { fetchCampaign, fetchCampaignProducts, fetchCampaigns, type CampaignPlacement } from '../api/campaign';
import { CAMPAIGN_PRODUCTS_PAGE } from '../commerce/campaign';

export const campaignsQuery = (http: HttpClient, placement: CampaignPlacement) => ({
  queryKey: ['campaigns', placement] as const,
  queryFn: () => fetchCampaigns(http, placement),
});

export const campaignQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['campaign', slug] as const,
  queryFn: () => fetchCampaign(http, slug),
});

export const campaignProductsQuery = (http: HttpClient, slug: string, page: number) => ({
  queryKey: ['campaign-products', slug, page] as const,
  queryFn: () => fetchCampaignProducts(http, slug, { page, limit: CAMPAIGN_PRODUCTS_PAGE }),
});
