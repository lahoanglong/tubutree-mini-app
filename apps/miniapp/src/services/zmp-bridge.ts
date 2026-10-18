import {
  getAccessToken,
  getPhoneNumber,
  getUserInfo,
  getLocation,
  login as zmpLogin,
  openShareSheet,
  openWebview,
  openChat,
  openPhone,
  followOA as zmpFollowOA,
  requestSendNotification as zmpRequestSendNotification,
  getStorage,
  setStorage,
  scanQRCode,
} from 'zmp-sdk/apis';
import { copyText } from '../utils/clipboard';
import { WEB_BASE_URL } from '../utils/web-base-url';

/**
 * Bọc các API gốc của zmp-sdk: login, share, (pay - Phase 1).
 * Tách riêng để phần còn lại của app không phụ thuộc trực tiếp vào SDK,
 * dễ mock khi test và dễ thay đổi khi SDK đổi API.
 */

export interface ZaloLoginResult {
  /** access token để gửi lên backend verify (POST /auth/zalo-mini-app). */
  accessToken: string;
  /** code đăng nhập (dự phòng cho luồng OAuth server-side). */
  code: string;
  /** token getPhoneNumber() — backend giải mã lấy SĐT (có thể undefined nếu user từ chối). */
  phoneToken?: string;
}

/**
 * Đăng nhập Zalo NGẦM (silent) — chỉ login + access token, KHÔNG xin SĐT.
 * Dùng khi mở app để vào thẳng trang chủ như các mini app khác (Sendo/Homefarm).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bọc 1 lời gọi SDK với timeout — chống TREO vô hạn: ngoài môi trường Zalo (hoặc khi cầu nối
 * native không phản hồi), login()/getAccessToken() có thể không bao giờ resolve → app kẹt ở
 * màn loading. Hết hạn → reject để rơi xuống fallback khách. Zalo thật trả < 1s nên 3s rất dư.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ]);
}

/**
 * Lấy access token Zalo, CÓ RETRY — lỗi đã biết của Zalo SDK: getAccessToken() hay
 * fail/empty ở lần gọi đầu (ngay sau login), thành công ở lần sau. Thử tối đa 3 lần,
 * mỗi lần re-login + chờ tăng dần (0.4s, 0.8s). Mỗi call có timeout 3s chống treo.
 * Trả token hoặc throw lỗi cuối (→ caller fallback đăng nhập khách).
 */
export async function getZaloAccessToken(): Promise<ZaloLoginResult> {
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      await withTimeout(zmpLogin({}), 3000, 'zmpLogin');
      const accessToken = await withTimeout(getAccessToken({}), 3000, 'getAccessToken');
      if (accessToken && accessToken.length > 0) return { accessToken, code: accessToken };
      lastErr = new Error('empty access token');
    } catch (e) {
      lastErr = e;
      // -1401 = "app chưa kích hoạt" — lỗi VĨNH VIỄN, retry vô ích → bail ngay để fallback guest nhanh.
      const code = typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
      // Timeout = không có cầu nối Zalo (chạy ngoài Zalo) → cũng bail ngay, retry vô ích.
      const isTimeout = e instanceof Error && e.message.endsWith('timeout');
      if (code === -1401 || isTimeout) break;
    }
    if (i < 2) await sleep(400 * (i + 1)); // chỉ chờ GIỮA các lần (0.4s, 0.8s), không chờ sau lần cuối
  }
  throw lastErr instanceof Error ? lastErr : new Error('getAccessToken failed');
}

/**
 * Xin SĐT đúng lúc cần (checkout) — sheet native scope.userPhonenumber.
 * Trả token để backend giải mã; null nếu user từ chối/SDK lỗi (không chặn luồng).
 */
export async function requestZaloPhoneToken(): Promise<string | null> {
  try {
    const res = await getPhoneNumber({});
    return (res as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

/**
 * Xin vị trí (scope.userLocation) — trả token để backend đổi ra toạ độ (giống getPhoneNumber).
 * null nếu user từ chối / SDK lỗi / chạy ngoài Zalo.
 */
export async function requestZaloLocation(): Promise<{ token: string } | null> {
  try {
    const res = await getLocation({});
    const token = (res as { token?: string }).token;
    return token ? { token } : null;
  } catch {
    return null;
  }
}

/** Như `requestZaloLocation` nhưng giữ lại lỗi của SDK (throw) để caller phân biệt từ chối quyền / lỗi khác. */
export async function requestZaloLocationStrict(): Promise<{ token: string } | null> {
  const res = await getLocation({});
  const token = (res as { token?: string }).token;
  return token ? { token } : null;
}

/** Lấy thông tin hiển thị cơ bản (tên, avatar) — cần quyền scope.userInfo. */
export async function getZaloUserInfo() {
  const { userInfo } = await getUserInfo({ autoRequestPermission: true });
  return userInfo;
}

/** Mở màn hình gọi điện; ngoài Zalo (trình duyệt) openPhone không chạy nên rơi về tel:. */
export async function callPhone(phone: string) {
  const number = phone.replace(/[^\d+]/g, '');
  try {
    await openPhone({ phoneNumber: number });
  } catch {
    window.location.href = `tel:${number}`;
  }
}

export type ScanCodeResult = { kind: 'ok'; content: string } | { kind: 'cancelled' } | { kind: 'failed' };

/**
 * Quét mã bằng camera Zalo. SDK không công bố mã lỗi riêng cho việc khách tự đóng camera, nên "cancelled" chỉ nhận ra được khi
 * lỗi có chữ huỷ/cancel trong message; các lỗi khác (không có quyền camera, không đọc được) là "failed" và màn quét gợi ý nhập tay.
 */
export async function scanCode(): Promise<ScanCodeResult> {
  try {
    const res = await scanQRCode();
    const content = typeof res?.content === 'string' ? res.content.trim() : '';
    return content ? { kind: 'ok', content } : { kind: 'failed' };
  } catch (e) {
    const raw = (e as { message?: unknown } | null)?.message;
    const text = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '');
    return /cancel|hu[yỷ]|hủy/i.test(text) ? { kind: 'cancelled' } : { kind: 'failed' };
  }
}

/** Mở URL ngoài (deeplink sàn cashback) trong webview Zalo. */
export async function openExternal(url: string) {
  try {
    await openWebview({ url });
  } catch {
    window.location.href = url;
  }
}

/** Mở link hoàn tiền sàn ngoài (Shopee, Lazada...) trực tiếp sang native app / trình duyệt ngoài. */
export async function openAffiliateLink(url: string) {
  // Chép link sang clipboard là tiện ích phụ (khách dán lại nếu app sàn không tự mở) — hỏng
  // thì im lặng, KHÔNG chặn việc mở link.
  await copyText(url).catch(() => false);

  try {
    window.location.href = url;
  } catch {
    await openWebview({ url }).catch(() => {});
  }
}

/** OA Tubu đã cấu hình chưa (để hiện nút "Nhắn hỗ trợ"). */
export const OA_ID = (import.meta.env.VITE_ZALO_OA_ID as string | undefined) ?? '';
export const hasOA = Boolean(OA_ID);

/** Mở chat Zalo OA hỗ trợ (spec §6.4). Gate theo VITE_ZALO_OA_ID. */
export async function openOAChat(message?: string) {
  if (!OA_ID) return;
  await openChat({ type: 'oa', id: OA_ID, message });
}

/**
 * Yêu cầu khách theo dõi Official Account Tubu Tree (finding A3-01 nửa 2 — kênh ZNS thật vẫn
 * cần duyệt mẫu ở Zalo, nhưng follow OA thì gọi được ngay, không cần duyệt).
 *
 * Không bao giờ throw: OA chưa cấu hình (`oaId` rỗng — mặc định lấy từ `OA_ID`/VITE_ZALO_OA_ID),
 * chạy ngoài Zalo, hoặc khách bấm từ chối (code -201) đều rơi về `false` — mirror
 * `requestZaloPhoneToken`/`requestZaloLocation` ở trên (không chặn luồng gọi).
 */
export async function followOA(oaId: string = OA_ID): Promise<boolean> {
  if (!oaId) return false; // OA chưa cấu hình → no-op, tránh mở dialog theo dõi một OA rỗng
  try {
    await zmpFollowOA({ id: oaId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Xin quyền gửi thông báo qua OA Mini App (ZMA — khác ZNS, không cần duyệt mẫu trước).
 * Cùng cách xử lý lỗi với `followOA` ở trên: không throw, `false` nếu ngoài Zalo/bị từ chối.
 */
export async function requestNotifyPermission(): Promise<boolean> {
  try {
    await zmpRequestSendNotification({});
    return true;
  } catch {
    return false;
  }
}

const OA_PROMPT_STORAGE_KEY = 'tubu_oa_prompt';

export interface OaPromptState {
  /** Đã hỏi theo dõi OA rồi (khách bấm theo dõi HOẶC bấm "Để sau") — không hỏi lại nữa. */
  promptSeen: boolean;
  /**
   * `followOA()` từng gọi thành công ít nhất 1 lần — CHỈ để hiển thị tham khảo ở màn Cài đặt.
   * Zalo Mini App SDK không có API đọc lại trạng thái theo dõi OA thật của khách, nên đây không
   * phải nguồn sự thật (khách có thể unfollow ở Zalo sau đó mà app không biết được).
   */
  followed: boolean;
}
const DEFAULT_OA_PROMPT_STATE: OaPromptState = { promptSeen: false, followed: false };

/** Đọc cờ đã-hỏi-theo-dõi-OA lưu trên máy (per-device, không đồng bộ server). */
export async function getOaPromptState(): Promise<OaPromptState> {
  try {
    const res = await getStorage({ keys: [OA_PROMPT_STORAGE_KEY] });
    const raw = (res as Record<string, unknown>)[OA_PROMPT_STORAGE_KEY];
    if (typeof raw === 'string') {
      return { ...DEFAULT_OA_PROMPT_STATE, ...(JSON.parse(raw) as Partial<OaPromptState>) };
    }
  } catch {
    /* ngoài Zalo / lỗi storage → coi như chưa hỏi lần nào, không chặn luồng */
  }
  return DEFAULT_OA_PROMPT_STATE;
}

/** Ghi cờ (merge với giá trị cũ) — gọi sau khi khách bấm theo dõi HOẶC bấm "Để sau". */
export async function setOaPromptState(patch: Partial<OaPromptState>): Promise<void> {
  try {
    const cur = await getOaPromptState();
    const next = { ...cur, ...patch };
    await setStorage({ data: { [OA_PROMPT_STORAGE_KEY]: JSON.stringify(next) } });
  } catch {
    /* ghi thất bại thì thôi — không chặn luồng UI vì việc này */
  }
}

/**
 * Điều kiện hiện thẻ mời theo dõi OA ngay sau đơn đầu tiên (xem order-detail.tsx). Tách hàm
 * thuần để unit test không cần dựng cả trang (mirror cách notifications.spec.ts test
 * notificationMeta/notificationOrderLink thay vì render toàn trang).
 *
 * Chỉ hiện khi CẢ BA: (a) đã cấu hình OA, (b) chưa từng hỏi/bị bỏ qua trên máy này, (c) đây là
 * đơn DUY NHẤT của khách (tức đơn đầu tiên) — KHÔNG hiện lại từ đơn thứ 2 trở đi, tránh làm phiền
 * khách quen (audit khuyến nghị không hỏi lúc cold app-open, chỉ hỏi đúng lúc thiện chí cao nhất).
 */
export function shouldShowFollowOaPrompt(params: {
  hasOA: boolean;
  promptSeen: boolean;
  ordersTotal: number | undefined;
}): boolean {
  return params.hasOA && !params.promptSeen && params.ordersTotal === 1;
}

/**
 * Lấy mã giới thiệu từ deep link mở app (?ref=CODE). ZMPRouter dùng hash nên param có thể
 * nằm ở window.location.search HOẶC trong phần query của hash. Parse cả hai, không phụ thuộc SDK.
 */
export function getLaunchReferral(): string | undefined {
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('ref');
    if (fromSearch) return fromSearch;
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx >= 0) {
      const fromHash = new URLSearchParams(hash.slice(qIdx + 1)).get('ref');
      if (fromHash) return fromHash;
    }
  } catch {
    /* ngoài webview / không có window → bỏ qua */
  }
  return undefined;
}

// openShareSheet (zmp_deep_link) của zmp-sdk từ chối cả lần chia sẻ khi thumbnail không phải URL, title quá 100 hay description quá 400 ký tự.
const SHARE_TITLE_MAX = 100;
const SHARE_DESCRIPTION_MAX = 400;
// Ảnh Open Graph tĩnh của web (apps/web/src/app/opengraph-image.png) cho sản phẩm hoặc gian hàng chưa có ảnh.
const SHARE_FALLBACK_THUMBNAIL = `${WEB_BASE_URL}/opengraph-image.png`;

function clipForShare(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const last = head.charCodeAt(head.length - 1);
  const lonelyHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return `${lonelyHighSurrogate ? head.slice(0, -1) : head}…`;
}

function shareThumbnail(url: string | undefined): string {
  try {
    const { protocol } = new URL(url ?? '');
    return protocol === 'http:' || protocol === 'https:' ? (url as string) : SHARE_FALLBACK_THUMBNAIL;
  } catch {
    return SHARE_FALLBACK_THUMBNAIL;
  }
}

/** Mở share sheet chia sẻ link sản phẩm (dùng cho Affiliate Phase 3). */
export async function shareLink(params: { title: string; description: string; thumbnail?: string; path: string }) {
  await openShareSheet({
    type: 'zmp_deep_link',
    data: {
      title: clipForShare(params.title, SHARE_TITLE_MAX),
      description: clipForShare(params.description, SHARE_DESCRIPTION_MAX),
      thumbnail: shareThumbnail(params.thumbnail),
      path: params.path,
    },
  });
}
