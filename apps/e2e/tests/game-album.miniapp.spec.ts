import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { ALBUM_CARDS, albumCopy, albumResponse, mockAlbum, REVIEW_ITEMS } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, gameCopy, mockMiniGames, mockMiniShop, playQuiz, startRound } from './support/game-mini-mocks';

/**
 * Sổ tay Xanh ở Mini App (API mock như máy chủ khi cờ `game.album_enabled` bật): dòng lối vào dưới "Chơi hôm nay", lọc chủ đề, mở thẻ và thêm
 * sản phẩm vào giỏ ngay trong Mini App, ván "Ôn 5 thẻ" không thưởng tới màn kết quả, dòng "+N thẻ mới" sau ván thường; cờ tắt, khách chưa đăng
 * nhập, sổ trống và lỗi mạng. Ảnh chụp ghi vào ALBUM_SHOTS_DIR khi có.
 */

const SHOTS = process.env.ALBUM_SHOTS_DIR;

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-album', fullName: 'Khách sổ', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

/** Chụp sau khi hiệu ứng chuyển trang của Mini App chạy xong. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const grid = (page: Page) => page.getByTestId('album-grid');

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test.describe(`Mini App ${viewport.width}px`, () => {
    test.use({ viewport });

    test('dòng lối vào dưới Chơi hôm nay mở sổ: tiến độ, một nút chính, chip cuộn ngang, lưới 2 cột, ô "?" mờ', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      mockAlbum(api);
      await page.goto('/game');
      const entry = page.getByTestId('album-entry');
      await expect(entry).toHaveText(albumCopy('entry', { n: 6, m: 86 }), { timeout: 15_000 });
      await expectTargets44(page.getByTestId('mini-play-today').locator('..'));
      await entry.scrollIntoViewIfNeeded();
      await shot(page, `mini-${viewport.width}-entry`);
      await entry.click();
      await expect(page).toHaveURL(/\/game\/album$/);
      await expect(grid(page)).toBeVisible();
      await expect(page.getByText(`${albumCopy('progress', { n: 6, m: 86, k: 1 })} · ${albumCopy('badge.ALBUM_TOPIC')}`)).toBeVisible();
      await expect(page.getByRole('button', { name: albumCopy('review', { n: 5 }) })).toHaveCount(1);
      await expect(grid(page).locator('button.album-tile')).toHaveCount(ALBUM_CARDS.length);
      const cols = await grid(page).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(2);
      await expect(grid(page).locator('span.album-tile').first()).toHaveText('?');
      await expect(grid(page).locator('span.album-tile').last()).toHaveText(`+${86 - 6 - 3}`);
      await expectNoHorizontalOverflow(page);
      await shot(page, `mini-${viewport.width}-album`);
    });

    test('lọc chủ đề, chạm thẻ mở sheet kiến thức và nguồn, "+ Thêm vào giỏ" thêm ngay trong Mini App', async ({ page, api }) => {
      member(api);
      mockAlbum(api);
      const { cartPosts } = mockMiniShop(api);
      await page.goto('/game/album');
      await expect(grid(page)).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: new RegExp(albumCopy('topic.quiz')) }).click();
      await expect(grid(page).locator('button.album-tile')).toHaveCount(2);
      await grid(page).getByText(ALBUM_CARDS[2]!.title).click();
      const sheet = page.getByTestId('album-card-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(ALBUM_CARDS[2]!.explanation);
      await expect(sheet).toContainText(gameCopy('result.sourceHost', { host: 'moitruong.gov.vn' }));
      await sheet.getByRole('button', { name: gameCopy('result.add') }).scrollIntoViewIfNeeded();
      await shot(page, `mini-${viewport.width}-sheet`);
      await sheet.getByRole('button', { name: gameCopy('result.add') }).click();
      await expect.poll(() => cartPosts.length).toBe(1);
      expect(page.url()).toMatch(/\/game\/album$/);
    });

    test('Ôn 5 thẻ: ván Đố Xanh không thưởng tới màn kết quả, gửi đúng mã ván ôn, quay về sổ', async ({ page, api }) => {
      member(api);
      const { calls } = mockAlbum(api);
      await page.goto('/game/album');
      await page.getByRole('button', { name: albumCopy('review', { n: 5 }) }).click();
      for (let i = 0; i < REVIEW_ITEMS.length; i++) {
        await expect(page.getByTestId('mini-quiz-prompt')).toHaveText(REVIEW_ITEMS[i]!.prompt, { timeout: 15_000 });
        await page.getByTestId('mini-quiz-option-0').click();
        await page.getByRole('button', { name: gameCopy(i === REVIEW_ITEMS.length - 1 ? 'quiz.finish' : 'quiz.next') }).click();
      }
      const result = page.getByTestId('mini-result');
      await expect(result).toBeVisible({ timeout: 15_000 });
      await expect(result).toContainText(gameCopy('result.noReward'));
      expect(calls.find((c) => c.path === '/game/album/review/submit')?.body).toMatchObject({ roundId: 'rv-1', answers: [0, 0, 0, 0, 0] });
      await shot(page, `mini-${viewport.width}-review-result`);
      await result.getByRole('button', { name: gameCopy('result.done') }).click();
      await expect(page).toHaveURL(/\/game$/);
    });

    test('dòng "+N thẻ mới vào Sổ tay Xanh" ở màn kết quả ván Đố Xanh thường, chạm mở sổ', async ({ page, api }) => {
      member(api);
      api.get('/me/daily-check-in', { checkedInToday: false, pointsDone: false, waterDone: false, streakDays: 3, currentCycleDay: 3, todayPoints: 0, todayWater: 10, rewards: [] });
      mockMiniGames(api);
      mockAlbum(api);
      await page.goto('/game/play/daily_quiz');
      await startRound(page);
      await playQuiz(page);
      const line = page.getByTestId('album-new-cards');
      await expect(line).toHaveText(albumCopy('newCards', { n: 2 }), { timeout: 15_000 });
      await shot(page, `mini-${viewport.width}-new-cards`);
      await line.click();
      await expect(page).toHaveURL(/\/game\/album$/);
    });

    test('cờ tắt (404): không có dòng lối vào ở Vườn Xanh, mở thẳng thì báo tạm nghỉ', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      mockAlbum(api, { off: true });
      await page.goto('/game');
      await expect(page.getByTestId('mini-play-today')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('album-entry')).toHaveCount(0);
      await page.goto('/game/album');
      await expect(page.getByText(albumCopy('off'))).toBeVisible({ timeout: 15_000 });
    });

    test('sổ trống: lời mời chơi một ván, không có nút Ôn', async ({ page, api }) => {
      member(api);
      mockAlbum(api, { album: albumResponse({ seen: 0, mastered: 0, cards: [], lastRound: null, topics: albumResponse().topics.map((t) => ({ ...t, seen: 0, mastered: 0 })) }) });
      await page.goto('/game/album');
      await expect(page.getByText(albumCopy('empty'))).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: albumCopy('review', { n: 5 }) })).toHaveCount(0);
      await shot(page, `mini-${viewport.width}-empty`);
    });

    test('lỗi mạng khi tải sổ: báo lỗi kèm Thử lại, thử lại thì hiện sổ', async ({ page, api }) => {
      member(api);
      mockAlbum(api, { failLoads: 2 });
      await page.goto('/game/album');
      const retry = page.getByRole('button', { name: 'Thử lại' });
      await expect(retry).toBeVisible({ timeout: 15_000 });
      await shot(page, `mini-${viewport.width}-error`);
      await retry.click();
      await expect(grid(page)).toBeVisible();
    });
  });
}

// Mini App luôn có phiên (Zalo hoặc tài khoản khách theo thiết bị); không có phiên chỉ khi máy chủ khoá tài khoản khách (store về 'idle').
test('không có phiên (tài khoản khách bị khoá): sổ mời đăng nhập; sổ và Vườn Xanh (không có dòng lối vào) không gọi API sổ', async ({ page, api }) => {
  const blocked = () => reply(401, { statusCode: 401, code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá' });
  for (const path of ['/auth/guest', '/auth/zalo-mini-app', '/auth/refresh']) api.post(path, blocked);
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
  mockMiniGames(api, { guest: 'NOT_LOGGED_IN' });
  const { calls } = mockAlbum(api);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/game/album');
  await expect(page.getByText(albumCopy('guest'))).toBeVisible({ timeout: 15_000 });
  await shot(page, 'mini-360-guest');
  await page.goto('/game');
  await expect(page.getByTestId('mini-play-row-sort')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('album-entry')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
