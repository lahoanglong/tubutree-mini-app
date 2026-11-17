import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { expectNoHorizontalOverflow, expectTargets44, gameCopy, mockMiniGames } from './support/game-mini-mocks';

/**
 * Game mini đợt B ở Mini App: Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc chỉ phát ở web (gói Mini không đủ chỗ dưới trần 2350 KB). Ở 360 và 393px:
 * "Chơi hôm nay" chỉ có dòng Đố Xanh, Đúng Thùng và một dòng chữ "… chơi trên tubutree.com"; mở thẳng màn chơi của ba game này thì báo chơi trên
 * web, không xin ván.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

const WEB_ONLY = ['match', 'origin', 'basket'] as const;
const webOnlyLine = () => gameCopy('entry.webOnly', { names: WEB_ONLY.map((g) => gameCopy(`game.${g}.title`)).join(', ') });
const gameWrites = (api: MockApi) => api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/game')).length;

for (const viewport of [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
]) {
  test.describe(`Mini App ${viewport.width}px đợt B`, () => {
    test.use({ viewport });

    test('Chơi hôm nay: hai dòng chơi được, ba game web gom vào một dòng chữ không bấm được', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      await page.goto('/game');
      const card = page.getByTestId('mini-play-today');
      await expect(card).toBeVisible({ timeout: 15_000 });
      for (const g of ['daily_quiz', 'sort']) await expect(page.getByTestId(`mini-play-row-${g}`)).toBeVisible();
      for (const g of WEB_ONLY) await expect(page.getByTestId(`mini-play-row-${g}`)).toHaveCount(0);
      const line = page.getByTestId('mini-play-web-only');
      await expect(line).toHaveText(webOnlyLine());
      await expect(card.getByRole('button')).toHaveCount(2);
      await expect(page.getByTestId('arcade-hub')).toHaveCount(0);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
    });

    for (const game of WEB_ONLY) {
      test(`mở thẳng /game/play/${game}: báo chơi trên tubutree.com, không xin ván, nút quay về Vườn Xanh`, async ({ page, api }) => {
        member(api);
        mockMiniGames(api);
        await page.goto(`/game/play/${game}`);
        const notice = page.getByTestId('mini-web-only');
        await expect(notice).toBeVisible({ timeout: 15_000 });
        await expect(notice).toContainText(gameCopy('entry.webOnly', { names: gameCopy(`game.${game}.title`) }));
        await expect(page.getByRole('button', { name: gameCopy('intro.start') })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect(gameWrites(api)).toBe(0);
        await notice.getByRole('button', { name: gameCopy('result.done') }).click();
        await expect(page).toHaveURL(/\/game$/);
      });
    }
  });
}
