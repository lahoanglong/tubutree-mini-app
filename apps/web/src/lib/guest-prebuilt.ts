/**
 * Trang cần đăng nhập mà khách vãng lai mở nhiều (Giỏ hàng, Vườn Xanh) có thêm một bản ISR dựng sẵn giao diện khách: HTML đầu đã có khối lớn
 * nhất của khách (giỏ trống + kệ gợi ý, khối giới thiệu Vườn Xanh) thay vì khung chờ đăng nhập, nên LCP không phải đợi JS tải xong và phiên
 * khôi phục xong. Middleware chỉ chuyển tới bản này khi chắc là khách chưa có phiên và (với giỏ) giỏ khách trống; URL trình duyệt giữ nguyên.
 * Module thuần (không 'use client', không đụng window) vì middleware chạy ở edge.
 */
import { SESSION_COOKIE } from './home-restore-hint';

/** Cookie `1` khi giỏ khách (localStorage) có món: bản dựng sẵn vẽ giỏ trống, nên khách có món phải đi bản thường. */
export const GUEST_CART_COOKIE = 'tubu_guest_cart';

/** Đường dẫn thật → đường dẫn bản dựng sẵn (app/gio-hang/khach, app/vuon-xanh/khach). */
export const GUEST_PREBUILT_ROUTES: Readonly<Record<string, string>> = {
  '/gio-hang': '/gio-hang/khach',
  '/vuon-xanh': '/vuon-xanh/khach',
};

/** Bản dựng sẵn → đường dẫn thật: vào thẳng bản dựng sẵn thì chuyển về đường dẫn thật, không có hai URL cho một trang. */
export const GUEST_PREBUILT_ORIGINS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(GUEST_PREBUILT_ROUTES).map(([path, prebuilt]) => [prebuilt, path]),
);

/**
 * Bản dựng sẵn cho request này, hoặc null (đi bản thường). Có cookie phiên thì luôn bản thường (khung chờ đang khôi phục phiên), vì bản khách
 * vẽ giao diện khách rồi mới đổi sang tài khoản là chớp sai. Cookie là dữ liệu của trình duyệt: chỉ đúng giá trị `1` mới tính.
 */
export function guestPrebuiltTarget(pathname: string, cookie: (name: string) => string | undefined): string | null {
  const target = GUEST_PREBUILT_ROUTES[pathname];
  if (!target || cookie(SESSION_COOKIE) === '1') return null;
  if (pathname === '/gio-hang' && cookie(GUEST_CART_COOKIE) === '1') return null;
  return target;
}
