/**
 * Đích thật của các lối "Xem tất cả" / lối tắt mà `SHELVES` khai theo route Mini (route Mini → route web cho những lối Trang chủ cần). Hiện không route
 * nào chờ: mọi trang đã có. Gói nào khai lối tới một trang chưa làm thì đặt `pending: true` ở đây và thêm dòng thay thế vào `PENDING_TARGET`
 * (trang đang có thay vì màn không tìm thấy); trang xong thì xoá cả hai dấu đó.
 */
interface Entry { mini: string; web: string; pending: boolean }

const ENTRIES: Record<string, Entry> = {
  '/flash-sale': { mini: '/flash-sale', web: '/gio-vang', pending: false },
  '/best-sellers': { mini: '/best-sellers', web: '/ban-chay', pending: false },
  '/vouchers': { mini: '/vouchers', web: '/ma-giam-gia', pending: false },
  '/orders': { mini: '/orders', web: '/tai-khoan/don-hang', pending: false },
  '/browse': { mini: '/browse', web: '/san-pham', pending: false },
};

/**
 * `usable: false` = trang thay thế không hiện nội dung mà lối đó hứa: lối vào phải ẩn tới khi route thật có. Hiện không route nào chờ nên bảng rỗng.
 */
const PENDING_TARGET: Record<string, { mini: string; web: string; usable: boolean }> = {};

/** Lối vào route này có đáng hiện không: route đã có thật, route lạ, hoặc route đang chờ mà trang thay thế vẫn đúng điều lối hứa. */
export function routeUsable(miniRoute: string): boolean {
  const entry = ENTRIES[miniRoute];
  return !entry?.pending || PENDING_TARGET[miniRoute]!.usable;
}

/** `miniRoute` là route Mini như `SHELVES` khai; trả đường dẫn dùng được trên nền `platform`. Route lạ trả nguyên. */
export function liveRoute(miniRoute: string, platform: 'mini' | 'web'): string {
  const entry = ENTRIES[miniRoute];
  if (!entry) return miniRoute;
  if (entry.pending) return PENDING_TARGET[miniRoute]![platform];
  return entry[platform];
}
