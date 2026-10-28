import type { HttpClient } from '../http';
import { getMe, getNotifications, getNotificationsPage, getUnreadNotificationCount, type NotificationCursor, type NotificationDTO } from '../api/account';

export const meQuery = (http: HttpClient) => ({ queryKey: ['me'] as const, queryFn: () => getMe(http) });
export const notificationsQuery = (http: HttpClient) => ({ queryKey: ['notifications'] as const, queryFn: () => getNotifications(http) });

/** Số tin mỗi lần nạp ở trang Thông báo; trang trả ít hơn số này nghĩa là hết tin. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** Con trỏ cho trang kế từ trang vừa nạp; undefined khi hết. */
export function nextNotificationCursor(lastPage: readonly NotificationDTO[], pageSize: number = NOTIFICATIONS_PAGE_SIZE): NotificationCursor | undefined {
  const last = lastPage[lastPage.length - 1];
  return last && lastPage.length >= pageSize ? { before: last.sentAt, beforeId: last.id } : undefined;
}

/**
 * Danh sách tin phân trang cho useInfiniteQuery (initialPageParam undefined, getNextPageParam = nextNotificationCursor). Khoá con của
 * ['notifications'] để invalidate cũ vẫn làm mới; KHÔNG dùng chung khoá ['notifications'] vì dạng dữ liệu cache khác (nhiều trang).
 */
export const notificationsInfiniteQuery = (http: HttpClient) => ({
  queryKey: ['notifications', 'list'] as const,
  queryFn: ({ pageParam }: { pageParam: NotificationCursor | undefined }) =>
    getNotificationsPage(http, { ...pageParam, limit: NOTIFICATIONS_PAGE_SIZE }),
});

/** Số tin chưa đọc (huy hiệu chuông, Trang chủ, Cá nhân). Khoá con của ['notifications'] nên mọi lần đánh dấu đã đọc làm mới nó. */
export const unreadNotificationCountQuery = (http: HttpClient) => ({
  queryKey: ['notifications', 'unread'] as const,
  queryFn: () => getUnreadNotificationCount(http),
});
