import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fillCopy } from '../../../packages/app-core/src/shop-copy';
import { xmasTreeCopy } from '../../../packages/app-core/src/seasonal/xmas-tree';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { xmasShot } from './support/christmas-home';
import { mockNewbieGame } from './support/game-newbie-states';
import { ARCADE_TODAY_ROWS, expectNoHorizontalOverflow, expectTargets44, miniToday, mockMiniGames, startRound } from './support/game-mini-mocks';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Web khách khổ điện thoại, mùa Noel (tubu-w57-02), cùng luồng với Mini App (`christmas-garden.miniapp.spec.ts`): cây thông tự trang trí ở thẻ đầu
 * Vườn Xanh, khay 6 ô, "Chia sẻ thiệp" ra ảnh PNG (trình duyệt không có Web Share thì tải về), 2048 và Băng Chuyền áo Noel. Có XMAS_SHOTS_DIR thì chụp 375px
 * và lưu ảnh thiệp PNG thật.
 */
const VIEW = { width: 375, height: 812 };
const XMAS = { seasonalTheme: 'christmas' } as const;

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
      localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

test.use({ viewport: VIEW });
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

test('Vườn Xanh mùa Noel 375px: cây thông, khay treo món, "Chia sẻ thiệp" tải ảnh PNG khi không có Web Share', async ({ page, api }) => {
  const entry = tourEntries().find((e) => e.key === '/game')!;
  const user = tourUser(entry.role);
  mockSession(api, user);
  mockTourWorld(api, user);
  entry.setup?.(api);
  api.get('/config/public', publicConfig({ aiAdvisorEnabled: true, freeshipThreshold: 500_000, ...XMAS }));
  await signedIn(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await page.goto(entry.web);

  await expect(page.getByTestId('garden-hero')).toHaveAttribute('data-season', 'christmas', { timeout: 20_000 });
  const open = page.getByTestId('xmas-decorate');
  await expect(open).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await xmasShot(page, 'web-375-garden-hero');

  await open.click();
  const sheet = page.getByTestId('xmas-garden-sheet');
  await expect(sheet.locator('.tubu-xgd-slot')).toHaveCount(6);
  await expectTargets44(sheet);
  const star = page.getByTestId('xmas-slot-star');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await xmasShot(page, 'web-375-decorated-tree');

  const cta = page.getByRole('button', { name: xmasTreeCopy.shareCtaWeb });
  await cta.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), cta.click()]);
  expect(download.suggestedFilename()).toBe('cay-thong-noel-xanh.png');
  await expect(page.getByTestId('xmas-msg')).toHaveText(xmasTreeCopy.saved);
  const file = await download.path();
  expect(statSync(file).size, 'ảnh thiệp có nội dung').toBeGreaterThan(10_000);
  await xmasShot(page, 'web-375-share-card');
  const dir = process.env.XMAS_SHOTS_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, path.join(dir, 'web-share-card-720x960.png'));
  }
});

function arcadeWorld(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-web-xmas', fullName: 'Khách game', phone: '0912345678', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
  mockMiniGames(api, { today: miniToday({ games: [...miniToday().games, ...ARCADE_TODAY_ROWS] }) });
  api.get('/config/public', publicConfig(XMAS));
}

test('Sảnh Game mùa Noel 375px: Hứng Bông Tuyết, 2048 bậc Noel, Xưởng Gói Quà', async ({ page, api }) => {
  arcadeWorld(api);
  await signedIn(page);
  await page.goto('/vuon-xanh?tab=games');
  await expect(page.getByTestId('arcade-card-dew_catcher')).toContainText(fillCopy('arcade.dew.xmasTitle'), { timeout: 20_000 });

  await page.goto('/vuon-xanh/choi/eco_merge');
  await startRound(page);
  await expect(page.getByTestId('mini-eco-merge')).toHaveAttribute('data-season', 'christmas');
  await expectNoHorizontalOverflow(page);
  await xmasShot(page, 'web-375-xmas-2048');

  await page.goto('/vuon-xanh/choi/green_conveyor');
  await startRound(page);
  const panel = page.getByTestId('mini-green-conveyor');
  await expect(panel).toHaveAttribute('data-season', 'christmas');
  await expect(panel.locator('.tubu-ar-item').first()).toBeVisible({ timeout: 10_000 });
  await xmasShot(page, 'web-375-xmas-conveyor');
});
