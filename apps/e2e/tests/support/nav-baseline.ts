import type { Locator } from '@playwright/test';

/** Đáy (getBoundingClientRect().bottom) của chữ nhãn từng tab trong thanh đáy: phần tử con cuối của mỗi tab (button ở Mini, a ở web). */
export const tabLabelBottoms = (nav: Locator) =>
  nav.evaluate((el) =>
    Array.from(el.querySelectorAll(':scope > button, :scope > a')).map((tab) => {
      const label = tab.lastElementChild as HTMLElement;
      return { text: (label.textContent ?? '').trim(), bottom: label.getBoundingClientRect().bottom };
    }),
  );

export const MAX_BASELINE_DRIFT_PX = 0.5;
