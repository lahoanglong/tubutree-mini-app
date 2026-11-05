import { test } from './support/mock-api';
import { STATES, mockWorld, openState, shootState } from './support/checkout-states';

/**
 * Màn /checkout của Mini App ở 375×812 qua từng trạng thái của khách (support/checkout-states.ts). Đặt HK_SHOT_DIR để chụp ảnh;
 * không đặt thì chỉ kiểm màn dựng được ở trạng thái đó.
 */
for (const state of STATES) {
  test(`checkout 375: ${state.name}`, async ({ page, api }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockWorld(api, page, 'miniapp', state, gate);
    await openState(page, 'miniapp', 375);
    await state.ready(page, 'miniapp');
    await state.act?.(page, 'miniapp', { release });
    await shootState(page, 'miniapp', 375, state.key);
    release();
  });
}
