/** Chỗ chứa một chuỗi số trong ô thống kê hẹp (bề ngang chữ 70px ở cỡ 15px), tính theo em. */
const CAPACITY_EM = 70 / 15;
const MIN_SCALE = 0.65;

function glyphEm(ch: string): number {
  return ch === '.' || ch === ',' || ch === ' ' ? 0.3 : 0.6;
}

/**
 * Hệ số co cỡ chữ (0,65 đến 1) để chuỗi như "10.282.000đ" nằm gọn một dòng trong ô 78px thay vì rớt chữ "đ".
 * Ước theo bề ngang chữ số đậm; chuỗi ngắn giữ nguyên cỡ.
 */
export function statValueScale(value: string): number {
  let em = 0;
  for (const ch of value) em += glyphEm(ch);
  if (em <= CAPACITY_EM) return 1;
  return Math.max(MIN_SCALE, Math.floor((CAPACITY_EM / em) * 100) / 100);
}

/** Giá trị CSS `font-size` cho ô thống kê, từ cỡ `body-md` của token. */
export function statValueFontSize(value: string): string {
  const s = statValueScale(value);
  return s === 1 ? 'var(--type-body-md-size)' : `calc(var(--type-body-md-size) * ${s})`;
}
