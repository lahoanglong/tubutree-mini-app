import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import {
  ARCADE_TODAY_ROWS,
  arcadeCopy,
  expectNoHorizontalOverflow,
  expectTargets44,
  gameCopy,
  mergeKeyThenSwipe,
  miniToday,
  mockMiniGames,
  openMiniGameHub,
  playConveyorRound,
  playMergeToEnd,
  startRound,
} from './support/game-mini-mocks';

/**
 * Hai game thao tác ở Mini App (tubu-w48-01b): hai thẻ đầu Sảnh Game có hình và nhãn "Mới", một ván Ghép Mầm Xanh chơi bằng phím và vuốt tới
 * hết nước đi, một ván Băng Chuyền Xanh 30 giây phân loại bằng chạm thùng, vuốt và phím; bài nộp đúng dạng máy chủ chấm lại, màn kết quả có
 * "Chơi lại". Chạy ở 360 và 375px; có VISUAL_DIR thì chụp lưới thẻ, bàn chơi và kết quả để so với web.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-arcade', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

const withArcade = () => miniToday({ games: [...miniToday().games, ...ARCADE_TODAY_ROWS] });

async function shot(page: Page, name: string) {
  if (process.env.VISUAL_DIR) await page.screenshot({ path: join(process.env.VISUAL_DIR, `${name}.png`) });
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 375, height: 812 },
]) {
  test.describe(`Mini App ${viewport.width}px`, () => {
    test.use({ viewport });

    test('Sảnh Game: hai game thao tác đứng đầu, nhãn "Mới", hình vector, hai thẻ một hàng', async ({ page, api }) => {
      member(api);
      mockMiniGames(api, { today: withArcade() });
      await openMiniGameHub(page);
      const hub = page.getByTestId('arcade-hub');
      await expect(hub).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('mini-play-row-eco_merge')).toBeVisible({ timeout: 15_000 });
      const ids = await hub.locator('article[data-testid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      expect(ids.slice(0, 3)).toEqual(['mini-play-row-eco_merge', 'mini-play-row-green_conveyor', 'arcade-game-dew_catcher']);
      for (const id of ['eco_merge', 'green_conveyor']) {
        const row = page.getByTestId(`mini-play-row-${id}`);
        await expect(row).toContainText(gameCopy('card.new'));
        await expect(row.locator('svg.tubu-hub-art-svg')).toBeVisible();
      }
      await expect(page.getByTestId('mini-play-row-sort')).not.toContainText(gameCopy('card.new'));
      const merge = (await page.getByTestId('mini-play-row-eco_merge').boundingBox())!;
      const conveyor = (await page.getByTestId('mini-play-row-green_conveyor').boundingBox())!;
      const dew = (await page.getByTestId('arcade-game-dew_catcher').boundingBox())!;
      expect(conveyor.y, 'Ghép Mầm Xanh và Băng Chuyền Xanh chung hàng đầu').toBeCloseTo(merge.y, 0);
      expect(conveyor.x).toBeGreaterThan(merge.x + merge.width);
      expect(merge.width, 'thẻ rộng chưa tới nửa màn').toBeLessThan(viewport.width / 2);
      expect(dew.x, 'Hứng Sương mở hàng thứ hai').toBeCloseTo(merge.x, 0);
      expect(dew.y).toBeGreaterThan(merge.y + merge.height);
      await expectTargets44(hub);
      await expectNoHorizontalOverflow(page);
      await hub.scrollIntoViewIfNeeded();
      await shot(page, `mini-${viewport.width}-play-today`);
    });

    test('Ghép Mầm Xanh trọn ván: phím mũi tên và vuốt dời ô, âm thanh tắt được, hết nước đi thì nộp chuỗi hướng; kết quả có Chơi lại', async ({ page, api }) => {
      test.setTimeout(120_000);
      member(api);
      const { submits } = mockMiniGames(api, { today: withArcade() });
      await openMiniGameHub(page);
      await page.getByTestId('mini-play-row-eco_merge').click();
      await expect(page).toHaveURL(/\/game\/play\/eco_merge$/);
      await startRound(page);
      const board = page.getByTestId('mini-eco-merge');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('eco-merge-tile')).toHaveCount(2);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);

      const sound = page.getByTestId('arcade-sound');
      const before = (await sound.getAttribute('aria-label')) ?? '';
      await sound.click();
      await expect(sound).not.toHaveAttribute('aria-label', before);

      await mergeKeyThenSwipe(page);
      await shot(page, `mini-${viewport.width}-eco-merge`);

      await playMergeToEnd(page);
      const result = page.getByTestId('mini-result');
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-eco_merge' });
      const answers = submits[0]!.body.answers as string[];
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatch(/^[udlr]{10,2000}$/);
      await expect(page.getByTestId('mini-result-score')).toHaveText(arcadeCopy('merge.tier.5'));
      await expect(page.getByTestId('mini-result-arcade')).toContainText(arcadeCopy('result.mergeLine', { score: (1_284).toLocaleString('vi-VN'), moves: 180 }));
      await expect(page.getByText(gameCopy('result.water', { n: 9 }))).toBeVisible();
      await expect(page.getByRole('button', { name: gameCopy('result.again') })).toBeVisible();
      await expect(page.getByTestId('mini-review')).toHaveCount(0);
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      await shot(page, `mini-${viewport.width}-eco-merge-result`);
    });

    test('Băng Chuyền Xanh trọn ván: chạm thùng, vuốt và phím phân loại món đầu băng, sai thì rung, chuỗi tăng hệ số; nộp đủ 24 ký tự', async ({ page, api }) => {
      test.setTimeout(120_000);
      member(api);
      const { submits } = mockMiniGames(api, { today: withArcade() });
      await openMiniGameHub(page);
      await page.getByTestId('mini-play-row-green_conveyor').click();
      await expect(page).toHaveURL(/\/game\/play\/green_conveyor$/);
      await startRound(page);
      const panel = page.getByTestId('mini-green-conveyor');
      await expect(panel).toBeVisible();
      await expectTargets44(page.getByRole('list', { name: arcadeCopy('conveyor.binsAria') }));
      await expectNoHorizontalOverflow(page);

      const { sorted, shook, sawCombo } = await playConveyorRound(page, () => shot(page, `mini-${viewport.width}-green-conveyor`));
      const result = page.getByTestId('mini-result');
      expect(shook, 'đã thử một lần sai').toBe(true);
      expect(sawCombo, 'chuỗi đúng nâng hệ số lên x2').toBe(true);
      expect(sorted).toBeGreaterThanOrEqual(12);
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-green_conveyor' });
      const answers = submits[0]!.body.answers as string[];
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatch(/^[rof-]{24}$/);
      await expect(page.getByTestId('mini-result-arcade')).toContainText(arcadeCopy('result.conveyorLine', { score: 96, combo: 14, golden: 3 }));
      await expect(page.getByText(gameCopy('result.water', { n: 10 }))).toBeVisible();
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      await shot(page, `mini-${viewport.width}-green-conveyor-result`);
      await page.getByRole('button', { name: gameCopy('result.again') }).click();
      await expect(page.getByTestId('mini-intro').or(panel)).toBeVisible();
    });
  });
}
