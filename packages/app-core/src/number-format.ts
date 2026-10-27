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

/** Hệ số nhân hợp lệ: tối đa hai chữ số thập phân; "1.000" (nhóm nghìn) không phải hệ số. */
const NUM = String.raw`(\d+(?:[.,]\d{1,2})?)`;
const PREFIX_MULT = new RegExp(String.raw`(^|[\s(])[xX×]${NUM}(?![\d\p{L}]|[.,]\d)`, 'gu');
const POSTFIX_MULT = new RegExp(String.raw`(^|[\s(])${NUM}[xX](?![\d\p{L}])`, 'gu');

/**
 * Quyền lợi hạng do admin nhập tay nên có thể còn kiểu cũ ("x1.2", "1.2x"): chỉ chuẩn hoá hệ số nhân thành "×1,2",
 * giữ nguyên phần chữ còn lại. Số có nhóm nghìn ("x1.000") không phải hệ số nên để nguyên.
 */
export function tierPerkLabel(perk: string): string {
  const mult = (n: string) => `×${n.replace('.', ',')}`;
  return perk
    .replace(PREFIX_MULT, (_m, pre: string, n: string) => `${pre}${mult(n)}`)
    .replace(POSTFIX_MULT, (_m, pre: string, n: string) => `${pre}${mult(n)}`);
}
