import type { HttpClient } from '../http';
import type { AddressDTO } from './checkout';

export interface MeProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  /** Chỉ đọc: UpdateMeDto không nhận số điện thoại. API cũ chưa trả thì vắng. */
  phone?: string | null;
  avatarUrl: string | null;
  dob: string | null;
  onboarded: boolean;
  segments: string[];
}
export const getMe = (http: HttpClient) => http.get<MeProfile>('/me');
export const updateMe = (http: HttpClient, data: { fullName?: string; email?: string; avatarUrl?: string; dob?: string }) =>
  http.patch<MeProfile>('/me', data);
export const completeOnboarding = (http: HttpClient, segments: string[]) => http.post<MeProfile>('/me/onboarding', { segments });

/** A1-03: yêu cầu xoá tài khoản (KHÔNG phải xoá thật — CSKH xử lý thủ công, xem UsersService). */
export interface AccountDeletionRequestResult {
  alreadyRequested: boolean;
  createdAt: string;
  message: string;
}
/** `walletConsent`: khách đã thấy số dư Ví và đồng ý bỏ (bắt buộc khi Ví còn tiền; máy chủ so với số dư hiện tại). */
export interface WalletForfeitConsent {
  acknowledgedWalletBalance: number;
  acceptWalletForfeit: true;
}
export const requestAccountDeletion = (http: HttpClient, reason?: string, walletConsent?: WalletForfeitConsent) =>
  http.post<AccountDeletionRequestResult>('/me/deletion-request', { reason, ...walletConsent });

// Notifications
export interface NotificationDTO {
  id: string;
  templateCode: string;
  payload: { body?: string; data?: Record<string, string> };
  status: 'SENT' | 'FAILED' | 'READ';
  sentAt: string;
}
export const getNotifications = (http: HttpClient) => http.get<NotificationDTO[]>('/me/notifications');

/** Con trỏ trang kế: `sentAt` và `id` của tin cuối trang trước (id phân định các tin cùng `sentAt`). */
export interface NotificationCursor {
  before: string;
  beforeId: string;
}
export interface NotificationPageParams extends Partial<NotificationCursor> {
  /** Tối đa 50, máy chủ mặc định 50. */
  limit?: number;
}
export const getNotificationsPage = (http: HttpClient, params: NotificationPageParams = {}) =>
  http.get<NotificationDTO[]>('/me/notifications', { query: { ...params } });
/** Số tin chưa đọc của TOÀN BỘ hộp thư (không chỉ trang đang tải). */
export const getUnreadNotificationCount = (http: HttpClient) => http.get<{ count: number }>('/me/notifications/unread-count');
export const markNotificationRead = (http: HttpClient, id: string) => http.post<{ ok: boolean }>(`/me/notifications/${id}/read`);
export const markAllNotificationsRead = (http: HttpClient) => http.post<{ ok: boolean; count: number }>('/me/notifications/read-all');

export interface NotifyPrefs {
  notifyPromo: boolean;
  notifyGarden: boolean;
}

export const fetchNotifyPrefs = (http: HttpClient) => http.get<NotifyPrefs>('/me/notifications/prefs');
export const saveNotifyPrefs = (http: HttpClient, patch: Partial<NotifyPrefs>) =>
  http.patch<NotifyPrefs>('/me/notifications/prefs', patch);

export const updateAddress = (http: HttpClient, id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  http.patch<AddressDTO>(`/me/addresses/${id}`, data);
export const deleteAddress = (http: HttpClient, id: string) => http.delete<{ ok: boolean }>(`/me/addresses/${id}`);
