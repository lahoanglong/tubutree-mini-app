import type { Page } from '@playwright/test';
import { test, expect, publicConfig } from './support/mock-api';
import { mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';
import { mockCheckout } from './support/checkout-mocks';
import { eventsNamed, flushEvents } from './support/events';
import { expectNoHorizontalOverflow } from './support/game-mini-mocks';

/**
 * tubu-w16-01, Mini App: dòng mời bạn ở màn Đặt hàng thành công (cờ growth.referral_viral_enabled + earnsPoints của /me/green-card) và gợi ý
 * giao định kỳ theo nhịp mua (GET /me/subscriptions/suggestions) ở tab Định kỳ, cùng chữ và test-id với web. API mock toàn bộ.
 */

const CARD = { referralCode: 'LAN2026', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const SUGGESTION = {
  variationId: 'var-giat',
  productName: 'Nước giặt Tubu',
  variationName: 'Can 3,8L',
  slug: 'nuoc-giat',
  thumbnail: null,
  unitPrice: 189_000,
  intervalWeeks: 6,
  lastDeliveredAt: '2026-11-01T00:00:00.000Z',
};

async function placeOrder(page: Page) {
  await page.goto('/checkout');
  const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
  await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
  await placeBtn.click();
  await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 10_000 });
}

test.describe('w16-01 Mini: lời mời bạn sau khi đặt hàng', () => {
  for (const width of [320, 375]) {
    test(`${width}px: một dòng mời dưới các nút chính, cao >= 44px, không tràn ngang; chạm chia sẻ xong nút hết bận`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      mockCheckout(api);
      api.get('/config/public', publicConfig({ referralViralEnabled: true }));
      api.get('/me/green-card', CARD);
      api.post('/events', { accepted: 1 });
      await placeOrder(page);

      const nudge = page.getByTestId('order-invite-nudge');
      await expect(nudge).toBeVisible({ timeout: 10_000 });
      await expect(nudge).toHaveCount(1);
      await expect(nudge).toContainText('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
      await expect(nudge).toContainText('Chia sẻ qua Zalo');
      const track = (await page.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
      const keepShopping = (await page.getByRole('button', { name: 'Tiếp tục mua sắm' }).boundingBox())!;
      const box = (await nudge.boundingBox())!;
      expect(box.y, 'dòng mời nằm dưới nút Theo dõi đơn').toBeGreaterThan(track.y + track.height - 1);
      expect(box.y, 'dòng mời nằm dưới nút Tiếp tục mua sắm').toBeGreaterThan(keepShopping.y + keepShopping.height - 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expectNoHorizontalOverflow(page);

      await nudge.click();
      await flushEvents(page);
      await expect.poll(() => eventsNamed(api, 'green_card_shared').map((e) => e.props), { timeout: 5_000 }).toEqual([{ method: 'share', surface: 'order' }]);
      await expect(nudge).not.toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });
      await expect(page.getByText(/Chưa chia sẻ (qua Zalo được|hay sao chép được)/)).toHaveCount(0);
    });
  }

  test('cờ tắt: không gọi /me/green-card, không có dòng mời', async ({ page, api }) => {
    mockCheckout(api);
    api.get('/config/public', publicConfig({ referralViralEnabled: false }));
    api.get('/me/green-card', CARD);
    await placeOrder(page);
    await expect(page.getByRole('button', { name: 'Theo dõi đơn' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('order-invite-nudge')).toHaveCount(0);
    expect(api.callsTo('GET', '/me/green-card')).toHaveLength(0);
  });
});

test.describe('w16-01 Mini: gợi ý giao định kỳ theo nhịp mua', () => {
  test('tab Định kỳ chưa có gói: dòng gợi ý trên trạng thái rỗng; chạm mở sheet Đặt định kỳ chọn sẵn 6 tuần', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions', []);
    api.get('/me/subscriptions/suggestions', { enabled: true, items: [SUGGESTION] });
    api.get('/me/addresses', []);
    api.allowUnmocked('GET /me/wallet', 'POST /events');
    await page.goto('/orders?tab=subscriptions');

    const row = page.getByTestId('subscription-suggestion');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveText('Bạn thường mua Nước giặt Tubu khoảng 6 tuần một lần. Đặt giao định kỳ, giảm 12%');
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
    const empty = (await page.getByRole('button', { name: 'Khám phá sản phẩm' }).boundingBox())!;
    expect(rowBox.y, 'gợi ý nằm trên lối khám phá sản phẩm').toBeLessThan(empty.y);
    await expectNoHorizontalOverflow(page);

    await row.click();
    const interval = page.getByRole('group', { name: 'Chu kỳ giao' });
    await expect(interval).toBeVisible({ timeout: 10_000 });
    await expect(interval.getByRole('button', { name: '6 tuần' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('khách đang có gói: không hỏi gợi ý, không có dòng', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/subscriptions/suggestions', { enabled: true, items: [SUGGESTION] });
    await page.goto('/orders?tab=subscriptions');
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('subscription-suggestion')).toHaveCount(0);
    expect(api.callsTo('GET', '/me/subscriptions/suggestions')).toHaveLength(0);
  });
});
