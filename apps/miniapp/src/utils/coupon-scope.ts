/** Sản phẩm của các dòng đang mua cho VoucherSheet; undefined khi API cũ chưa trả productId (không khoá mã theo sản phẩm). */
/**
 * Dấu vân tay các dòng đang tính cho xem trước mức giảm mã: đổi số lượng, giá (giờ vàng) hay dòng là số cũ hết đúng.
 */
export function cartPreviewKey(lines: { id: string; quantity: number; total: number }[]): string {
  return lines.map((l) => `${l.id}:${l.quantity}:${l.total}`).join(',');
}

export function cartProductIds(lines: { productId?: string }[]): string[] | undefined {
  return lines.every((l) => l.productId) ? lines.map((l) => l.productId!) : undefined;
}
