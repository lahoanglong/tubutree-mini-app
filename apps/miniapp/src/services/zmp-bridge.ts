import {
  getAccessToken,
  getUserInfo,
  login as zmpLogin,
  openShareSheet,
  openWebview,
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
}

/** Đảm bảo đã login Zalo rồi lấy access token. */
export async function getZaloAccessToken(): Promise<ZaloLoginResult> {
  await zmpLogin({});
  const accessToken = await getAccessToken({});
  return { accessToken, code: accessToken };
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
