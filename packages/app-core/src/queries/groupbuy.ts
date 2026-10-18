import type { HttpClient } from '../http';
import { getGroupBuy, listGroupBuys } from '../api/groupbuy';

export const groupBuyListQuery = (http: HttpClient) => ({ queryKey: ['group-buy'] as const, queryFn: () => listGroupBuys(http) });
export const groupBuyOneQuery = (http: HttpClient, id: string) => ({
  queryKey: ['group-buy', 'one', id] as const,
  queryFn: () => getGroupBuy(http, id),
});
