import type { HttpClient } from '../http';
import {
  WASTE_QUERY_KEYS,
  getDeskPointReport,
  getDeskPoints,
  getWasteItems,
  getWasteMe,
  getWastePoints,
  getWasteRequest,
  getWasteRules,
  listWasteRequests,
} from '../api/waste';

export const wasteMeQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.me, queryFn: () => getWasteMe(http) });
export const wasteItemsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.items, queryFn: () => getWasteItems(http) });
export const wastePointsQuery = (http: HttpClient, provinceCode: string | null) => ({
  queryKey: WASTE_QUERY_KEYS.points(provinceCode),
  queryFn: () => getWastePoints(http, provinceCode ?? undefined),
});
export const wasteRequestsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.requests, queryFn: () => listWasteRequests(http) });
export const wasteRequestQuery = (http: HttpClient, id: string) => ({
  queryKey: WASTE_QUERY_KEYS.request(id),
  queryFn: () => getWasteRequest(http, id),
});
export const wasteRulesQuery = (http: HttpClient) => ({
  queryKey: [...WASTE_QUERY_KEYS.all, 'rules'] as const,
  queryFn: () => getWasteRules(http),
});
export const deskPointsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.desk, queryFn: () => getDeskPoints(http) });
export const deskPointReportQuery = (http: HttpClient, pointId: string, month: string) => ({
  queryKey: [...WASTE_QUERY_KEYS.desk, 'report', pointId, month] as const,
  queryFn: () => getDeskPointReport(http, pointId, month),
});
