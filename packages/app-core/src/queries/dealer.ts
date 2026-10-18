import type { HttpClient } from '../http';
import {
  getCreditLedger,
  getDealerMe,
  getDealerOrders,
  getDealerRewards,
  getPricelist,
  getQuarterlyReport,
  getTemplates,
} from '../api/dealer';

export const dealerMeQuery = (http: HttpClient) => ({
  queryKey: ['dealer-me'] as const,
  queryFn: () => getDealerMe(http),
});
export const dealerPricelistQuery = (http: HttpClient) => ({
  queryKey: ['dealer-pricelist'] as const,
  queryFn: () => getPricelist(http),
});
export const dealerTemplatesQuery = (http: HttpClient) => ({
  queryKey: ['dealer-templates'] as const,
  queryFn: () => getTemplates(http),
});
export const dealerOrdersQuery = (http: HttpClient) => ({
  queryKey: ['dealer-orders'] as const,
  queryFn: () => getDealerOrders(http),
});
export const dealerCreditQuery = (http: HttpClient) => ({
  queryKey: ['dealer-credit'] as const,
  queryFn: () => getCreditLedger(http),
});
export const dealerReportQuery = (http: HttpClient) => ({
  queryKey: ['dealer-report'] as const,
  queryFn: () => getQuarterlyReport(http),
});
export const dealerRewardsQuery = (http: HttpClient) => ({
  queryKey: ['dealer-rewards'] as const,
  queryFn: () => getDealerRewards(http),
});
