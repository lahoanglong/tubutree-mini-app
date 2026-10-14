/** Sản phẩm của các dòng đang mua cho VoucherSheet; undefined khi API cũ chưa trả productId (không khoá mã theo sản phẩm). */
export function cartProductIds(lines: { productId?: string }[]): string[] | undefined {
  return lines.every((l) => l.productId) ? lines.map((l) => l.productId!) : undefined;
}
