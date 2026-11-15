import { DEFAULT_GOMDON_WEIGHT_FALLBACK } from './gomdon-config';

/**
 * Tổng cân nặng đơn (gram) + số kg thu gom tối đa — dùng CHUNG cho vận đơn Gomdon và ghi chú
 * Pancake (trước đây hai nơi tự tính với fallback khác nhau → kho thấy 2 con số khác nhau).
 * Variation thiếu/0 gram → dùng cân nặng mặc định (shipping.gomdon.config.defaultWeightFallback).
 * Miniapp checkout tính cùng công thức (fallback 500g) để hiển thị "tối đa ~X kg".
 */
export function recyclingWeight(
  items: { variationId: string; quantity: number }[],
  weightByVariation: Map<string, number | null | undefined>,
  fallbackGrams: number = DEFAULT_GOMDON_WEIGHT_FALLBACK,
): { totalGrams: number; maxKg: string } {
  const fallback = fallbackGrams > 0 ? fallbackGrams : DEFAULT_GOMDON_WEIGHT_FALLBACK;
  const totalGrams = items.reduce((sum, it) => {
    const raw = weightByVariation.get(it.variationId);
    const w = typeof raw === 'number' && raw > 0 ? raw : fallback;
    return sum + w * it.quantity;
  }, 0);
  return {
    totalGrams: totalGrams || fallback,
    maxKg: (Math.max(totalGrams, fallback) / 1000).toFixed(1),
  };
}

/** Trần cân nặng một kiện đổi hàng thu gom gửi Gomdon (gram). */
export const GOMDON_MAX_PARCEL_GRAMS = 10_000;

/**
 * Cân nặng gửi Gomdon + số kg ghi chú cho đơn đổi hàng kèm rác. `totalGrams`: cân hàng của đơn (recyclingWeight);
 * `returnGrams`: số gram khách khai gửi lại (null/0 = chưa khai). Cả hai bị chặn ở trần 10 kg của một kiện.
 */
export function recyclingParcel(
  totalGrams: number,
  returnGrams: number | null | undefined,
): { weight: number; maxKg: string; declaredKg: string } {
  const ret = typeof returnGrams === 'number' && returnGrams > 0 ? returnGrams : 0;
  const cap = Math.min(totalGrams, GOMDON_MAX_PARCEL_GRAMS);
  const maxKg = (cap / 1000).toFixed(1);
  return {
    weight: Math.min(Math.max(totalGrams, ret), cap),
    maxKg,
    declaredKg: ret > 0 ? (ret / 1000).toFixed(1) : maxKg,
  };
}
