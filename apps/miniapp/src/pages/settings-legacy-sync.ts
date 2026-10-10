import { useEffect } from 'react';
import { getStorage, setStorage } from 'zmp-sdk/apis';
import { fetchNotifyPrefs, legacyOptOuts, saveNotifyPrefs, type NotifyPrefs } from './settings-notify-prefs';

const PREFS_KEY = 'tubu_prefs';

type StoredPrefs = Partial<NotifyPrefs> & { fontScale?: string };

async function readStored(): Promise<StoredPrefs | null> {
  const res = await getStorage({ keys: [PREFS_KEY] });
  const raw = (res as Record<string, unknown>)[PREFS_KEY];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as StoredPrefs;
  } catch {
    return null;
  }
}

/**
 * Bản cũ chỉ lưu công tắc thông báo trên máy, server mặc định bật cho mọi người. Chạy ngay khi mở
 * app (không đợi khách vào Cài đặt) để lựa chọn tắt cũ có hiệu lực từ lần mở đầu tiên sau khi cập nhật.
 * Khoá cũ chỉ bị xoá SAU khi server đã nhận, nên lỗi mạng thì lần mở sau thử lại.
 * Trả null khi máy không còn khoá cũ (không gọi mạng).
 */
export async function syncLegacyNotifyPrefs(): Promise<NotifyPrefs | null> {
  const stored = await readStored();
  if (!stored || !('notifyPromo' in stored || 'notifyGarden' in stored)) return null;
  let server = await fetchNotifyPrefs();
  const patch = legacyOptOuts(stored, server);
  if (patch) server = await saveNotifyPrefs(patch);
  const rest = stored.fontScale ? { fontScale: stored.fontScale } : {};
  await setStorage({ data: { [PREFS_KEY]: JSON.stringify(rest) } });
  return server;
}

export function useLegacyNotifyPrefsSync(authed: boolean): void {
  useEffect(() => {
    if (!authed) return;
    void syncLegacyNotifyPrefs().catch(() => undefined);
  }, [authed]);
}
