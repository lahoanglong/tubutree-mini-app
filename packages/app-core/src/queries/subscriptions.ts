import type { HttpClient } from '../http';
import { getSubscriptions } from '../api/subscriptions';

export const subscriptionsQuery = (http: HttpClient) => ({
  queryKey: ['subscriptions'] as const,
  queryFn: () => getSubscriptions(http),
});
