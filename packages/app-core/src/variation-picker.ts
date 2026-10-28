import { pickDefaultVariation, variationPricing, type FlashPriceItem, type VariationPricingResult } from './flash-price';

type PickerVariation = { id: string; sku?: string; retailPrice: number; salePrice?: number | null; stock: number };

/** Còn từng này trở xuống thì bảng chọn ghi "Chỉ còn N". */
const LOW_STOCK_NOTICE = 5;

/** Sản phẩm từ 2 phân loại: Thêm vào giỏ và Mua ngay hỏi khách chọn phân loại; 1 phân loại thì thêm thẳng. */
export function needsVariationPicker(variations: readonly unknown[]): boolean {
  return variations.length >= 2;
}

/** Phân loại mở sẵn trong bảng chọn: giữ cái đang chọn nếu còn hàng, không thì phân loại còn hàng theo luật mặc định của thẻ. */
export function pickerStartId(variations: readonly PickerVariation[], preferredId: string | null | undefined): string | null {
  const preferred = preferredId ? variations.find((v) => v.id === preferredId && v.stock > 0) : undefined;
  return (preferred ?? pickDefaultVariation(variations))?.id ?? null;
}

export function clampPickerQty(variation: { stock: number } | undefined, qty: number): number {
  const max = Math.max(1, variation?.stock ?? 1);
  return Math.min(Math.max(1, Math.floor(qty) || 1), max);
}

export function pickerStockText(stock: number): string {
  if (stock <= 0) return 'Hết hàng';
  return stock <= LOW_STOCK_NOTICE ? `Chỉ còn ${stock}` : `Còn ${stock}`;
}

/** Giá một dòng chọn trong bảng: cùng luật Giờ vàng với trang chi tiết. */
export function pickerView(variation: PickerVariation, flash: readonly FlashPriceItem[]): VariationPricingResult {
  return variationPricing(variation, flash);
}
