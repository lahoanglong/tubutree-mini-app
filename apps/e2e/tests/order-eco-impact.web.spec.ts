import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { STATES, mockWorld } from './support/order-detail-states';
import { expectNoHorizontalOverflow, expectTargets44 } from './support/game-mini-mocks';

/**
 * Thẻ nhựa đã giảm ở Chi tiết đơn web (tubu-w11-03, cờ growth.referral_viral_enabled): đơn đã giao có gói Refill thì thẻ có số chai, câu thưởng mời và hai nút 44px; dòng "Thích Tubu Tree? Mời bạn sống xanh" không hiện thêm. Cờ tắt thì không gọi API của thẻ.
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
  api.get('/config/public', {
    ...publicConfig({
      referralViralEnabled: viral,
      shippingEta: { minDays: 1, maxDays: 3 },
      returnWindowDays: 7,
      support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null },
    }),
    referralShareCardEnabled: true,
  });
  api.allowUnmocked('POST /events');
}

for (const { width, height, project } of [
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
]) {
  test.describe(`Thẻ nhựa đã giảm web ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `khổ ${width}px chạy ở project ${project}`));

    test('đơn đã giao có Refill: thẻ số chai, thưởng mời, hai nút 44px; không còn dòng mời thứ hai; sao chép ghi link có mã', async ({ page, api }) => {
      const w = await mockWorld(api, page, 'web', DELIVERED, Date.now());
      config(api, true);
      api.get('/me/eco-impact/orders/:code', ({ params }) => ({ ...IMPACT, orderCode: params.code }));
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
      const card = page.getByTestId('order-eco-impact');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByRole('heading', { level: 2 })).toHaveText('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
      await expect(card).not.toContainText('Điểm Xanh từ đơn này');
      await expect(card).toContainText('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
      await expect(card.getByRole('button')).toHaveCount(2);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole('link', { name: 'Mời bạn sống xanh' })).toHaveCount(0);
      await card.getByRole('button', { name: 'Sao chép link' }).click();
      await expect(card.getByRole('status')).toHaveText('Đã sao chép link mời bạn');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('XANH42');
      if (SHOTS) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/web-${width}-eco-card.png` });
      }
    });

    test('cờ tắt: không gọi API của thẻ, không thẻ, dòng mời cũ vẫn còn', async ({ page, api }) => {
      const w = await mockWorld(api, page, 'web', DELIVERED, Date.now());
      config(api, false);
      api.get('/me/eco-impact/orders/:code', { ...IMPACT, orderCode: w.order.code });
      await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
      await expect(page.getByRole('link', { name: 'Mời bạn sống xanh' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('order-eco-impact')).toHaveCount(0);
      expect(api.callsTo('GET', '/me/eco-impact/orders/:code')).toHaveLength(0);
    });
  });
}
