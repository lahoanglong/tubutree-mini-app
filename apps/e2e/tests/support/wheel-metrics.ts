import type { Page } from '@playwright/test';

/**
 * Số đo nhãn ô Vòng quay may mắn (Mini App và web dùng chung): bánh xe là phần tử có đúng 8 ô con, mỗi ô gồm emoji + nhãn. Đo lúc bánh đứng yên (rotation 0):
 * số dòng chữ, cỡ chữ, bán kính xa nhất của chữ tính từ tâm bánh và độ lệch góc lớn nhất của chữ so với tâm ô (nửa ô là 22,5 độ).
 */
export interface WheelLabelMetric {
  label: string;
  /** Số dòng chữ của nhãn (đếm theo toạ độ trên của từng hộp chữ). */
  lines: number;
  fontPx: number;
  /** Khoảng cách xa nhất từ tâm bánh tới mép chữ hoặc emoji của ô (px). */
  maxRadius: number;
  /** Lệch góc lớn nhất của mép chữ so với tâm ô (độ); trên 22,5 là chữ chạm sang ô bên cạnh. */
  maxHalfAngle: number;
}

export interface WheelMetrics {
  /** Bán kính phần ruột bánh (không tính viền). */
  innerRadius: number;
  labels: WheelLabelMetric[];
}

export async function measureWheel(page: Page): Promise<WheelMetrics> {
  return page.evaluate(() => {
    const wheel = Array.from(document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).find(
      (el) => el.children.length === 8 && Array.from(el.children).every((c) => c.children.length === 2),
    );
    if (!wheel) throw new Error('không thấy bánh xe vòng quay (phần tử aria-hidden có 8 ô)');
    const box = wheel.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(wheel).borderTopWidth) || 0;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const innerRadius = box.width / 2 - border;
    const labels = Array.from(wheel.children).map((slot, i) => {
      const [emoji, text] = Array.from(slot.children) as HTMLElement[];
      const range = document.createRange();
      range.selectNodeContents(text!);
      const rects = [...Array.from(range.getClientRects()).filter((r) => r.width > 0), emoji!.getBoundingClientRect()];
      const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      const center = i * 45 + 22.5;
      let maxRadius = 0;
      let maxHalfAngle = 0;
      for (const r of rects) {
        for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]] as const) {
          const dx = x - cx;
          const dy = cy - y;
          maxRadius = Math.max(maxRadius, Math.hypot(dx, dy));
          const angle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          const diff = Math.abs(((angle - center + 540) % 360) - 180);
          maxHalfAngle = Math.max(maxHalfAngle, diff);
        }
      }
      return {
        label: text!.textContent ?? '',
        lines: tops.size,
        fontPx: parseFloat(getComputedStyle(text!).fontSize),
        maxRadius: Math.round(maxRadius * 10) / 10,
        maxHalfAngle: Math.round(maxHalfAngle * 10) / 10,
      };
    });
    return { innerRadius, labels };
  });
}

/**
 * Chữ của ô không vượt viền bánh, tối đa 2 dòng, không nhỏ hơn 12px (cỡ chữ Mini App), và lệch góc không quá 26 độ.
 * Hai app cùng số đo nhãn (64px, 12px, dòng 1.15); lệch lớn nhất đo được là 24,7 độ ở "Giọt nước" khi ép chữ rộng (Verdana).
 */
export const WHEEL_MAX_HALF_ANGLE = 26;
export const WHEEL_MIN_FONT_PX = 12;
/** Không cho chữ chạm viền: nhãn xa tâm nhất đo được 110,2px (ép Verdana), ruột bánh 114px. */
export const WHEEL_RIM_TOLERANCE = 0;

export function wheelProblems(m: WheelMetrics): string[] {
  const problems: string[] = [];
  if (m.labels.length !== 8) problems.push(`vòng quay có ${m.labels.length} ô, cần 8`);
  m.labels.forEach((l, i) => {
    const at = `ô ${i + 1} "${l.label}"`;
    if (l.lines > 2) problems.push(`${at}: ${l.lines} dòng (tối đa 2)`);
    if (l.fontPx < WHEEL_MIN_FONT_PX) problems.push(`${at}: chữ ${l.fontPx}px (tối thiểu ${WHEEL_MIN_FONT_PX})`);
    if (l.maxRadius > m.innerRadius + WHEEL_RIM_TOLERANCE) problems.push(`${at}: chữ ra tới ${l.maxRadius}px, quá ruột bánh ${m.innerRadius}px (đè lên viền)`);
    if (l.maxHalfAngle > WHEEL_MAX_HALF_ANGLE) problems.push(`${at}: lệch ${l.maxHalfAngle} độ so với tâm ô (tối đa ${WHEEL_MAX_HALF_ANGLE})`);
  });
  return problems;
}
