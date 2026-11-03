/**
 * Bề ngang chữ Inter 700 (số tabular) tính theo em. Số đo thật: chữ số 0,647em, dấu chấm 0,269em, "đ" 0,630em
 * (Chromium, packages/design-tokens/src/fonts/inter-700.woff2, "10.282.000đ" = 6,339em). Làm tròn lên một chút để dư an toàn.
 */
const DIGIT_EM = 0.65;
const SEPARATOR_EM = 0.27;
const D_EM = 0.63;

/**
 * Chỗ trống thật của chữ trong ô thống kê sau padding, tính theo em ở cỡ 15px: ô 3 cột ở khổ 320 còn khoảng 72px
 * (khổ 375 còn 90px). Lấy theo khổ hẹp nhất để "99.999.000đ" vẫn vừa.
 */
const CAPACITY_EM = 72 / 15;
const MIN_SCALE = 0.65;

function glyphEm(ch: string): number {
  if (ch === '.' || ch === ',' || ch === ' ') return SEPARATOR_EM;
  return ch === 'đ' ? D_EM : DIGIT_EM;
}

/** Bề ngang ước tính của chuỗi, theo em. */
export function statValueWidthEm(value: string): number {
  let em = 0;
  for (const ch of value) em += glyphEm(ch);
  return em;
}

/**
 * Hệ số co cỡ chữ (0,65 đến 1) để chuỗi như "10.282.000đ" nằm gọn một dòng trong ô thống kê hẹp thay vì rớt chữ "đ".
 * Chuỗi ngắn giữ nguyên cỡ. Chuỗi quá dài vẫn không dưới 0,65: phần dư bị cắt bằng dấu "…" ở chỗ dùng.
 */
export function statValueScale(value: string): number {
  const em = statValueWidthEm(value);
  if (em <= CAPACITY_EM) return 1;
  return Math.max(MIN_SCALE, Math.floor((CAPACITY_EM / em) * 100) / 100);
}

/** Giá trị CSS `font-size` cho ô thống kê, từ cỡ `body-md` của token. Dùng cho Mini (luôn khổ điện thoại). */
export function statValueFontSize(value: string): string {
  const s = statValueScale(value);
  return s === 1 ? 'var(--type-body-md-size)' : `calc(var(--type-body-md-size) * ${s})`;
}
