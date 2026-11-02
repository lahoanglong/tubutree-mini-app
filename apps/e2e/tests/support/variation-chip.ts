import { expect, type Locator } from '@playwright/test';

/**
 * Số đo chip phân loại 2 dòng ở khổ 375px, chung cho Mini App và web khổ điện thoại: dòng tên 22px (`Text variant="body-sm"`), dòng giá 20px
 * (`variant="caption"`), đệm 8px trên và dưới, và chiều cao chip đúng bằng hai dòng + đệm + viền, không có khoảng thừa (dòng chống đỡ quanh dòng
 * inline-flex từng làm chip Mini cao hơn web). Không đo cứng "61px" vì bề dày viền 1,5px được làm tròn theo mật độ điểm ảnh của từng thiết bị
 * giả lập (iPhone 12 của Mini cho 1,33px, trình duyệt máy tính của web cho 1px), nên đọc bề dày viền từ computed style.
 * Hai spec (flash-sheet-price.miniapp.spec.ts, flash-sheet-price.web.spec.ts) cùng gọi hàm này để hai app không lệch nhau.
 */
export const CHIP_NAME_ROW_375 = 22;
export const CHIP_PRICE_ROW_375 = 20;
export const CHIP_PAD_375 = 16;

export async function expectChipMetrics(chip: Locator): Promise<void> {
  const m = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    const rows = Array.from(el.children)
      .filter((c) => {
        const s = getComputedStyle(c);
        return s.display !== 'none' && s.position !== 'absolute';
      })
      .map((c) => c.getBoundingClientRect().height);
    return {
      height: el.getBoundingClientRect().height,
      rows,
      pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
      border: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
    };
  });
  expect(m.rows).toHaveLength(2);
  expect(m.rows[0]).toBeCloseTo(CHIP_NAME_ROW_375, 0);
  expect(m.rows[1]).toBeCloseTo(CHIP_PRICE_ROW_375, 0);
  expect(m.pad).toBe(CHIP_PAD_375);
  expect(m.height).toBeCloseTo(m.rows[0]! + m.rows[1]! + m.pad + m.border, 0);
}
