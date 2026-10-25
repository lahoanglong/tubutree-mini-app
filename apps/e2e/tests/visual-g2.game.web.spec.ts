import { mkdirSync } from 'fs';
import path from 'path';
import { test, expect } from './support/mock-api';
import { installVisualMode, settle } from './support/visual';
import { mockNewbieGame, newbieProfile } from './support/game-newbie-states';

/** Chụp hộp chúc mừng và vòng quay ở 375px (đợt G2). Ảnh vào GAME_SHOTS_DIR; cặp của visual-g2.game.miniapp.spec.ts. */
const OUT = process.env.GAME_SHOTS_DIR;
const USER = {
  id: 'u-newbie', fullName: 'Khách mới', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 20000, pointsConvertedBalance: 0, walletBalance: 0,
};

test('chụp g2 hộp chúc mừng và vòng quay (web)', async ({ page, api }) => {
  test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
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
  api.get('/game/missions', [
    { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', rewardPoints: 20000, progress: 0, goal: 1, completed: false, claimed: false },
    { code: 'INVITE_3', title: 'Mời 3 bạn', rewardPoints: 50000, progress: 0, goal: 3, completed: false, claimed: false },
  ]);
  api.post('/game/tree/water', () => ({ progress: 5, target: 300, harvested: true, treesPlanted: 1, reward: { points: 2000 } }));
  api.post('/game/spin', () => ({ prize: { id: 'p', name: '30 giọt nước', rewardType: 'SEEDS', value: 30 } }));
  await page.goto('/vuon-xanh');
  mkdirSync(path.join(OUT!, 'web'), { recursive: true });
  await page.getByRole('button', { name: 'Tưới hết (65💧)' }).click({ timeout: 15_000 });
  await expect(page.getByText('Thu hoạch thành công!')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: path.join(OUT!, 'web', 'harvest-dialog.png') });
  await page.getByRole('button', { name: 'Tuyệt vời!' }).click();
  await page.getByRole('button', { name: 'Quay vòng quay' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Quay vòng quay' }).click();
  await expect(page.getByText('Chúc mừng!')).toBeVisible({ timeout: 10_000 });
  await settle(page);
  await page.screenshot({ path: path.join(OUT!, 'web', 'wheel-result.png') });
  await page.getByRole('button', { name: 'Tuyệt vời!' }).click();
  await settle(page);
  await page.getByRole('heading', { name: 'Vòng quay may mắn' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT!, 'web', 'wheel.png') });
});
