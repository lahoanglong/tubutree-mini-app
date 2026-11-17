import { NOTIFY_PREFS_LEGACY_TEXT_VERSION, NOTIFY_PREFS_TEXT_VERSION, type NotifyPrefs } from '@tubutree/app-core/api/account';
import { api, isHttpError } from '../services/api';

export type { NotifyPrefs };

/** API trước khi tách công tắc không có `notifySocial`: tin tương tác bài viết đi theo công tắc gộp `notifyGarden`. */
const withSocial = (p: Omit<NotifyPrefs, 'notifySocial'> & Partial<Pick<NotifyPrefs, 'notifySocial'>>): NotifyPrefs => ({
  ...p,
  notifySocial: p.notifySocial ?? p.notifyGarden,
});

export const fetchNotifyPrefs = () => api.get<NotifyPrefs>('/me/notifications/prefs').then((r) => withSocial(r.data));

/**
 * Mini App cập nhật chậm hơn API, và API có thể quay về ảnh trước khi tách công tắc (rollback). Ảnh đó chặn trường lạ bằng 400
 * "Không nhận trường «source»": gửi lại đúng phần công tắc nó hiểu để khách vẫn đổi được Khuyến mãi và Vườn Xanh.
 */
function rejectedNewFields(err: unknown): boolean {
  if (!isHttpError(err) || err.response?.status !== 400) return false;
  const message = (err.response.data as { message?: unknown } | undefined)?.message;
  return /«(source|textVersion|notifySocial)»/.test(([] as unknown[]).concat(message ?? []).join(' '));
}

/** Khách đổi công tắc ở Cài đặt: gửi kèm nguồn và phiên bản câu chữ đang hiện để máy chủ lưu bằng chứng đồng ý. */
export async function saveNotifyPrefs(patch: Partial<NotifyPrefs>, textVersion: string = NOTIFY_PREFS_TEXT_VERSION): Promise<NotifyPrefs> {
  try {
    const r = await api.patch<NotifyPrefs>('/me/notifications/prefs', { ...patch, source: 'settings', textVersion });
    return withSocial(r.data);
  } catch (err) {
    if (!rejectedNewFields(err)) throw err;
    const legacy: Partial<NotifyPrefs> = {};
    if (patch.notifyPromo !== undefined) legacy.notifyPromo = patch.notifyPromo;
    if (patch.notifyGarden !== undefined) legacy.notifyGarden = patch.notifyGarden;
    if (Object.keys(legacy).length === 0) throw err;
    const r = await api.patch<NotifyPrefs>('/me/notifications/prefs', legacy);
    return withSocial(r.data);
  }
}

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
