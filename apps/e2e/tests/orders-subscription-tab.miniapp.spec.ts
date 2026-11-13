import { test, expect } from './support/mock-api';
import { mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';

/** Cờ SUBSCRIPTIONS_IN_MINIAPP bật (W143): tab Định kỳ luôn hiện ở Đơn hàng, dù khách đã có gói hay chưa. API mock toàn bộ. */
test.describe('Mini App: tab Định kỳ theo gói của khách', () => {
  test('khách có gói: tab Định kỳ mở thẳng bằng /orders?tab=subscriptions và hiện gói', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders?tab=subscriptions');

    const tabs = page.getByRole('tablist');
    await expect(tabs.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible();
  });

  test('khách chưa có gói: vẫn có tab Định kỳ, ?tab=subscriptions mở tab đó với trạng thái rỗng và lối khám phá sản phẩm', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions', []);
    await page.goto('/orders?tab=subscriptions');

    const tabs = page.getByRole('tablist');
    await expect(tabs.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByText('Chưa có lịch đặt định kỳ')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Khám phá sản phẩm' })).toBeVisible();
  });
});
