import { qtyPickMax, stockText } from './commerce/stock-text';
import { pickDefaultVariation } from './flash-price';

type PickerVariation = { id: string; sku?: string; retailPrice: number; salePrice?: number | null; stock: number };

/** Sản phẩm từ 2 phân loại: Thêm vào giỏ và Mua ngay hỏi khách chọn phân loại; 1 phân loại thì thêm thẳng. */
export function needsVariationPicker(variations: readonly unknown[]): boolean {
  return variations.length >= 2;
}

/** Phân loại mở sẵn trong bảng chọn: giữ cái đang chọn nếu còn hàng, không thì phân loại còn hàng theo luật mặc định của thẻ. */
export function pickerStartId(variations: readonly PickerVariation[], preferredId: string | null | undefined): string | null {
  const preferred = preferredId ? variations.find((v) => v.id === preferredId && v.stock > 0) : undefined;
  return (preferred ?? pickDefaultVariation(variations))?.id ?? null;
}

/** Số lượng trong 1..trần nút + (`qtyPickMax`): tồn trên 20 không kẹp về tồn. */
export function clampPickerQty(variation: { stock: number } | undefined, qty: number): number {
  const max = qtyPickMax(variation?.stock ?? 0);
  return Math.min(Math.max(1, Math.floor(qty) || 1), max);
}

/** Dòng tồn kho của phân loại đang chọn trong bảng: cùng chữ với PDP và giỏ (`stockText`); màu cảnh báo cho tồn thấp do nơi vẽ lo (`isLowStock`). */
export function pickerStockText(stock: number): string {
  return stockText(stock);
}
