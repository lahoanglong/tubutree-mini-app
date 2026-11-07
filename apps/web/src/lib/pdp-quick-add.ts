/**
 * Cầu nối giữa khối đánh giá và khối mua của trang sản phẩm (hai thành phần anh em, không cha con): lightbox ảnh đánh giá bấm "Thêm vào giỏ"
 * thì `requestPdpQuickAdd()` báo cho `AddToCart` chạy đúng luồng thêm giỏ của nút trên trang (chọn phân loại, đăng nhập, tồn kho như nhau).
 * `AddToCart` đăng ký bằng `onPdpQuickAdd`; chưa ai đăng ký (trang không có khối mua) thì `canPdpQuickAdd()` là false và lightbox không hiện nút.
 */
const handlers = new Set<() => void>();

export function onPdpQuickAdd(handler: () => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function canPdpQuickAdd(): boolean {
  return handlers.size > 0;
}

export function requestPdpQuickAdd(): void {
  for (const handler of Array.from(handlers)) handler();
}
