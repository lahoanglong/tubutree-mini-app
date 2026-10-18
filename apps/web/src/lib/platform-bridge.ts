import { isHttpUrl, type PlatformBridge, type ShareResult } from '@tubutree/app-core/bridge';

const OA_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// URL đến từ API/admin: chỉ http(s), vì javascript:/data: trong tab mới chạy với origin của web.
function openTab(url: string): void {
  if (!isHttpUrl(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cầu nối nền tảng cho web. `oaId` mặc định lấy từ NEXT_PUBLIC_ZALO_OA_ID (phải đọc dạng literal để Next nhúng lúc build);
 * trống hoặc có ký tự lạ thì OA coi như chưa cấu hình, để id không dựng ra URL sai.
 */
export function createWebPlatformBridge(opts: { oaId?: string } = {}): PlatformBridge {
  const rawOaId = opts.oaId ?? process.env.NEXT_PUBLIC_ZALO_OA_ID ?? '';
  const oaId = rawOaId.trim();
  const oaUrl = OA_ID_PATTERN.test(oaId) ? `https://zalo.me/${oaId}` : null;

  return {
    platform: 'web',
    capabilities: { verifiedPhone: false, zaloLocation: false, qrScan: false, zaloNotifyPermission: false },

    async share({ title, text, path }): Promise<ShareResult> {
      const url = `${window.location.origin}${path}`;
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share(text ? { title, text, url } : { title, url });
          return 'shared';
        } catch (e) {
          // Khách đóng hộp chia sẻ: không phải lỗi, không chép link thay.
          if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
        }
      }
      return (await copyLink(url)) ? 'copied' : 'failed';
    },

    openExternal: openTab,

    // Giữ cách làm sạch số như callPhone của Mini App: số bàn và tổng đài 1800/1900 đi nguyên vẹn vào tel:.
    callPhone(phone) {
      window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
    },

    oa: {
      available: oaUrl !== null,
      // zalo.me/<id> không nhận sẵn nội dung tin nhắn nên `message` không được dùng ở web.
      async openChat() {
        if (oaUrl) openTab(oaUrl);
      },
      // Web không có API theo dõi OA và không đọc được trạng thái, nên mở trang OA để khách tự bấm và luôn trả false.
      async follow() {
        if (!oaUrl) return false;
        openTab(oaUrl);
        return false;
      },
    },

    storage: {
      async get(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      async set(key, value) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* chế độ riêng tư hoặc bị chặn: bỏ qua, không chặn luồng UI */
        }
      },
    },
  };
}

export const platformBridge: PlatformBridge = createWebPlatformBridge();
