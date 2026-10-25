import { mkdirSync } from 'fs';
import path from 'path';
import { expect, test } from './support/mock-api';
import { installVisualMode, settle } from './support/visual';
import { NEWBIE_STATES, mockNewbieGame } from './support/game-newbie-states';

/** Cặp của visual-tour.game.miniapp.spec.ts: /vuon-xanh ở 375x812 cùng dữ liệu giả. */
const OUT = process.env.GAME_SHOTS_DIR;
const USER = {
  id: 'u-newbie', fullName: 'Khách mới', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

for (const state of NEWBIE_STATES) {
  test(`chụp /vuon-xanh ${state}`, async ({ page, api }) => {
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
    mockNewbieGame(api, state);
    await page.goto('/vuon-xanh');
    await expect(page.getByRole('tab', { name: 'Hôm nay' })).toBeVisible({ timeout: 30_000 });
    await settle(page);
    mkdirSync(path.join(OUT!, 'web'), { recursive: true });
    await page.screenshot({ path: path.join(OUT!, 'web', `${state}.png`), fullPage: true });
  });
}
