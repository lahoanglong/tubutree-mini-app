import type { Page } from '@playwright/test';
import { xmasTierName } from '../../../packages/app-core/src/seasonal/xmas-arcade';
import { fillCopy } from '../../../packages/app-core/src/shop-copy';
import { xmasTreeCopy } from '../../../packages/app-core/src/seasonal/xmas-tree';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { xmasShot } from './support/christmas-home';
import { mockNewbieGame } from './support/game-newbie-states';
import { ARCADE_TODAY_ROWS, expectNoHorizontalOverflow, expectTargets44, mergeResult, miniToday, mockMiniGames, openMiniGameHub, playMergeToEnd, startRound } from './support/game-mini-mocks';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Zalo Mini App, mùa Noel (tubu-w57-02), API mock toàn bộ: Cây Thông Noel Tự Trang Trí ở thẻ đầu Vườn Xanh (nút chính của ngày vẫn trong màn đầu
 * 375×812, khay 6 ô ≥ 44px, món treo nhớ sau khi mở lại) và áo Noel của Sảnh Game (tên Hứng Bông Tuyết, 2048 bậc Noel vừa ô ở 360px, Xưởng Gói
 * Quà, ánh lấp lánh ở màn kết quả). Có XMAS_SHOTS_DIR thì chụp ảnh 375px cho báo cáo.
 */
const VIEW = { width: 375, height: 812 };
const BOTTOM_NAV = 76;
const XMAS = { seasonalTheme: 'christmas' } as const;

function gardenWorld(api: MockApi) {
  const entry = tourEntries().find((e) => e.key === '/game')!;
  const user = tourUser(entry.role);
  mockSession(api, user);
  mockTourWorld(api, user);
  entry.setup?.(api);
  api.get('/config/public', publicConfig({ aiAdvisorEnabled: true, freeshipThreshold: 500_000, ...XMAS }));
  return entry;
}

function arcadeWorld(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-xmas-arcade', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
  // Ván Ghép thắng (tới 256): màn kết quả có lấp lánh (ván thua thì không, xem `arcadeResultCelebration`).
  const merge = mergeResult({ review: { game: 'eco_merge', score: 9_120, maxTile: 256, moves: 420, won: true } });
  const games = mockMiniGames(api, { today: miniToday({ games: [...miniToday().games, ...ARCADE_TODAY_ROWS] }), merge });
  api.get('/config/public', publicConfig(XMAS));
  return games;
}

async function openArcade(page: Page, game: 'eco_merge' | 'green_conveyor') {
  await openMiniGameHub(page);
  await page.getByTestId(`mini-play-row-${game}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/play/${game}$`));
  await startRound(page);
}

test.describe('Vườn Xanh mùa Noel (Mini App 375px)', () => {
  test.use({ viewport: VIEW });

  test('cây thông thay cây đang lớn; nút chính còn trong màn đầu; khay treo/cất món và nhớ sau khi mở lại', async ({ page, api }) => {
    const entry = gardenWorld(api);
    await page.addInitScript(() => window.localStorage.setItem('tubu_garden_hint_seen', '1'));
    await page.goto(entry.miniapp);

    const hero = page.getByTestId('garden-hero');
    await expect(hero).toHaveAttribute('data-season', 'christmas', { timeout: 15_000 });
    await expect(page.getByTestId('xmas-tree').first()).toBeVisible();
    const open = page.getByTestId('xmas-decorate');
    await expect(open).toHaveText(new RegExp(`${xmasTreeCopy.decorate}\\s*${xmasTreeCopy.count(0)}`));
    const ob = (await open.boundingBox())!;
    expect(Math.min(ob.width, ob.height)).toBeGreaterThanOrEqual(44);

    const primary = page.getByTestId('garden-day-actions').getByRole('button').first();
    await expect(primary).toBeVisible();
    const p = (await primary.boundingBox())!;
    expect(p.y + p.height, 'nút chính của ngày vẫn ở màn đầu').toBeLessThanOrEqual(VIEW.height - BOTTOM_NAV);
    await expectNoHorizontalOverflow(page);
    await xmasShot(page, 'mini-375-garden-hero');

    await open.click();
    const sheet = page.getByTestId('xmas-garden-sheet');
    await expect(sheet).toBeVisible();
    const slots = sheet.locator('.tubu-xgd-slot');
    await expect(slots).toHaveCount(6);
    await expectTargets44(sheet);
    let hung = 0;
    for (let i = 0; i < 6; i++) {
      const slot = slots.nth(i);
      if ((await slot.getAttribute('data-state')) !== 'ready') continue;
      await slot.click();
      await expect(slot).toHaveAttribute('aria-pressed', 'true');
      hung += 1;
    }
    expect(hung, 'ít nhất ngôi sao mở được').toBeGreaterThanOrEqual(1);
    const locked = sheet.locator('.tubu-xgd-slot[data-state="locked"]').first();
    if ((await locked.count()) > 0) {
      await locked.click();
      await expect(page.getByTestId('xmas-msg')).not.toBeEmpty();
    }
    await xmasShot(page, 'mini-375-decorated-tree');

    const cta = page.getByRole('button', { name: xmasTreeCopy.shareCta });
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    await expect(page.getByTestId('xmas-card')).toContainText(xmasTreeCopy.greeting);
    await xmasShot(page, 'mini-375-share-card');

    await page.reload();
    await expect(page.getByTestId('xmas-decorate')).toHaveText(new RegExp(xmasTreeCopy.count(hung)), { timeout: 15_000 });
  });
});

test.describe('Sảnh Game mùa Noel (Mini App)', () => {
  for (const viewport of [
    { width: 360, height: 640 },
    VIEW,
  ]) {
    test(`${viewport.width}px: 2048 bậc Noel vừa ô, chơi hết ván, màn kết quả lấp lánh`, async ({ page, api }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      const { submits } = arcadeWorld(api);
      await openMiniGameHub(page);
      await expect(page.getByTestId('arcade-game-dew_catcher')).toContainText(fillCopy('arcade.dew.xmasTitle'), { timeout: 15_000 });
      if (viewport.width === 375) await xmasShot(page, 'mini-375-xmas-hub');
      await page.getByTestId('mini-play-row-eco_merge').click();
      await startRound(page);

      const board = page.getByTestId('mini-eco-merge');
      await expect(board).toHaveAttribute('data-season', 'christmas');
      const first = page.getByTestId('eco-merge-tile').first();
      const value = Number(await first.getAttribute('data-value'));
      await expect(first.locator('.tubu-ar-tile-name')).toHaveText(xmasTierName(value));
      // Tên bậc dài nhất vẫn trọn trong ô (không "…", không tràn) ở khổ hẹp: đặt lần lượt từng tên vào ô thật rồi đo.
      const names = [2, 4, 8, 16, 32, 64, 128, 256].map(xmasTierName);
      const overflow = await first.evaluate((tile, list) => {
        const label = tile.querySelector<HTMLElement>('.tubu-ar-tile-name')!;
        const keep = label.textContent;
        const bad = list.filter((n) => {
          label.textContent = n;
          return label.scrollWidth > label.clientWidth + 1 || label.getBoundingClientRect().right > tile.getBoundingClientRect().right + 1;
        });
        label.textContent = keep;
        return bad;
      }, names);
      expect(overflow, 'tên bậc Noel tràn ô').toEqual([]);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 375) await xmasShot(page, 'mini-375-xmas-2048');

      await playMergeToEnd(page);
      expect(submits).toHaveLength(1);
      // Phần chấm giả của máy chủ: maxTile 256. Màn kết quả mùa Noel ghi tên bậc Noel như bàn chơi.
      await expect(page.getByTestId('mini-result-score')).toContainText(xmasTierName(256));
      await expect(page.getByTestId('mini-result-sparkle')).toBeAttached();
      if (viewport.width === 375) await xmasShot(page, 'mini-375-xmas-2048-result');
    });
  }

  test('375px: Xưởng Gói Quà (Băng Chuyền áo Noel) chạy ván, thùng ≥ 44px', async ({ page, api }) => {
    await page.setViewportSize(VIEW);
    arcadeWorld(api);
    await openArcade(page, 'green_conveyor');
    const panel = page.getByTestId('mini-green-conveyor');
    await expect(panel).toHaveAttribute('data-season', 'christmas');
    await expect(panel.locator('.tubu-ar-item').first()).toBeVisible({ timeout: 10_000 });
    await expectTargets44(panel);
    await expectNoHorizontalOverflow(page);
    await xmasShot(page, 'mini-375-xmas-conveyor');
  });
});
