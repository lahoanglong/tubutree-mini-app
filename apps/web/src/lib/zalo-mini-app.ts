import { miniappPathFor } from './route-map';

/** ID Mini App chính thức (https://zalo.me/s/2070857098114207963/). */
export const DEFAULT_MINIAPP_ID = '2070857098114207963';

/**
 * Link mở Zalo Mini App Tubu Tree (`https://zalo.me/s/<id>`), dùng cho nút "Mở trên Zalo" ở trang đăng nhập: khách đã dùng Zalo
 * vào Mini App là xong, không phải qua vòng OAuth của web. Chỉ đọc `NEXT_PUBLIC_ZALO_MINIAPP_ID` (ID của Mini App, khác App ID
 * của Zalo App dùng cho OAuth `NEXT_PUBLIC_ZALO_APP_ID`); không rơi về App ID vì link sẽ trỏ tới một Mini App không tồn tại.
 * Chưa cấu hình (hoặc cấu hình hỏng) thì dùng ID Mini App chính thức của Tubu Tree, để nút luôn có và khách không bị ngõ cụt.
 *
 * `returnTo` là trang web khách đang xem: tra ngược route map để mở đúng màn Mini App tương ứng (sản phẩm → `/product/:slug`,
 * giỏ hàng → `/cart`...); trang không có màn tương ứng thì mở trang chủ.
 */
export function miniAppLink(returnTo?: string | null): string {
  const configured = (process.env.NEXT_PUBLIC_ZALO_MINIAPP_ID ?? '').trim();
  const id = /^\d+$/.test(configured) ? configured : DEFAULT_MINIAPP_ID;
  const base = `https://zalo.me/s/${id}`;
  const target = returnTo ? miniappPathFor(returnTo) : null;
  return `${base}${target ?? '/'}`;
}

/** Mở thẳng một đường dẫn Mini App đã biết (ví dụ `/points/scan`), cho màn không có trang web tương ứng để tra ngược. */
export function miniAppPathLink(miniappPath: string): string {
  const home = miniAppLink();
  return `${home.replace(/\/$/, '')}${miniappPath.startsWith('/') ? miniappPath : `/${miniappPath}`}`;
}
