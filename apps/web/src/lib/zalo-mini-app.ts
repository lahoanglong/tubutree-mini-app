/**
 * Link mở Zalo Mini App Tubu Tree (`https://zalo.me/s/<id>`), dùng cho nút "Mở trên Zalo" ở trang đăng nhập: khách đã dùng Zalo
 * vào Mini App là xong, không phải qua vòng OAuth của web. Dùng chung `NEXT_PUBLIC_ZALO_APP_ID` với đăng nhập web (đã được
 * Dockerfile/compose truyền lúc build) thay vì thêm biến mới; chưa cấu hình thì trả null và nút ẩn đi.
 *
 * `returnTo` là trang khách đang muốn mua: sản phẩm thì mở đúng sản phẩm đó trong Mini App (`/product/:slug`), còn lại mở trang chủ.
 */
export function miniAppLink(returnTo?: string | null): string | null {
  const id = (process.env.NEXT_PUBLIC_ZALO_APP_ID ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  const base = `https://zalo.me/s/${id}`;
  const product = returnTo ? /^\/san-pham\/([^/?#]+)/.exec(returnTo) : null;
  return product ? `${base}/product/${product[1]}` : `${base}/`;
}
