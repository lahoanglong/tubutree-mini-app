/**
 * Số hiển thị của Vườn Xanh, cùng dáng với Mini App (apps/miniapp/src/utils/format.ts): dấu chấm nghìn kiểu vi-VN,
 * rác (null/NaN/vô cực) thành "0" thay vì "NaN".
 */
export function formatNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  // `+ 0` đổi -0 thành 0 (toLocaleString in "-0").
  return ((Number.isFinite(v) ? v : 0) + 0).toLocaleString('vi-VN');
}

/** Giọt nước 💧: 1250 → "1.250💧". */
export function formatDrops(n: number | null | undefined): string {
  return `${formatNumber(n)}💧`;
}

export function formatPoints(n: number | null | undefined): string {
  return `${formatNumber(n)} điểm`;
}
