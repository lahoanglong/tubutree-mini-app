import { miniappPathFor } from './route-map';

/**
 * Link mở Zalo Mini App Tubu Tree (`https://zalo.me/s/<id>`), dùng cho nút "Mở trên Zalo" ở trang đăng nhập: khách đã dùng Zalo
 * vào Mini App là xong, không phải qua vòng OAuth của web. Chỉ đọc `NEXT_PUBLIC_ZALO_MINIAPP_ID` (ID của Mini App, khác App ID
 * của Zalo App dùng cho OAuth `NEXT_PUBLIC_ZALO_APP_ID`); không rơi về App ID vì link sẽ trỏ tới một Mini App không tồn tại.
 * Chưa cấu hình thì trả null và nút ẩn đi.
 *
 * `returnTo` là trang web khách đang xem: tra ngược route map để mở đúng màn Mini App tương ứng (sản phẩm → `/product/:slug`,
 * giỏ hàng → `/cart`...); trang không có màn tương ứng thì mở trang chủ.
 */
export function miniAppLink(returnTo?: string | null): string | null {
  const id = (process.env.NEXT_PUBLIC_ZALO_MINIAPP_ID ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  const base = `https://zalo.me/s/${id}`;
  const target = returnTo ? miniappPathFor(returnTo) : null;
  return `${base}${target ?? '/'}`;
}

/** Mở thẳng một đường dẫn Mini App đã biết (ví dụ `/points/scan`), cho màn không có trang web tương ứng để tra ngược. */
export function miniAppPathLink(miniappPath: string): string | null {
  const home = miniAppLink();
  if (!home) return null;
  return `${home.replace(/\/$/, '')}${miniappPath.startsWith('/') ? miniappPath : `/${miniappPath}`}`;
}
