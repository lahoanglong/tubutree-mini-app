import type { Page } from '@playwright/test';

/**
 * Số đo thật của một ô thống kê trang Cá nhân (Điểm Xanh, Ví Tubu, Mã giảm giá), tìm theo chữ nhãn dưới số.
 * - `lines`: số dòng chữ của số (đếm theo đỉnh từng mảnh chữ), phải là 1.
 * - `left`, `right`: khoảng từ mép ô tới mép chữ thật (không phải mép khối div căn giữa).
 * - `overflow`: phần chữ tràn khỏi khối số (scrollWidth − clientWidth).
 */
export interface StatFacts {
  text: string;
  lines: number;
  left: number;
  right: number;
  overflow: number;
  cellWidth: number;
}

export function statFacts(page: Page, label: string): Promise<StatFacts & { font: string; inter: boolean }> {
  return page.evaluate(async (label) => {
    // font-display: swap: chưa nạp xong Inter thì chữ đang ở phông dự phòng, đo lúc đó là đo sai phông.
    await document.fonts.ready;
    const caption = Array.from(document.querySelectorAll('div')).find((d) => d.children.length === 0 && d.textContent === label);
    if (!caption?.parentElement) throw new Error(`không thấy ô thống kê "${label}"`);
    const cell = caption.parentElement;
    const value = cell.firstElementChild as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(value);
    const text = range.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    const style = getComputedStyle(value);
    return {
      font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      inter: document.fonts.check(`${style.fontWeight} ${style.fontSize} Inter`),
      text: value.textContent ?? '',
      lines: tops.size,
      left: text.left - box.left,
      right: box.right - text.right,
      overflow: value.scrollWidth - value.clientWidth,
      cellWidth: box.width,
    };
  }, label);
}

/** Điểm Xanh từ 1.000 và Ví từ 10 triệu tới 100 triệu: các mốc đổi số ký tự. */
export const STAT_CASES = [
  { points: 1_000, wallet: 10_000_000, pointsText: '1.000 điểm', walletText: '10.000.000đ' },
  { points: 99_999, wallet: 99_999_999, pointsText: '99.999 điểm', walletText: '99.999.999đ' },
  { points: 999_999, wallet: 100_000_000, pointsText: '999.999 điểm', walletText: '100.000.000đ' },
];

/** Cách mép ô ít nhất 6px: 4px đệm của ô cộng 2px để chữ không dính sát viền bo. */
export const STAT_MIN_GAP = 6;

/** Màn 414px (ô ~125px): đủ chỗ thì giữ cỡ price-md 16px, không thu nhỏ như ở 320px. */
export const WIDE_CASE = { points: 999_999, wallet: 100_000_000, pointsText: '999.999 điểm', walletText: '100.000.000đ' };
