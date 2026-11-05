import { test } from './support/mock-api';
import { STATES, mockWorld, openState, shootState } from './support/order-detail-states';

/**
 * Màn /order/:code của Mini App ở 375×812 qua từng trạng thái của đơn (support/order-detail-states.ts). Đặt HL_SHOT_DIR để chụp ảnh;
 * không đặt thì chỉ kiểm màn dựng được ở trạng thái đó.
 */
for (const state of STATES) {
  test(`order-detail 375: ${state.name}`, async ({ page, api }) => {
    const w = await mockWorld(api, page, 'miniapp', state, Date.now());
    await openState(page, 'miniapp', 375, w.order.code);
    await state.ready(page);
    await shootState(page, 'miniapp', 375, state.key);
  });
}
