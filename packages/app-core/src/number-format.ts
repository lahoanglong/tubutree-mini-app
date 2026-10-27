/** Số nguyên kiểu Việt có dấu chấm nghìn: 1000 → "1.000". Rác (null/NaN/vô cực) → "0". */
export function formatVnNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  // `+ 0` đổi -0 thành 0 (toLocaleString in "-0").
  return ((Number.isFinite(v) ? v : 0) + 0).toLocaleString('vi-VN');
}

/** Hệ số nhân dùng dấu phẩy: 1.5 → "1,5", 2 → "2"; thiếu hay không dương thì "1" để không nhân sai lên. */
export function formatMultiplier(x: number | null | undefined): string {
  const v = Number(x ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '1';
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

/** "×1,2": dấu nhân và dấu phẩy, một kiểu duy nhất cho cả Mini App và web. */
export function multiplierLabel(x: number | null | undefined): string {
  return `×${formatMultiplier(x)}`;
}

/**
 * Quyền lợi hạng do admin nhập tay nên có thể còn kiểu cũ ("x1.2"): chỉ chuẩn hoá hệ số nhân thành "×1,2",
 * giữ nguyên phần chữ còn lại.
 */
export function tierPerkLabel(perk: string): string {
  return perk.replace(/(^|[\s(])[x×](\d+(?:[.,]\d+)?)(?![\w.,])/gi, (_m, pre: string, num: string) => `${pre}×${num.replace('.', ',')}`);
}
