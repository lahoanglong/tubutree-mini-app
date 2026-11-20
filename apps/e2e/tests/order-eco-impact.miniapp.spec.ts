import type { Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { STATES, mockWorld } from './support/order-detail-states';
import { expectNoHorizontalOverflow, expectTargets44 } from './support/game-mini-mocks';

/**
 * Thẻ nhựa đã giảm ở Chi tiết đơn Mini App (tubu-w11-03), cùng hành vi với web (`order-eco-impact.web.spec.ts`): thẻ số chai + điểm + thưởng mời
 * + hai nút 44px, không thêm dòng mời thứ hai; cờ tắt thì không gọi API của thẻ.
 */

const DELIVERED = STATES.find((s) => s.key === 'delivered')!;
const IMPACT = {
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: true,
  referralCode: 'XANH42',
  inviteReward: { points: 100, minOrderAmount: 199_000 },
};
const SHOTS = process.env.ECO_IMPACT_SHOTS_DIR;

function config(api: MockApi, viral: boolean) {
  api.get(
    '/config/public',
    publicConfig({
      referralViralEnabled: viral,
      referralShareCardEnabled: true,
      shippingEta: { minDays: 1, maxDays: 3 },
      returnWindowDays: 7,
      support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null },
    }),
  );
  api.allowUnmocked('POST /events');
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => ((window as unknown as { __copied: string }).__copied = t, Promise.resolve()) },
    });
  });
}

test.describe('Thẻ nhựa đã giảm Mini App 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('đơn đã giao có Refill: thẻ số chai, điểm, thưởng mời, hai nút 44px; không còn dòng mời thứ hai; sao chép ghi link có mã', async ({ page, api }) => {
    const w = await mockWorld(api, page, 'miniapp', DELIVERED, Date.now());
    config(api, true);
    api.get('/me/eco-impact/orders/:code', ({ params }) => ({ ...IMPACT, orderCode: params.code }));
    await stubClipboard(page);
    await page.goto(`/order/${w.order.code}`);
    const card = page.getByTestId('order-eco-impact');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    await expect(card).toContainText('+120 Điểm Xanh từ đơn này');
    await expect(card).toContainText('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    await expect(card.getByRole('button')).toHaveCount(2);
    await expectTargets44(card);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Mời bạn sống xanh' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Sao chép link' }).click();
    await expect(page.getByText('Đã sao chép link mời bạn')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '')).toContain('XANH42');
    if (SHOTS) {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/mini-390-eco-card.png` });
    }
  });

  test('cờ tắt: không gọi API của thẻ, không thẻ, dòng mời cũ vẫn còn', async ({ page, api }) => {
    const w = await mockWorld(api, page, 'miniapp', DELIVERED, Date.now());
    config(api, false);
    api.get('/me/eco-impact/orders/:code', { ...IMPACT, orderCode: w.order.code });
    await page.goto(`/order/${w.order.code}`);
    await expect(page.getByRole('button', { name: 'Mời bạn sống xanh' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('order-eco-impact')).toHaveCount(0);
    expect(api.callsTo('GET', '/me/eco-impact/orders/:code')).toHaveLength(0);
  });
});
