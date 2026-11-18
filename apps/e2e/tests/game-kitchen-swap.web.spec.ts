import { mkdirSync } from 'fs';
import path from 'path';
import type { Locator, Page } from '@playwright/test';
import { kitchenCopy } from '../../../packages/app-core/src/game-mini/kitchen-copy';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import {
  expectNoHorizontalOverflow,
  expectTargets44,
  gameCopy,
  KITCHEN_PICKS,
  KITCHEN_SET,
  KITCHEN_SWAPS,
  KITCHEN_TODAY_ROW,
  miniToday,
  mockMiniGames,
  mockMiniShop,
  startRound,
} from './support/game-mini-mocks';

/**
 * Căn Bếp Xanh trên web (chỉ phát ở web): trọn ván bằng chạm ở 360/390/768px, bằng bàn phím ở 1440px. Sau mỗi lần đổi hiện điều bao bì ghi; màn
 * kết quả có đúng 3 sản phẩm đúng việc của ván và một nút "Thêm vào giỏ dùng thử" gửi một lệnh thêm giỏ (chạm đúp vẫn một lần), không gọi thêm API
 * game. `E2E_SHOT_DIR` đặt thì chụp bàn chơi và màn kết quả của từng khổ.
 */

const SHOT_DIR = process.env.E2E_SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-web', fullName: 'Khách game', phone: '0912345678', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

/** Bấm Tab tới khi `target` nhận tiêu điểm (tối đa `max` lần), rồi bấm `key`. */
async function tabAndPress(page: Page, target: Locator, key = 'Enter', max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) {
      await page.keyboard.press(key);
      return;
    }
  }
  throw new Error('Không Tab tới được phần tử cần bấm');
}

const gameWrites = (api: MockApi) => api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/game')).length;

const optionIndex = (i: number) => KITCHEN_SWAPS[i]!.options.findIndex((o) => o.product.slug === KITCHEN_PICKS[i]);

const productName = (slug: string) => KITCHEN_SWAPS.flatMap((sw) => sw.options).find((o) => o.product.slug === slug)!.product.name;

function setup(api: MockApi) {
  member(api);
  const { cartPosts } = mockMiniShop(api);
  const { submits } = mockMiniGames(api, { today: miniToday({ games: [...miniToday().games, KITCHEN_TODAY_ROW] }) });
  return { cartPosts, submits };
}

/** Ở mỗi góc: món và điều đang giấu hiện đúng, chạm sản phẩm theo `KITCHEN_PICKS`, thẻ "Về sản phẩm này" hiện điều bao bì ghi, rồi sang góc tiếp. */
async function playByTouch(page: Page, shotName?: string) {
  for (let i = 0; i < KITCHEN_SWAPS.length; i++) {
    const sw = KITCHEN_SWAPS[i]!;
    await expect(page.getByTestId('mini-kitchen-item')).toHaveText(sw.item);
    await expect(page.getByTestId('mini-kitchen-hidden')).toContainText(sw.hidden);
    await expect(page.getByTestId(`mini-kitchen-corner-${i}`)).toHaveAttribute('aria-current', 'step');
    if (i === 0) {
      await expectTargets44(page.getByTestId('mini-kitchen'));
      await expectNoHorizontalOverflow(page);
      if (shotName) await shot(page, `${shotName}-board`);
    }
    const opt = sw.options[optionIndex(i)]!;
    await page.getByTestId(`mini-kitchen-option-${optionIndex(i)}`).click();
    await expect(page.getByTestId('mini-kitchen-swapped')).toHaveText(kitchenCopy('swapped', { name: opt.product.name }));
    await expect(page.getByTestId('mini-kitchen-fact-text')).toHaveText(opt.fact);
    await expect(page.getByTestId('mini-kitchen-option-0')).toHaveCount(0);
    await expect(page.getByTestId(`mini-kitchen-corner-${i}`)).toHaveAttribute('data-state', 'done');
    if (i === 0 && shotName) await shot(page, `${shotName}-fact`);
    await page.getByTestId('mini-kitchen').getByRole('button', { name: kitchenCopy(i === KITCHEN_SWAPS.length - 1 ? 'finish' : 'next') }).click();
  }
}

/** Màn kết quả: đúng 3 sản phẩm đúng việc theo thứ tự góc, dẫn sang trang sản phẩm với nguồn game; "Vì sao" đủ 3 góc. */
async function expectDiscovered(page: Page) {
  await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
  const set = page.getByTestId('mini-kitchen-set');
  await expect(set).toBeVisible();
  await expect(set).toContainText(kitchenCopy('set'));
  const hrefs = await set.locator('a[href^="/san-pham/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href')))]);
  expect(hrefs).toEqual(KITCHEN_SET.map((slug) => `/san-pham/${slug}?entrySource=game:kitchen_swap`));
  for (const slug of KITCHEN_SET) await expect(set).toContainText(productName(slug));
  await expect(page.getByTestId('mini-review-item')).toHaveCount(3);
  await expect(page.getByTestId('mini-review-item').nth(1)).toContainText(gameCopy('result.given', { a: productName(KITCHEN_PICKS[1]!) }));
  await expect(page.getByTestId('mini-review-item').nth(1)).toContainText(gameCopy('result.expected', { a: productName(KITCHEN_SET[1]!) }));
  return set;
}

for (const vp of [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test.describe(`Web ${vp.width}px Căn Bếp Xanh`, () => {
    test.use({ viewport: vp });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ chạm chạy ở project Web Customer Mobile'));

    test('từ "Chơi hôm nay" vào ván, đổi 3 góc bằng chạm, thêm 3 sản phẩm vào giỏ dùng thử đúng một lần', async ({ page, api }) => {
      const { cartPosts, submits } = setup(api);
      await signedIn(page);
      await page.goto('/vuon-xanh');
      const row = page.getByTestId('mini-play-row-kitchen_swap');
      await expect(row).toHaveAttribute('href', '/vuon-xanh/choi/kitchen_swap', { timeout: 15_000 });
      await expect(row).toContainText(gameCopy('game.kitchen_swap.title'));
      await row.click();
      await expect(page).toHaveURL(/\/vuon-xanh\/choi\/kitchen_swap$/);
      await startRound(page);
      await playByTouch(page, `w${vp.width}`);
      const set = await expectDiscovered(page);
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-kitchen_swap', answers: KITCHEN_PICKS });
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
      await shot(page, `w${vp.width}-result`);
      const before = gameWrites(api);
      await set.getByRole('button', { name: kitchenCopy('add') }).dblclick();
      await expect(page.getByTestId('mini-kitchen-status')).toContainText(gameCopy('basket.added', { n: 3 }));
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toEqual(KITCHEN_SET.map((slug) => ({ variationId: `v-${slug}`, quantity: 1 })));
      expect(gameWrites(api)).toBe(before);
      await expect(set.getByRole('button', { name: gameCopy('basket.viewCart') })).toBeVisible();
    });
  });
}

test.describe('Web 1440px Căn Bếp Xanh', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer', 'khổ rộng chạy ở project Web Customer'));

  test('trọn ván bằng bàn phím: Tab tới sản phẩm, Enter đổi, tiêu điểm về món của góc kế; thêm giỏ bằng Enter', async ({ page, api }) => {
    const { cartPosts, submits } = setup(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/kitchen_swap');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.tubu-mg-aside')).toContainText(gameCopy('game.kitchen_swap.rules'));
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    for (let i = 0; i < KITCHEN_SWAPS.length; i++) {
      await expect(page.getByTestId('mini-kitchen-item')).toHaveText(KITCHEN_SWAPS[i]!.item);
      if (i > 0) await expect(page.getByTestId('mini-kitchen-scene')).toBeFocused();
      if (i === 0) await shot(page, 'w1440-board');
      await tabAndPress(page, page.getByTestId(`mini-kitchen-option-${optionIndex(i)}`));
      await expect(page.getByTestId('mini-kitchen-fact')).toBeVisible();
      if (i === 0) await shot(page, 'w1440-fact');
      await tabAndPress(page, page.getByTestId('mini-kitchen').getByRole('button', { name: kitchenCopy(i === KITCHEN_SWAPS.length - 1 ? 'finish' : 'next') }));
    }
    const set = await expectDiscovered(page);
    expect(submits[0]!.body).toMatchObject({ answers: KITCHEN_PICKS });
    await expectNoHorizontalOverflow(page);
    await shot(page, 'w1440-result');
    const add = set.getByRole('button', { name: kitchenCopy('add') });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mini-kitchen-status')).toContainText(gameCopy('basket.added', { n: 3 }));
    expect(cartPosts).toHaveLength(1);
  });
});
