import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { BRAND_SLUG, mockBrandPage } from './support/shop-page-mocks';

/**
 * Thanh dính dưới thanh lùi đặc của Mini App (cao 56px + `--safe-top`), đo ở 375px với `--safe-top` 0 (trình duyệt) và 47 (tai thỏ).
 * `top` của phần tử dính tính từ mép NỘI DUNG của `.zaui-page`, tức cộng thêm đệm đầu của chính trang: trang `page-bleed` (thương hiệu) đệm
 * `--safe-top`; Vườn Xanh không dùng lớp `page` nên đệm 0. Viewport thấp để trang đủ dài mà cuộn.
 */
test.use({ viewport: { width: 375, height: 520 } });

const SAFE_TOPS = [0, 47] as const;

async function setSafeTop(page: Page, px: number): Promise<void> {
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--safe-top', `${value}px`));
  }, px);
}

const round = (n: number) => Math.round(n);

async function backBarHeight(page: Page): Promise<number> {
  return round((await page.locator('[data-back-bar]').boundingBox())!.height);
}

function mockGame(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-game', fullName: 'Người chơi E2E', pointsBalance: 900 }));
  api.get('/game/profile', {
    totalSeeds: 340, streakDays: 5, treeStage: 2, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
    ecoImpact: { progress: 40, target: 100, treeType: 'Cây Sưa Đỏ', treesPlanted: 3 }, treePointsPrice: 300, spinCostPoints: 10,
  });
  api.get('/game/quiz/today', []);
  api.get('/game/leaderboard', []);
  api.get('/game/missions', []);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/community', { goal: null, myDrops: 0, pct: 0 });
  api.get('/game/collection', []);
  api.get('/game/season', null);
  api.get('/game/season/leaderboard', []);
  api.get('/game/friends', []);
  api.get('/game/garden', {
    plots: [{ id: 'plot-home', slot: 1, isHome: true, treeType: 'Cây Sưa Đỏ', speciesId: null, progress: 40, target: 100, treeStage: 2, treesPlanted: 3, treeHealth: 'HEALTHY' }],
    maxPlots: 4,
    nextUnlock: { slot: 3, seedCost: 500 },
  });
  api.get('/me/loyalty', { pointsBalance: 900, redeemablePoints: 900, redeemableTotal: 900, tier: null, nextTier: null, tiers: [] });
  api.allowUnmocked('GET /game/season-pass', 'POST /events');
}

for (const safe of SAFE_TOPS) {
  test.describe(`--safe-top ${safe}px`, () => {
    test(`thương hiệu: thanh tab dính khít dưới thanh lùi, không hở`, async ({ page, api }) => {
      mockBrandPage(api);
      await setSafeTop(page, safe);
      await page.goto(`/brand/${BRAND_SLUG}`);
      const tablist = page.getByRole('tablist').first();
      await expect(tablist).toBeVisible({ timeout: 15_000 });
      const scroller = page.locator('.zaui-page', { has: tablist }).first();
      await scroller.evaluate((el) => el.scrollTo(0, 5000));
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(250);
      expect(await backBarHeight(page)).toBe(56 + safe);
      await expect.poll(async () => round((await page.getByTestId('brand-tabs-sticky').boundingBox())!.y), { timeout: 5_000 }).toBe(56 + safe);
    });

    test(`thương hiệu, tab Sản phẩm: thanh sắp xếp dính ngay dưới hàng tab, không chồng không hở`, async ({ page, api }) => {
      mockBrandPage(api);
      await setSafeTop(page, safe);
      await page.goto(`/brand/${BRAND_SLUG}`);
      await page.getByRole('tab', { name: 'Sản phẩm (45)' }).click();
      const tabs = page.getByTestId('brand-tabs-sticky');
      // Gốc của SortBar là cha của nhóm nút sắp xếp (thanh dính).
      const sortBar = page.getByRole('group', { name: 'Sắp xếp' }).locator('xpath=..');
      await expect(sortBar).toBeVisible({ timeout: 15_000 });
      const scroller = page.locator('.zaui-page', { has: tabs }).first();
      await scroller.evaluate((el) => el.scrollTo(0, 5000));
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(400);
      await expect.poll(async () => round((await tabs.boundingBox())!.y), { timeout: 5_000 }).toBe(56 + safe);
      const tabsBox = (await tabs.boundingBox())!;
      const sortBox = (await sortBar.boundingBox())!;
      // Khung tab cao 62px và thanh sắp xếp chồng lên 12px đệm dưới của nó (số đo hiện tại của thiết kế): không hở, không chồng lên chữ tab.
      expect(round(sortBox.y - (tabsBox.y + 62 - 12))).toBe(0);
    });

    test(`Vườn Xanh: thanh tab dính dưới vùng an toàn, và dưới thanh lùi khi có nút lùi`, async ({ page, api }) => {
      mockGame(api);
      await setSafeTop(page, safe);
      await page.goto('/game');
      const tablist = page.getByRole('tablist').first();
      await expect(tablist).toBeVisible({ timeout: 15_000 });
      const scroller = page.locator('.zaui-page', { has: tablist }).first();
      await scroller.evaluate((el) => el.scrollTo(0, 5000));
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
      const sticky = page.locator('.sticky-below-back');
      await expect.poll(async () => round((await sticky.boundingBox())!.y), { timeout: 5_000 }).toBe(safe);
      // Vào trang có `state.from` thì BackButton gắn lớp này lên <body>: thanh tab phải nằm dưới thanh lùi đặc.
      await page.evaluate(() => document.body.classList.add('with-back-btn'));
      await expect.poll(async () => round((await sticky.boundingBox())!.y), { timeout: 5_000 }).toBe(56 + safe);
    });
  });
}
