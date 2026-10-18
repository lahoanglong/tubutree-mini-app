import { getStorage, setStorage } from 'zmp-sdk/apis';
import type { PlatformBridge } from '@tubutree/app-core/bridge';
import { callPhone, followOA, hasOA, openExternal, openOAChat, shareLink } from './zmp-bridge';

/** Cầu nối nền tảng cho Mini App: chỉ bọc hàm sẵn có của zmp-bridge (storage chung dùng thẳng getStorage/setStorage của SDK). */
export const platformBridge: PlatformBridge = {
  platform: 'miniapp',
  capabilities: { verifiedPhone: true, zaloLocation: true, qrScan: true, zaloNotifyPermission: true },

  async share({ title, text, path }) {
    try {
      await shareLink({ title, description: text ?? title, path });
      return 'shared';
    } catch {
      return 'failed';
    }
  },

  openExternal(url) {
    void openExternal(url).catch(() => {});
  },

  callPhone(phone) {
    void callPhone(phone).catch(() => {});
  },

  oa: {
    available: hasOA,
    openChat: (message) => openOAChat(message),
    follow: () => followOA(),
  },

  storage: {
    async get(key) {
      try {
        const res = (await getStorage({ keys: [key] })) as Record<string, unknown>;
        const value = res[key];
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        await setStorage({ data: { [key]: value } });
      } catch {
        /* ngoài Zalo hoặc lỗi storage: bỏ qua, không chặn luồng UI */
      }
    },
  },
};
