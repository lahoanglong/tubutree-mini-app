import { test } from './support/mock-api';
import { STATES, mockWorld, openState, shootState } from './support/checkout-states';

/**
 * Màn /thanh-toan của web ở 375×812 (và 1280×800 cho các trạng thái đánh dấu `wide`) qua từng trạng thái của khách
 * (support/checkout-states.ts). Đặt HK_SHOT_DIR để chụp ảnh; không đặt thì chỉ kiểm màn dựng được ở trạng thái đó.
 */
for (const state of STATES) {
  for (const size of [375, 1280] as const) {
    if (size === 1280 && !state.wide) continue;
    test(`thanh-toan ${size}: ${state.name}`, async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await mockWorld(api, page, 'web', state, gate);
      await openState(page, 'web', size);
      await state.ready(page, 'web');
      await state.act?.(page, 'web', { release });
      await shootState(page, 'web', size, state.key);
      release();
    });
  }
}
