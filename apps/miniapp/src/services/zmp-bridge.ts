import {
  getAccessToken,
  getPhoneNumber,
  getUserInfo,
  getLocation,
  login as zmpLogin,
  openShareSheet,
  openWebview,
  openChat,
} from 'zmp-sdk/apis';

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

/** Lấy thông tin hiển thị cơ bản (tên, avatar) — cần quyền scope.userInfo. */
export async function getZaloUserInfo() {
  const { userInfo } = await getUserInfo({ autoRequestPermission: true });
  return userInfo;
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
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  } catch {
    /* bỏ qua lỗi clipboard */
  }

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

/** Mở share sheet chia sẻ link sản phẩm (dùng cho Affiliate Phase 3). */
export async function shareLink(params: { title: string; description: string; thumbnail?: string; path: string }) {
  await openShareSheet({
    type: 'zmp_deep_link',
    data: {
      title: params.title,
      description: params.description,
      thumbnail: params.thumbnail ?? '',
      path: params.path,
    },
  });
}
