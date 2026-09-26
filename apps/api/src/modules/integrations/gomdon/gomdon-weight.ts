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
