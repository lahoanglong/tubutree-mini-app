const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Màu do chủ nhãn/CTV nhập đi thẳng vào `style`: chỉ nhận `#RGB` hoặc `#RRGGBB`, mọi thứ khác (tên màu, `url(...)`, `;`, `}`...) bỏ đi
 * để không chèn được CSS. Trả `undefined` thì chỗ gọi dùng màu mặc định của token.
 */
export function safeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return HEX.test(v) ? v : undefined;
}

/**
 * `url("...")` an toàn cho ảnh nền lấy từ dữ liệu người dùng: ngoặc kép quanh URL và mã hoá ký tự phá chuỗi (`"`, `\`, xuống dòng)
 * để URL lạ không thoát khỏi `url()` (như StorePageShell của Mini App).
 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\r\n]/g, encodeURIComponent)}")`;
}
