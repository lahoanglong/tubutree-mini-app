import { NOTIFY_PREFS_LEGACY_TEXT_VERSION, NOTIFY_PREFS_TEXT_VERSION, type NotifyPrefs } from '@tubutree/app-core/api/account';
import { api } from '../services/api';

export type { NotifyPrefs };

export const fetchNotifyPrefs = () => api.get<NotifyPrefs>('/me/notifications/prefs').then((r) => r.data);

/** Khách đổi công tắc ở Cài đặt: gửi kèm nguồn và phiên bản câu chữ đang hiện để máy chủ lưu bằng chứng đồng ý. */
export const saveNotifyPrefs = (patch: Partial<NotifyPrefs>, textVersion: string = NOTIFY_PREFS_TEXT_VERSION) =>
  api.patch<NotifyPrefs>('/me/notifications/prefs', { ...patch, source: 'settings', textVersion }).then((r) => r.data);

/** Lựa chọn cũ lưu trên máy được chọn dưới câu chữ cũ (công tắc gộp Vườn Xanh và tương tác bài viết). */
export const saveLegacyOptOuts = (patch: Partial<NotifyPrefs>) => saveNotifyPrefs(patch, NOTIFY_PREFS_LEGACY_TEXT_VERSION);

/**
 * Bản cũ chỉ lưu công tắc vào `tubu_prefs` trên máy nên server chưa từng biết khách đã tắt.
 * Trả về phần cần đẩy lên server: chỉ những nhóm khách đã TẮT trên máy mà server còn bật,
 * để không bao giờ tự bật lại nhóm khách đã từ chối.
 */
export function legacyOptOuts(local: Partial<NotifyPrefs> | null, server: NotifyPrefs): Partial<NotifyPrefs> | null {
  if (!local) return null;
  const patch: Partial<NotifyPrefs> = {};
  if (local.notifyPromo === false && server.notifyPromo) patch.notifyPromo = false;
  // Công tắc cũ "Nhắc nhở Vườn Xanh & tương tác bài viết" gồm cả hai nhóm nay đã tách: tắt nó là tắt cả hai.
  if (local.notifyGarden === false && server.notifyGarden) patch.notifyGarden = false;
  if (local.notifyGarden === false && server.notifySocial) patch.notifySocial = false;
  return Object.keys(patch).length > 0 ? patch : null;
}
