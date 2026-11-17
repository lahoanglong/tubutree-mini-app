import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { expectNoHorizontalOverflow, expectTargets44, gameCopy, mockMiniGames } from './support/game-mini-mocks';

/**
 * Chọn Chuẩn Xanh chỉ có trên web (route-map.json gap `matcher-web-only`): ở Mini App 360 và 393px, cờ bật thì tên nó nối vào dòng chữ
 * "… chơi trên tubutree.com" của Chơi hôm nay, không thêm dòng chơi, không thêm nút. Cờ tắt (mặc định PROD) thì dòng giữ như cũ.
 */

const SHOTS = process.env.MATCHER_SHOTS_DIR;
const WEB_ONLY = ['match', 'origin', 'basket'] as const;
const names = (extra: string[] = []) => [...WEB_ONLY.map((g) => gameCopy(`game.${g}.title`)), ...extra].join(', ');

for (const viewport of [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
]) {
  test.describe(`Mini App ${viewport.width}px Chọn Chuẩn Xanh`, () => {
    test.use({ viewport });

    test('cờ bật: tên nối vào dòng chơi trên tubutree.com, thẻ vẫn 2 nút', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
      mockNewbieGame(api, 'new');
      api.allowUnmocked('POST /events');
      mockMiniGames(api);
      api.get('/game/matcher/status', { enabled: true });
      await page.goto('/game');
      const card = page.getByTestId('mini-play-today');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('mini-play-web-only')).toHaveText(gameCopy('entry.webOnly', { names: names([gameCopy('game.matcher.title')]) }));
      await expect(page.getByTestId('mini-play-row-matcher')).toHaveCount(0);
      await expect(card.getByRole('button')).toHaveCount(2);
      await expect(card.getByRole('link')).toHaveCount(0);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
      if (SHOTS) await card.screenshot({ path: `${SHOTS}/mini-${viewport.width}-play-today.png` });
    });

    test('cờ tắt: dòng giữ như trước', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
      mockNewbieGame(api, 'new');
      api.allowUnmocked('POST /events');
      mockMiniGames(api);
      await page.goto('/game');
      await expect(page.getByTestId('mini-play-web-only')).toHaveText(gameCopy('entry.webOnly', { names: names() }), { timeout: 15_000 });
    });
  });
}
