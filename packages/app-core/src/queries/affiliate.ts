import type { HttpClient } from '../http';
import {
  fetchContentKit,
  getAffiliateDashboard,
  getAffiliateLinks,
  getAffiliateMe,
  getCommissions,
  getCtvMilestones,
  getCtvTiers,
  getMyPayouts,
  getProductBreakdown,
  getStorefrontAnalytics,
  getTaxStatement,
  quoteCtvOrder,
  type CtvOrderItemInput,
} from '../api/affiliate';

export const affiliateMeQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-me'] as const,
  queryFn: () => getAffiliateMe(http),
});
export const affiliateDashboardQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-dashboard'] as const,
  queryFn: () => getAffiliateDashboard(http),
});
export const affiliateLinksQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-links'] as const,
  queryFn: () => getAffiliateLinks(http),
});
export const affiliateCommissionsQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-commissions'] as const,
  queryFn: () => getCommissions(http),
});
export const affiliatePayoutsQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-payouts'] as const,
  queryFn: () => getMyPayouts(http),
});
export const affiliateTaxStatementQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-tax-statement'] as const,
  queryFn: () => getTaxStatement(http),
});
export const affiliateStorefrontAnalyticsQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-sf-analytics'] as const,
  queryFn: () => getStorefrontAnalytics(http),
});
export const affiliateProductBreakdownQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-product-breakdown'] as const,
  queryFn: () => getProductBreakdown(http),
});
export const affiliateCtvTiersQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-ctv-tiers'] as const,
  queryFn: () => getCtvTiers(http),
});
export const affiliateMilestonesQuery = (http: HttpClient) => ({
  queryKey: ['affiliate-milestones'] as const,
  queryFn: () => getCtvMilestones(http),
});
export const contentKitQuery = (http: HttpClient, productSlug: string) => ({
  queryKey: ['content-kit', productSlug] as const,
  queryFn: () => fetchContentKit(http, productSlug),
});
/** `itemsKey` = JSON của [{ variationId, quantity }] (Mini App dùng chính chuỗi này làm khoá). */
export const ctvOrderQuoteQuery = (http: HttpClient, itemsKey: string) => ({
  queryKey: ['ctv-order-quote', itemsKey] as const,
  queryFn: () => quoteCtvOrder(http, JSON.parse(itemsKey) as CtvOrderItemInput[]),
});
