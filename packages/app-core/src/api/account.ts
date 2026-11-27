import type { AuthUser } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { AddressDTO } from './checkout';

export interface MeProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  /** Chỉ đọc: UpdateMeDto không nhận số điện thoại. API cũ chưa trả thì vắng. */
  phone?: string | null;
  /** `phone` đã xác minh qua Zalo; false = SĐT liên hệ tự gõ trên Web. API cũ chưa trả thì vắng. */
  phoneVerified?: AuthUser['phoneVerified'];
  avatarUrl: string | null;
  dob: string | null;
  onboarded: boolean;
  segments: string[];
}
export const getMe = (http: HttpClient) => http.get<MeProfile>('/me');
export const updateMe = (http: HttpClient, data: { fullName?: string; email?: string; avatarUrl?: string; dob?: string }) =>
  http.patch<MeProfile>('/me', data);
export const saveContactPhone = (http: HttpClient, phone: string) =>
  http.patch<MeProfile>('/me/contact-phone', { phone });
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
export const markNotificationRead = (http: HttpClient, id: string) => http.post<{ ok: boolean }>(`/me/notifications/${id}/read`);
export const markAllNotificationsRead = (http: HttpClient) => http.post<{ ok: boolean; count: number }>('/me/notifications/read-all');

export interface NotifyPrefs {
  notifyPromo: boolean;
  notifyGarden: boolean;
  /** "Tương tác bài viết" (thích, bình luận, trả lời bài của khách), tách khỏi "Nhắc Vườn Xanh". */
  notifySocial: boolean;
}

/**
 * Phiên bản câu chữ của các công tắc thông báo khách đang thấy, gửi kèm mỗi lần đổi để máy chủ lưu làm bằng chứng đồng ý. Đổi chữ công tắc
 * (`settings.*` trong shop-copy.ts hay chữ "Khuyến mãi & mã giảm giá") thì đổi chuỗi này.
 */
export const NOTIFY_PREFS_TEXT_VERSION = 'notify-prefs-v2-2026-11-17';
/** Câu chữ trước khi tách công tắc ("Nhắc nhở Vườn Xanh & tương tác bài viết"): dùng khi đẩy lựa chọn cũ lưu trên máy lên máy chủ. */
export const NOTIFY_PREFS_LEGACY_TEXT_VERSION = 'notify-prefs-v1';

export type NotifyConsentSource = 'settings' | 'onboarding' | 'unsubscribe_link';

export const fetchNotifyPrefs = (http: HttpClient) => http.get<NotifyPrefs>('/me/notifications/prefs');
/** Mỗi lần đổi công tắc gửi kèm nguồn và phiên bản câu chữ (mặc định: trang Cài đặt, bản hiện tại). */
export const saveNotifyPrefs = (
  http: HttpClient,
  patch: Partial<NotifyPrefs>,
  source: NotifyConsentSource = 'settings',
  textVersion: string = NOTIFY_PREFS_TEXT_VERSION,
) => http.patch<NotifyPrefs>('/me/notifications/prefs', { ...patch, source, textVersion });

export const updateAddress = (http: HttpClient, id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  http.patch<AddressDTO>(`/me/addresses/${id}`, data);
export const deleteAddress = (http: HttpClient, id: string) => http.delete<{ ok: boolean }>(`/me/addresses/${id}`);
