import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import {
  BASKET_SOLD_OUT,
  BASKET_TASK,
  basketIndex,
  expectNoHorizontalOverflow,
  expectTargets44,
  gameCopy,
  MATCH_PAIRS,
  mockMiniGames,
  mockMiniShop,
  ORIGIN_ITEMS,
  ORIGIN_PRODUCT,
  playMatch,
  playOrigin,
  startRound,
} from './support/game-mini-mocks';

/**
 * Game mini đợt B ở Mini App: Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc trọn ván với API mock ở 360 và 393px; vùng chạm ≥ 44px, không tràn ngang;
 * Giỏ Đúng Việc thêm bộ đúng vào giỏ đúng một lần (món hết hàng nêu tên) và không gọi API game nào sau khi nộp.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

/** Lệnh ghi vào API game (nộp ván, nhận thưởng): sau khi thêm giỏ không được có thêm lệnh nào. Lệnh đọc làm mới sau kết quả không tính. */
const gameWrites = (api: MockApi) => api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/game')).length;

for (const viewport of [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
]) {
  test.describe(`Mini App ${viewport.width}px đợt B`, () => {
    test.use({ viewport });

    test('Chơi hôm nay: đủ 5 game, mỗi dòng mở đúng màn chơi', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      await page.goto('/game');
      const card = page.getByTestId('mini-play-today');
      await expect(card).toBeVisible({ timeout: 15_000 });
      for (const g of ['daily_quiz', 'sort', 'match', 'origin', 'basket']) await expect(page.getByTestId(`mini-play-row-${g}`)).toBeVisible();
      await expect(page.getByTestId('arcade-hub')).toHaveCount(0);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      await page.getByTestId('mini-play-row-match').click();
      await expect(page).toHaveURL(/\/game\/play\/match$/);
    });

    test('Ghép Cặp trọn ván: lưới 3 cột thẻ ≥ 96px, hai thẻ cùng loại báo không khớp, đủ 6 cặp thì nộp; kết quả có Vì sao theo cặp và sản phẩm', async ({ page, api }) => {
      member(api);
      mockMiniShop(api);
      const { submits } = mockMiniGames(api);
      await page.goto('/game/play/match');
      await startRound(page);
      const board = page.getByTestId('mini-match');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('mini-status')).toContainText(gameCopy('progress.pairs', { n: 0, m: 6 }));
      const tiles = page.locator('.tubu-mg-tile');
      await expect(tiles).toHaveCount(12);
      const boxes = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      for (const b of boxes) {
        expect(b.width).toBeGreaterThanOrEqual(96);
        expect(b.height).toBeGreaterThanOrEqual(72);
      }
      expect(new Set(boxes.map((b) => Math.round(b.x))).size, 'lưới 3 cột').toBe(3);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);

      await page.getByTestId('mini-match-card-0').click();
      await page.getByTestId('mini-match-card-2').click();
      await expect(page.getByTestId('mini-match-card-0')).toHaveAttribute('data-state', 'mismatch');
      await expect(page.getByTestId('mini-match-hint')).toHaveText(gameCopy('match.mismatch'));
      await expect(page.getByTestId('mini-match-card-0')).toHaveAttribute('data-state', 'idle');

      await playMatch(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-match', answers: MATCH_PAIRS });
      await expect(page.getByTestId('mini-result-score')).toHaveText(gameCopy('result.score', { c: 5, t: 6 }));
      await expect(page.getByTestId('mini-review-item')).toHaveCount(6);
      await expect(page.getByTestId('mini-review-item').first()).toContainText('Bồ kết: Gội đầu, làm sạch tóc');
      await expect(page.getByTestId('mini-result-products')).toBeVisible();
      await expect(page.getByTestId('mini-result-products')).toContainText('Dầu gội bồ kết 300ml');
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
    });

    test('Đoán Xuất Xứ trọn ván: 5 lượt, lựa chọn 2×2 cao ≥ 56px, lượt cuối là sản phẩm đang bán; kết quả dẫn sang sản phẩm', async ({ page, api }) => {
      member(api);
      const { submits } = mockMiniGames(api);
      await page.goto('/game/play/origin');
      await startRound(page);
      const board = page.getByTestId('mini-origin');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('mini-status')).toContainText(gameCopy('progress.turn', { n: 1, m: 5 }));
      const options = page.locator('.tubu-mg-option');
      await expect(options).toHaveCount(4);
      const boxes = await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(56);
      expect(new Set(boxes.map((b) => Math.round(b.x))).size, 'lưới 2 cột').toBe(2);
      await expect(page.getByRole('button', { name: gameCopy('origin.next') })).toBeDisabled();
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      await playOrigin(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-origin', answers: [0, 1, 2, 3, 0] });
      await expect(page.getByTestId('mini-result-product')).toContainText(ORIGIN_PRODUCT.name);
      await expect(page.getByTestId('mini-review-item')).toHaveCount(ORIGIN_ITEMS.length);
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
    });

    test('Giỏ Đúng Việc: chọn đúng 3, món thứ tư không vào; thêm bộ đúng vào giỏ một lần, món hết hàng nêu tên, không gọi API game', async ({ page, api }) => {
      member(api);
      const { cartPosts } = mockMiniShop(api);
      const { submits } = mockMiniGames(api);
      await page.goto('/game/play/basket');
      await startRound(page);
      const board = page.getByTestId('mini-basket');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('mini-basket-task')).toHaveText(BASKET_TASK.task);
      await expect(page.locator('.tubu-mg-tile')).toHaveCount(6);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      const done = page.getByRole('button', { name: gameCopy('basket.done') });
      await expect(done).toBeDisabled();
      for (const slug of ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas']) await page.getByTestId(`mini-basket-item-${basketIndex(slug)}`).click();
      await expect(page.getByTestId('mini-status')).toContainText(gameCopy('progress.picked', { n: 3, m: 3 }));
      const fourth = page.getByTestId(`mini-basket-item-${basketIndex('khan-lau-soi-tre')}`);
      // `aria-disabled` báo trình đọc màn hình là đã đủ món, nhưng nút vẫn nhận chạm (để hiện lời nhắc): Playwright coi là không bấm được nên ép.
      await fourth.click({ force: true });
      await expect(fourth).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('mini-basket-hint')).toHaveText(gameCopy('basket.full'));
      await done.click();
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-basket', answers: ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas'] });
      await expect(page.getByTestId('mini-review-item')).toHaveCount(2);

      const set = page.getByTestId('mini-basket-set');
      await expect(set).toBeVisible();
      await expectTargets44(set);
      const before = gameWrites(api);
      await set.getByRole('button', { name: gameCopy('basket.add') }).dblclick();
      await expect(page.getByTestId('mini-basket-status')).toContainText(gameCopy('basket.added', { n: 2 }));
      await expect(page.getByTestId('mini-basket-status')).toContainText(gameCopy('basket.skipped', { names: 'Xơ mướp rửa chén (2 miếng)' }));
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]!.items).toEqual([
        { variationId: 'v-nuoc-rua-chen-bo-ket', quantity: 1 },
        { variationId: 'v-khan-lau-soi-tre', quantity: 1 },
      ]);
      expect(cartPosts[0]!.items.some((i) => i.variationId === `v-${BASKET_SOLD_OUT}`)).toBe(false);
      await expect(set.getByRole('button', { name: gameCopy('basket.viewCart') })).toBeVisible();
      expect(gameWrites(api), 'không gọi API game (thưởng) sau khi thêm giỏ').toBe(before);
      await expectNoHorizontalOverflow(page);
    });
  });
}
