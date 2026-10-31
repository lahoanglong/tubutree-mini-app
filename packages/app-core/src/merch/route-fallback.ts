/**
 * Đích thật của các lối "Xem tất cả" / lối tắt mà `SHELVES` khai theo route Mini. Trang của gói sau (`/flash-sale` P12, `/best-sellers` P13,
 * `/vouchers` P14) chưa có: trong lúc chờ, khách đi tới trang đang có thay vì màn không tìm thấy. Gói nào thêm route thì xoá dòng
 * `pending` của mình (cả hai nền) và route đó đi thẳng. Route Mini → route web cho những lối Trang chủ cần.
 */
interface Entry { mini: string; web: string; pending: boolean }

const ENTRIES: Record<string, Entry> = {
  '/flash-sale': { mini: '/flash-sale', web: '/gio-vang', pending: true },
  '/best-sellers': { mini: '/best-sellers', web: '/ban-chay', pending: true },
  '/vouchers': { mini: '/vouchers', web: '/ma-giam-gia', pending: true },
  '/orders': { mini: '/orders', web: '/tai-khoan/don-hang', pending: false },
  '/browse': { mini: '/browse', web: '/san-pham', pending: false },
};

/**
 * `usable: false` = trang thay thế không hiện nội dung mà lối đó hứa (Ưu đãi không có Giờ vàng, cũng không có "Nhắc tôi"): lối vào phải ẩn tới khi route thật có.
 * `/flash-sale` đang ở trạng thái này nên Trang chủ không còn chỗ đặt "Nhắc tôi" Giờ vàng: không deploy khi P12 (trang Giờ vàng) chưa vào cùng.
 */
const PENDING_TARGET: Record<string, { mini: string; web: string; usable: boolean }> = {
  '/flash-sale': { mini: '/offers', web: '/uu-dai', usable: false },
  '/best-sellers': { mini: '/browse?sort=best_seller', web: '/san-pham?sort=best_seller', usable: true },
  '/vouchers': { mini: '/offers?section=coupons', web: '/uu-dai', usable: true },
};

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
