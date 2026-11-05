import { test } from './support/mock-api';
import { STATES, mockWorld, openState, shootState } from './support/order-detail-states';

/**
 * Màn /tai-khoan/don-hang/:code của web ở 375×812 và 1280×800 qua từng trạng thái của đơn (support/order-detail-states.ts). Đặt
 * HL_SHOT_DIR để chụp ảnh; không đặt thì chỉ kiểm màn dựng được ở trạng thái đó.
 */
for (const state of STATES) {
  for (const size of [375, 1280] as const) {
    if (size === 1280 && !state.wide) continue;
    test(`don-hang ${size}: ${state.name}`, async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
      const w = await mockWorld(api, page, 'web', state, Date.now());
      await openState(page, 'web', size, w.order.code);
      await state.ready(page);
      await shootState(page, 'web', size, state.key);
    });
  }
}
