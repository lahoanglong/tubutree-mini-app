import type { Page } from '@playwright/test';
import { matcherCopy } from '../../../packages/app-core/src/game-mini/matcher-copy';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { expectNoHorizontalOverflow, expectTargets44, gameCopy, mockMiniGames, openMiniGameHub } from './support/game-mini-mocks';
import { MATCHER_RESULT, mockMatcherOn } from './support/matcher-mocks';

/**
 * Chọn Chuẩn Xanh chơi ngay trong Mini App (`/game/matcher`, cặp với `/vuon-xanh/chon-chuan-xanh` của web): cờ bật thì "Chơi hôm nay" có dòng mở màn
 * chơi trong app; 5 bước bằng chạm ở 360×640 và 390×844, bộ 4 món, MỘT nút "Thêm cả bộ vào giỏ" gửi một lệnh lô (chạm đúp vẫn một), rồi nút thành
 * "Xem giỏ" mở giỏ của Mini App. Cờ tắt: không có dòng, mở thẳng thì báo tạm nghỉ. Ảnh chụp ghi vào MATCHER_SHOTS_DIR khi có.
 */

const SHOTS = process.env.MATCHER_SHOTS_DIR;

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

/** Đi trọn 5 bước bằng chạm (3 câu nhu cầu, 2 câu đố), kiểm vùng chạm và tràn ngang ở từng loại bước. */
async function play(page: Page, values: [string, string, string]) {
  const root = page.getByTestId('matcher');
  await expect(page.getByTestId('matcher-intro')).toBeVisible({ timeout: 15_000 });
  await expectTargets44(root);
  await root.getByRole('button', { name: matcherCopy('intro.start') }).click();
  await expect(page.getByTestId('matcher-question-1')).toBeVisible();
  await expectTargets44(root);
  await expectNoHorizontalOverflow(page);
  await root.locator(`button[data-value="${values[0]}"]`).click();
  await expect(page.getByTestId('matcher-trivia')).toBeVisible();
  await page.getByTestId('matcher-trivia').locator('.tubu-mg-option').first().click();
  await expect(page.getByTestId('matcher-trivia-feedback')).toBeVisible();
  await expectTargets44(root);
  await expectNoHorizontalOverflow(page);
  await root.getByRole('button', { name: matcherCopy('next') }).click();
  await root.locator(`button[data-value="${values[1]}"]`).click();
  await page.getByTestId('matcher-trivia').locator('.tubu-mg-option').nth(1).click();
  await root.getByRole('button', { name: matcherCopy('next') }).click();
  await expect(page.getByTestId('matcher-question-3')).toBeVisible();
  await root.locator(`button[data-value="${values[2]}"]`).click();
  await expect(page.getByTestId('matcher-result')).toBeVisible({ timeout: 15_000 });
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test.describe(`Mini App ${viewport.width}px Chọn Chuẩn Xanh`, () => {
    test.use({ viewport });

    test('cờ bật: thẻ ở Sảnh Game mở màn chơi trong app, 5 bước, thêm cả bộ một lệnh 4 món, Xem giỏ mở giỏ Mini App', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      mockMatcherOn(api);
      const cartPosts: unknown[] = [];
      api.post('/cart/items/batch', (ctx: { call: { body: unknown } }) => {
        cartPosts.push(ctx.call.body);
        return { items: [], subtotal: 0, discount: 0, itemCount: 4 };
      });
      api.allowUnmocked('GET /cart', 'GET /cart/count');
      await openMiniGameHub(page);
      const row = page.getByTestId('mini-play-row-matcher');
      await expect(row).toContainText(gameCopy('game.matcher.title'), { timeout: 15_000 });
      await expect(page.getByTestId('arcade-hub')).not.toContainText('tubutree.com');
      await expectTargets44(page.getByTestId('arcade-hub'));
      await row.click();
      await expect(page).toHaveURL(/\/game\/matcher\?from=play_today$/);
      await play(page, ['kitchen', 'machine', 'large']);
      expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/game/matcher/result')).toHaveLength(1);
      const result = page.getByTestId('matcher-result');
      await expect(page.getByTestId('matcher-items').locator('li')).toHaveCount(4);
      await expect(page.getByTestId('matcher-total')).toContainText(matcherCopy('result.total', { n: 4 }));
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${viewport.width}-matcher-result.png`, fullPage: true });
      await result.getByRole('button', { name: matcherCopy('result.addAll') }).dblclick();
      await expect(page.getByTestId('matcher-add-status')).toHaveText(matcherCopy('result.added', { n: 4 }));
      expect(cartPosts).toHaveLength(1);
      expect(cartPosts[0]).toMatchObject({ items: MATCHER_RESULT.items.map((i) => ({ variationId: i.variationId, quantity: 1 })) });
      await result.getByRole('button', { name: matcherCopy('result.viewCart') }).click();
      await expect(page).toHaveURL(/\/cart$/);
    });

    test('lùi một bước giữ đáp án đã chọn', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      mockMatcherOn(api);
      await page.goto('/game/matcher');
      const root = page.getByTestId('matcher');
      await root.getByRole('button', { name: matcherCopy('intro.start') }).click({ timeout: 15_000 });
      await root.locator('button[data-value="kitchen"]').click();
      await expect(page.getByTestId('matcher-trivia')).toBeVisible();
      await page.getByTestId('matcher-back').click();
      await expect(root.locator('button[data-value="kitchen"]')).toHaveAttribute('aria-pressed', 'true');
      await expectNoHorizontalOverflow(page);
    });

    test('cờ tắt: Sảnh Game không có thẻ; mở thẳng /game/matcher báo tạm nghỉ, nút về Vườn Xanh', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      api.get('/game/matcher', reply(404, { statusCode: 404, code: 'GAME_DISABLED', message: 'Trò chơi đang tạm tắt' }));
      api.get('/game/matcher/status', { enabled: false });
      await openMiniGameHub(page);
      await expect(page.getByTestId('mini-play-row-sort')).toBeVisible({ timeout: 15_000 });
      // Đợi câu trả lời của cờ về (không chỉ lúc lệnh vừa gửi) rồi mới khẳng định không có dòng.
      await expect.poll(() => api.calls.some((c) => c.method === 'GET' && c.path === '/game/matcher/status')).toBe(true);
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('mini-play-row-matcher')).toHaveCount(0);
      await page.goto('/game/matcher');
      const off = page.getByTestId('matcher-off');
      await expect(off).toContainText(matcherCopy('error.disabled'), { timeout: 15_000 });
      await off.getByRole('button', { name: matcherCopy('error.home') }).click();
      await expect(page).toHaveURL(/\/game$/);
    });
  });
}
