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
