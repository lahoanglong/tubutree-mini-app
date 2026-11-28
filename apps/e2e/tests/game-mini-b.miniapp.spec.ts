import type { Page } from '@playwright/test';
import { kitchenCopy } from '../../../packages/app-core/src/game-mini/kitchen-copy';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import {
  BASKET_TASK,
  basketIndex,
  expectNoHorizontalOverflow,
  expectTargets44,
  gameCopy,
  KITCHEN_PICKS,
  KITCHEN_SET,
  KITCHEN_SWAPS,
  KITCHEN_TODAY_ROW,
  MATCH_PAIRS,
  miniToday,
  mockMiniGames,
  mockMiniShop,
  openMiniGameHub,
  ORIGIN_ITEMS,
  ORIGIN_PRODUCT,
  playMatch,
  playOrigin,
  startRound,
} from './support/game-mini-mocks';

/**
 * Game mini chơi ngay trong Mini App (không còn dòng "chơi trên tubutree.com"): Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Căn Bếp Xanh trọn ván bằng
 * chạm ở 360×640 và 390×844 với API mock. Màn kết quả thêm sản phẩm vừa học vào giỏ ngay trong app: một lệnh lô cho cả bộ (chạm đúp vẫn một), một
 * chạm cho từng sản phẩm, không gọi thêm API game nào.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

const ALL_GAMES = ['daily_quiz', 'sort', 'match', 'origin', 'basket', 'kitchen_swap'] as const;
const todayAll = () => miniToday({ games: [...miniToday().games, KITCHEN_TODAY_ROW] });
/** Lệnh ghi vào API game (nộp ván, nhận thưởng): thêm giỏ không được sinh thêm lệnh nào. */
const gameWrites = (api: MockApi) => api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/game')).length;
const kitchenOption = (i: number) => KITCHEN_SWAPS[i]!.options.findIndex((o) => o.product.slug === KITCHEN_PICKS[i]);

/** Mở game từ thẻ của Sảnh Game (màn chơi nằm trong Mini App) rồi bấm Bắt đầu. */
async function openFromToday(page: Page, game: string) {
  await openMiniGameHub(page);
  await page.getByTestId(`mini-play-row-${game}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/play/${game}$`));
  await startRound(page);
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test.describe(`Mini App ${viewport.width}px: game mini chơi ngay trong app`, () => {
    test.use({ viewport });

    test('Sảnh Game: đủ 6 game mini là thẻ chơi được, không còn lối chơi trên tubutree.com', async ({ page, api }) => {
      member(api);
      mockMiniGames(api, { today: todayAll() });
      await openMiniGameHub(page);
      const card = page.getByTestId('arcade-hub');
      await expect(card).toBeVisible({ timeout: 15_000 });
      for (const g of ALL_GAMES) await expect(page.getByTestId(`mini-play-row-${g}`)).toBeVisible();
      for (const g of ALL_GAMES) await expect(page.getByTestId(`mini-play-row-${g}`).getByRole('button')).toHaveCount(1);
      await expect(card).not.toContainText('tubutree.com');
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
    });

    test('Ghép Cặp trọn ván bằng chạm: lưới 3 cột, kết quả có sản phẩm theo cặp, "+ Thêm vào giỏ" một chạm', async ({ page, api }) => {
      member(api);
      const { cartPosts } = mockMiniShop(api);
      const { submits } = mockMiniGames(api);
      await openFromToday(page, 'match');
      const board = page.getByTestId('mini-match');
      await expect(board).toBeVisible();
      const xs = await page.locator('.tubu-mg-tile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
      expect(new Set(xs).size, 'lưới 3 cột').toBe(3);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      await playMatch(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-match', answers: MATCH_PAIRS });
      const products = page.getByTestId('mini-result-products');
      await expect(products).toContainText('Dầu gội bồ kết 300ml');
      const before = gameWrites(api);
      await products.getByRole('button', { name: gameCopy('result.add') }).first().click();
      await expect(page.getByText(gameCopy('basket.added', { n: 1 }))).toBeVisible();
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toEqual([{ variationId: 'v-dau-goi-bo-ket', quantity: 1 }]);
      expect(gameWrites(api)).toBe(before);
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
    });

    test('Đoán Xuất Xứ mở thẳng đường dẫn, trọn ván bằng chạm: lựa chọn cao ≥ 56px, sản phẩm lượt cuối thêm vào giỏ ngay trong app', async ({ page, api }) => {
      member(api);
      const { cartPosts } = mockMiniShop(api);
      const { submits } = mockMiniGames(api);
      await page.goto('/game/play/origin');
      await startRound(page);
      const board = page.getByTestId('mini-origin');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('mini-origin-prompt')).toHaveText(ORIGIN_ITEMS[0]!.prompt);
      for (const h of await board.locator('.tubu-mg-option').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(56);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      await playOrigin(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-origin', answers: [0, 1, 2, 3, 0] });
      const product = page.getByTestId('mini-result-product');
      await expect(product).toContainText(ORIGIN_PRODUCT.name);
      await product.getByRole('button', { name: gameCopy('result.add') }).click();
      await expect(page.getByText(gameCopy('basket.added', { n: 1 }))).toBeVisible();
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toEqual([{ variationId: `v-${ORIGIN_PRODUCT.slug}`, quantity: 1 }]);
      await expectNoHorizontalOverflow(page);
    });

    test('Giỏ Đúng Việc trọn ván bằng chạm; thêm cả bộ một lần (chạm đúp), món hết hàng được báo, Xem giỏ hàng mở giỏ của Mini App', async ({ page, api }) => {
      member(api);
      const { cartPosts } = mockMiniShop(api);
      const { submits } = mockMiniGames(api);
      await openFromToday(page, 'basket');
      const board = page.getByTestId('mini-basket');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('mini-basket-task')).toHaveText(BASKET_TASK.task);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      for (const slug of ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas']) await page.getByTestId(`mini-basket-item-${basketIndex(slug)}`).click();
      await board.getByRole('button', { name: gameCopy('basket.done') }).click();
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits).toHaveLength(1);
      const set = page.getByTestId('mini-basket-set');
      await expect(set).toBeVisible();
      const before = gameWrites(api);
      await set.getByRole('button', { name: gameCopy('basket.add') }).dblclick();
      await expect(page.getByTestId('mini-basket-status')).toContainText(gameCopy('basket.added', { n: 2 }));
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toHaveLength(2);
      expect(gameWrites(api)).toBe(before);
      const viewCart = set.getByRole('button', { name: gameCopy('basket.viewCart') });
      await expect(viewCart).toBeVisible();
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
      await viewCart.click();
      await expect(page).toHaveURL(/\/cart$/);
    });

    test('Căn Bếp Xanh trọn ván bằng chạm: 3 góc, thẻ "Về sản phẩm này"; thêm 3 sản phẩm vừa khám phá vào giỏ một lần', async ({ page, api }) => {
      member(api);
      const { cartPosts } = mockMiniShop(api);
      const { submits } = mockMiniGames(api, { today: todayAll() });
      await openFromToday(page, 'kitchen_swap');
      const board = page.getByTestId('mini-kitchen');
      for (let i = 0; i < KITCHEN_SWAPS.length; i++) {
        const sw = KITCHEN_SWAPS[i]!;
        await expect(page.getByTestId('mini-kitchen-item')).toHaveText(sw.item);
        await expect(page.getByTestId(`mini-kitchen-corner-${i}`)).toHaveAttribute('aria-current', 'step');
        if (i === 0) {
          await expectTargets44(board);
          await expectNoHorizontalOverflow(page);
        }
        const opt = sw.options[kitchenOption(i)]!;
        await page.getByTestId(`mini-kitchen-option-${kitchenOption(i)}`).click();
        await expect(page.getByTestId('mini-kitchen-swapped')).toHaveText(kitchenCopy('swapped', { name: opt.product.name }));
        await expect(page.getByTestId('mini-kitchen-fact-text')).toHaveText(opt.fact);
        await board.getByRole('button', { name: kitchenCopy(i === KITCHEN_SWAPS.length - 1 ? 'finish' : 'next') }).click();
      }
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-kitchen_swap', answers: KITCHEN_PICKS });
      const set = page.getByTestId('mini-kitchen-set');
      await expect(set).toContainText(kitchenCopy('set'));
      await expect(page.getByTestId('mini-review-item')).toHaveCount(3);
      const before = gameWrites(api);
      await set.getByRole('button', { name: kitchenCopy('add') }).dblclick();
      await expect(page.getByTestId('mini-kitchen-status')).toContainText(gameCopy('basket.added', { n: 3 }));
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toEqual(KITCHEN_SET.map((slug) => ({ variationId: `v-${slug}`, quantity: 1 })));
      expect(gameWrites(api)).toBe(before);
      await expect(set.getByRole('button', { name: gameCopy('basket.viewCart') })).toBeVisible();
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
    });
  });
}
