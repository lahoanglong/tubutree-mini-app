import { test, expect } from './support/mock-api';
import { mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';

/** Tab Định kỳ ở Mini App chỉ hiện cho khách đã có gói (đặt trên web); cờ SUBSCRIPTIONS_IN_MINIAPP vẫn tắt. API mock toàn bộ. */
test.describe('Mini App: tab Định kỳ theo gói của khách', () => {
  test('khách có gói: có tab Định kỳ, /orders?tab=subscriptions mở thẳng tab đó', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders?tab=subscriptions');

    const tabs = page.getByRole('tablist');
    await expect(tabs.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible();
  });

  test('khách không có gói: không có tab Định kỳ, ?tab=subscriptions rơi về Tất cả', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions', []);
    await page.goto('/orders?tab=subscriptions');

    await expect(page.getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByRole('tablist').getByRole('tab', { name: 'Định kỳ' })).toHaveCount(0);
  });
});
