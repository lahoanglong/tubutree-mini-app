import { test, expect } from './support/mock-api';
import { mockNewbieGame, newbieProfile } from './support/game-newbie-states';
import { installVisualMode, settle } from './support/visual';
import { measureWheel, wheelProblems } from './support/wheel-metrics';

/** Cặp web của wheel-labels.miniapp.spec.ts: cùng phép đo nhãn ô Vòng quay ở 375px, web dùng cùng số đo nhãn với Mini (64px, chữ 12px, dòng 1.15). */
const USER = {
  id: 'u-newbie', fullName: 'Khách mới', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 20000, pointsConvertedBalance: 0, walletBalance: 0,
};

test('Vòng quay 375px (web): nhãn "Mã giảm giá" ở cả hai ô COUPON, mọi nhãn nằm trong ruột bánh', async ({ page, api }) => {
  await installVisualMode(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  mockNewbieGame(api, 'after-checkin');
  api.get('/game/profile', { ...newbieProfile('after-checkin'), totalSeeds: 65 });
  api.get('/me/loyalty', { pointsBalance: 20000, redeemablePoints: 20000, redeemableTotal: 20000, tier: null, nextTier: null, tiers: [] });
  await page.goto('/vuon-xanh');
  await page.getByRole('heading', { name: 'Vòng quay may mắn' }).scrollIntoViewIfNeeded({ timeout: 30_000 });
  await settle(page);

  const m = await measureWheel(page);
  const coupon = m.labels.filter((l) => l.label === 'Mã giảm giá');
  expect(coupon, 'hai ô COUPON đều ghi "Mã giảm giá"').toHaveLength(2);
  expect(coupon.map((l) => l.lines), '"Mã giảm giá" xuống 2 dòng trong ô').toEqual([2, 2]);
  expect(coupon.map((l) => l.maxRadius <= m.innerRadius), 'nhãn mã giảm nằm trọn trong ruột bánh').toEqual([true, true]);
  expect(wheelProblems(m)).toEqual([]);
});
