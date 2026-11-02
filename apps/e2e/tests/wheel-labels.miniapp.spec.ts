import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockNewbieGame, newbieProfile } from './support/game-newbie-states';
import { installVisualMode, settle } from './support/visual';
import { measureWheel, wheelProblems } from './support/wheel-metrics';

/**
 * Nhãn ô Vòng quay may mắn ở 375px (Mini App): ô COUPON đọc "Mã giảm giá" (D2) mà chữ vẫn nằm trong ruột bánh, tối đa 2 dòng, không nhỏ hơn 12px.
 * Hộp nhãn rộng 64px để "Mã giảm giá" xuống 2 dòng: ở 72px nó là một dòng ngang và chạm viền bánh ở ô thứ 6 (đo 119,3px so với ruột 114px). Cặp web: wheel-labels.web.spec.ts.
 */
test('Vòng quay 375px: nhãn "Mã giảm giá" ở cả hai ô COUPON, mọi nhãn nằm trong ruột bánh', async ({ page, api }) => {
  await installVisualMode(page);
  await page.setViewportSize({ width: 375, height: 812 });
  mockSession(api, makeUser({ id: 'u-newbie', fullName: 'Khách mới', pointsBalance: 20000 }));
  mockNewbieGame(api, 'after-checkin');
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65 });
  api.get('/me/loyalty', { pointsBalance: 20000, redeemablePoints: 20000, redeemableTotal: 20000, tier: null, nextTier: null, tiers: [] });
  await page.goto('/game');
  await page.getByRole('heading', { name: 'Vòng quay may mắn' }).scrollIntoViewIfNeeded({ timeout: 20_000 });
  await settle(page);

  const m = await measureWheel(page);
  const coupon = m.labels.filter((l) => l.label === 'Mã giảm giá');
  expect(coupon, 'hai ô COUPON đều ghi "Mã giảm giá"').toHaveLength(2);
  expect(coupon.map((l) => l.lines), '"Mã giảm giá" xuống 2 dòng trong ô').toEqual([2, 2]);
  expect(coupon.map((l) => l.maxRadius <= m.innerRadius), 'nhãn mã giảm nằm trọn trong ruột bánh').toEqual([true, true]);
  expect(wheelProblems(m)).toEqual([]);
});
