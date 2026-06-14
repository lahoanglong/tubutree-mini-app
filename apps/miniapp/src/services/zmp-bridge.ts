import {
  getAccessToken,
  getPhoneNumber,
  getUserInfo,
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
 * Lấy access token Zalo, CÓ RETRY — lỗi đã biết của Zalo SDK: getAccessToken() hay
 * fail/empty ở lần gọi đầu (ngay sau login), thành công ở lần sau. Thử tối đa 4 lần,
 * mỗi lần re-login + chờ tăng dần. Trả token hoặc throw lỗi cuối.
 */
export async function getZaloAccessToken(): Promise<ZaloLoginResult> {
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      await zmpLogin({});
      const accessToken = await getAccessToken({});
      if (accessToken && accessToken.length > 0) return { accessToken, code: accessToken };
      lastErr = new Error('empty access token');
    } catch (e) {
      lastErr = e;
      // -1401 = "app chưa kích hoạt" — lỗi VĨNH VIỄN, retry vô ích → bail ngay để fallback guest nhanh.
      const code = typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
      if (code === -1401) break;
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

/** Lấy thông tin hiển thị cơ bản (tên, avatar) — cần quyền scope.userInfo. */
export async function getZaloUserInfo() {
  const { userInfo } = await getUserInfo({ autoRequestPermission: true });
  return userInfo;
}

/** Mở URL ngoài (deeplink sàn cashback) trong webview Zalo. */
export async function openExternal(url: string) {
  await openWebview({ url });
}

/** OA Tubu đã cấu hình chưa (để hiện nút "Nhắn hỗ trợ"). */
export const OA_ID = (import.meta.env.VITE_ZALO_OA_ID as string | undefined) ?? '';
export const hasOA = Boolean(OA_ID);

/** Mở chat Zalo OA hỗ trợ (spec §6.4). Gate theo VITE_ZALO_OA_ID. */
export async function openOAChat(message?: string) {
  if (!OA_ID) return;
  await openChat({ type: 'oa', id: OA_ID, message });
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
