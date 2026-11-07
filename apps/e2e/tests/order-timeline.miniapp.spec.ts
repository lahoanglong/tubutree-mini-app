import { test, expect } from './support/mock-api';
import { mockWorld } from './support/order-detail-states';
import { stateOf } from './support/order-tracking-flow';
import { expectNoPressMotion, expectPressFeedback, probeTapTargets } from './support/touch-probe';
import { W43B_SIZES, expectOrderCopy, expectOrderTimeline, glowAnimation, stubClipboard } from './support/wave43b';

/**
 * W43B: thanh tiến trình 4 bước + nút "Sao chép thông tin đơn" ở /order/:code của Mini App, ở 375×812 và 1440×900. Chạy Chromium (phép đo hệ số co chập chờn
 * trên WebKit Linux của CI, xem touch-press.miniapp.spec.ts). API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

for (const size of W43B_SIZES) {
  test.describe(`Mini App thanh tiến trình đơn ${size.width}×${size.height}`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize(size);
    });

    test('đơn đang giao: bốn bước, bước hiện tại, giờ số đều, chép thông tin đơn vào clipboard', async ({ page, api }) => {
      await stubClipboard(page);
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await page.goto(`/order/${w.order.code}`);
      await state.ready(page);
      const tracker = await expectOrderTimeline(page);
      await expectOrderCopy(page, tracker, w.order.code);
    });

    test('mọi điều khiển trong thanh tiến trình có vùng chạm thật ≥ 44px và nút Sao chép co khi nhấn', async ({ page, api }) => {
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await page.goto(`/order/${w.order.code}`);
      await state.ready(page);
      const tracker = await expectOrderTimeline(page);
      expect(await probeTapTargets(page, { scope: '[data-testid="order-timeline-tracker"]' })).toEqual([]);
      await expectPressFeedback(page, tracker.getByRole('button', { name: 'Sao chép thông tin đơn' }), 'nút Sao chép thông tin đơn');
    });

    test('chuyển động: chấm bước hiện tại nhấp nhô khi cho phép, đứng yên và nút không co khi giảm chuyển động', async ({ page, api }) => {
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(`/order/${w.order.code}`);
      await state.ready(page);
      const tracker = await expectOrderTimeline(page);
      expect(await glowAnimation(page)).toBe('order-step-glow');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await glowAnimation(page)).toBe('none');
      await expectNoPressMotion(page, tracker.getByRole('button', { name: 'Sao chép thông tin đơn' }), 'nút Sao chép thông tin đơn');
    });

    test('đơn huỷ rẽ nhánh: chỉ Đã tiếp nhận rồi Đã huỷ, không có bước hiện tại', async ({ page, api }) => {
      const state = stateOf('cancelled');
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await page.goto(`/order/${w.order.code}`);
      await state.ready(page);
      const tracker = page.getByTestId('order-timeline-tracker');
      const steps = tracker.locator('li[data-step]');
      await expect(steps).toHaveCount(2);
      expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))).toEqual(['completed', 'cancelled']);
      await expect(steps.nth(1)).toContainText('Đã huỷ');
      await expect(tracker.locator('[aria-current="step"]')).toHaveCount(0);
    });
  });
}
