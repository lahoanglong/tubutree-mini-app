export const PDP_NAV_EVENT = 'tubu:pdp-nav';

/** Báo cho khung chờ biết sắp mở trang sản phẩm bằng `router.push` (không có thẻ a để bắt lúc bấm). Tách file để nơi gọi không kéo theo khung chờ. */
export function announcePdpNavigation(href: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PDP_NAV_EVENT, { detail: href }));
}
