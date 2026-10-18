import type { HttpClient } from '../http';
import { getMe, getNotifications } from '../api/account';

export const meQuery = (http: HttpClient) => ({ queryKey: ['me'] as const, queryFn: () => getMe(http) });
export const notificationsQuery = (http: HttpClient) => ({ queryKey: ['notifications'] as const, queryFn: () => getNotifications(http) });
