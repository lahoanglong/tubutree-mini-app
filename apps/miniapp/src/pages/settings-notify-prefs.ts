import { api } from '../services/api';

export interface NotifyPrefs {
  notifyPromo: boolean;
  notifyGarden: boolean;
}

export const fetchNotifyPrefs = () => api.get<NotifyPrefs>('/me/notifications/prefs').then((r) => r.data);

export const saveNotifyPrefs = (patch: Partial<NotifyPrefs>) =>
  api.patch<NotifyPrefs>('/me/notifications/prefs', patch).then((r) => r.data);

/**
 * Bản cũ chỉ lưu công tắc vào `tubu_prefs` trên máy nên server chưa từng biết khách đã tắt.
 * Trả về phần cần đẩy lên server: chỉ những nhóm khách đã TẮT trên máy mà server còn bật,
 * để không bao giờ tự bật lại nhóm khách đã từ chối.
 */
export function legacyOptOuts(local: Partial<NotifyPrefs> | null, server: NotifyPrefs): Partial<NotifyPrefs> | null {
  if (!local) return null;
  const patch: Partial<NotifyPrefs> = {};
  if (local.notifyPromo === false && server.notifyPromo) patch.notifyPromo = false;
  if (local.notifyGarden === false && server.notifyGarden) patch.notifyGarden = false;
  return Object.keys(patch).length > 0 ? patch : null;
}
