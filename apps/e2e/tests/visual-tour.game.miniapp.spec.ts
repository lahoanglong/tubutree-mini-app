import { mkdirSync } from 'fs';
import path from 'path';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { installVisualMode, settle } from './support/visual';
import { NEWBIE_STATES, mockNewbieGame } from './support/game-newbie-states';

/**
 * Chụp /game của Mini App ở 375x812 cho ba trạng thái phiên đầu, để so với visual-tour.game.web.spec.ts.
 * Ảnh vào GAME_SHOTS_DIR (mặc định không chụp). Tên tệp khớp bên web: <trạng thái>.png.
 */
const OUT = process.env.GAME_SHOTS_DIR;

for (const state of NEWBIE_STATES) {
  test(`chụp /game ${state}`, async ({ page, api }) => {
    test.skip(!OUT, 'đặt GAME_SHOTS_DIR để chụp');
    await installVisualMode(page);
    await page.setViewportSize({ width: 375, height: 812 });
    mockSession(api, makeUser({ id: 'u-newbie', fullName: 'Khách mới', pointsBalance: 0 }));
    mockNewbieGame(api, state);
    await page.goto('/game');
    await expect(page.getByRole('tab', { name: 'Hôm nay' })).toBeVisible({ timeout: 15_000 });
    await settle(page);
    mkdirSync(path.join(OUT!, 'miniapp'), { recursive: true });
    await page.screenshot({ path: path.join(OUT!, 'miniapp', `${state}.png`), fullPage: true });
  });
}
