const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Màu do chủ nhãn nhập được đưa thẳng vào `style`; dữ liệu cũ trong DB có thể chưa qua kiểm của API,
 * nên chỉ cho qua mã hex để chuỗi tuỳ ý không thành khai báo CSS.
 */
export function safeHexColor(value: string | null | undefined): string | undefined {
  return value && HEX_COLOR.test(value) ? value : undefined;
}
