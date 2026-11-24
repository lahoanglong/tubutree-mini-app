import type { HttpClient } from '../http';
import {
  getCreditLedger,
  getDealerInvoiceProfile,
  getDealerLastMonthReorder,
  getDealerMe,
  getDealerOrders,
  getDealerRewards,
  getDealerTierProgress,
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
export const dealerTierProgressQuery = (http: HttpClient) => ({
  queryKey: ['dealer-tier-progress'] as const,
  queryFn: () => getDealerTierProgress(http),
});
export const dealerInvoiceProfileQuery = (http: HttpClient) => ({
  queryKey: ['dealer-invoice-profile'] as const,
  queryFn: () => getDealerInvoiceProfile(http),
});
export const dealerRewardsQuery = (http: HttpClient) => ({
  queryKey: ['dealer-rewards'] as const,
  queryFn: () => getDealerRewards(http),
});
export const dealerLastMonthReorderQuery = (http: HttpClient) => ({
  queryKey: ['dealer-last-month-reorder'] as const,
  queryFn: () => getDealerLastMonthReorder(http),
});
