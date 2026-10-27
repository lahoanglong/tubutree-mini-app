/** Phần trăm hiển thị: nguyên, kẹp 0–100; số lạ (NaN, Infinity) → 0. */
export function clampPercent(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
}

/** "Đã bán %" của một suất giờ vàng. Bán quá suất, suất 0 hoặc số lạ không được in ra 150%, NaN%. */
export function soldPercent(sold: number, quota: number): number {
  return quota > 0 ? clampPercent((sold / quota) * 100) : 0;
}

export { flashDisplay } from '@tubutree/app-core/flash-price';
