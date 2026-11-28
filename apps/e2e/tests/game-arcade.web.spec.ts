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
  playConveyorRound,
  playMergeToEnd,
  startRound,
} from './support/game-mini-mocks';

/**
 * Hai game thao tác trên web khổ điện thoại (tubu-w48-01b), cùng hành vi với Mini App (`game-arcade.miniapp.spec.ts`): hai thẻ đầu Sảnh Game có hình và nhãn
 * "Mới" là liên kết tới `/vuon-xanh/choi/<game>`, một ván Ghép Mầm Xanh bằng phím và vuốt tới hết nước đi, một ván Băng Chuyền Xanh 30 giây.
 * Chạy ở 360 và 375px; có VISUAL_DIR thì chụp cùng các màn như Mini App để so cặp.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-web-arcade', fullName: 'Khách game', phone: '0912345678', pointsBalance: 0 }));
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

const withArcade = () => miniToday({ games: [...miniToday().games, ...ARCADE_TODAY_ROWS] });

async function shot(page: Page, name: string) {
  if (process.env.VISUAL_DIR) await page.screenshot({ path: join(process.env.VISUAL_DIR, `${name}.png`) });
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 375, height: 812 },
]) {
  test.describe(`Web ${viewport.width}px (điện thoại)`, () => {
    test.use({ viewport });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

    test('Sảnh Game: hai game thao tác đứng đầu, nhãn "Mới", hình vector, liên kết tới màn chơi', async ({ page, api }) => {
      member(api);
      mockMiniGames(api, { today: withArcade() });
      await signedIn(page);
      await page.goto('/vuon-xanh?tab=games');
      const hub = page.getByTestId('arcade-hub');
      await expect(hub).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('mini-play-row-eco_merge')).toBeVisible({ timeout: 15_000 });
      const ids = await hub.locator('article[data-testid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      expect(ids.slice(0, 3)).toEqual(['mini-play-row-eco_merge', 'mini-play-row-green_conveyor', 'arcade-card-dew_catcher']);
      for (const id of ['eco_merge', 'green_conveyor']) {
        const row = page.getByTestId(`mini-play-row-${id}`);
        await expect(row.getByRole('link')).toHaveAttribute('href', `/vuon-xanh/choi/${id}`);
        await expect(row).toContainText(gameCopy('card.new'));
        await expect(row.locator('svg.tubu-hub-art-svg')).toBeVisible();
      }
      const merge = (await page.getByTestId('mini-play-row-eco_merge').boundingBox())!;
      const conveyor = (await page.getByTestId('mini-play-row-green_conveyor').boundingBox())!;
      const dew = (await page.getByTestId('arcade-card-dew_catcher').boundingBox())!;
      expect(conveyor.y, 'Ghép Mầm Xanh và Băng Chuyền Xanh chung hàng đầu').toBeCloseTo(merge.y, 0);
      expect(merge.width, 'thẻ rộng chưa tới nửa màn').toBeLessThan(viewport.width / 2);
      expect(dew.x, 'Hứng Sương mở hàng thứ hai').toBeCloseTo(merge.x, 0);
      expect(dew.y).toBeGreaterThan(merge.y + merge.height);
      await expectTargets44(hub);
      await expectNoHorizontalOverflow(page);
      await hub.scrollIntoViewIfNeeded();
      await shot(page, `web-${viewport.width}-play-today`);
    });

    test('Ghép Mầm Xanh trọn ván bằng phím và vuốt, nộp chuỗi hướng; kết quả có Chơi lại', async ({ page, api }) => {
      test.setTimeout(120_000);
      member(api);
      const { submits } = mockMiniGames(api, { today: withArcade() });
      await signedIn(page);
      await page.goto('/vuon-xanh?tab=games');
      await page.getByTestId('mini-play-row-eco_merge').getByRole('link').click();
      await expect(page).toHaveURL(/\/vuon-xanh\/choi\/eco_merge$/);
      await startRound(page);
      const board = page.getByTestId('mini-eco-merge');
      await expect(board).toBeVisible();
      await expect(page.getByTestId('eco-merge-tile')).toHaveCount(2);
      await expectTargets44(board);
      await expectNoHorizontalOverflow(page);
      await mergeKeyThenSwipe(page);
      await shot(page, `web-${viewport.width}-eco-merge`);
      await playMergeToEnd(page);
      const result = page.getByTestId('mini-result');
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-eco_merge' });
      expect((submits[0]!.body.answers as string[])[0]).toMatch(/^[udlr]{10,2000}$/);
      await expect(page.getByTestId('mini-result-score')).toHaveText(arcadeCopy('merge.tier.5'));
      await expect(page.getByTestId('mini-result-arcade')).toContainText(arcadeCopy('result.mergeLine', { score: (1_284).toLocaleString('vi-VN'), moves: 180 }));
      await expect(page.getByRole('button', { name: gameCopy('result.again') })).toBeVisible();
      await expect(page.getByTestId('mini-review')).toHaveCount(0);
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      await shot(page, `web-${viewport.width}-eco-merge-result`);
    });

    test('Băng Chuyền Xanh trọn ván: chạm thùng, vuốt, phím; sai thì rung, chuỗi tăng hệ số; nộp đủ 24 ký tự', async ({ page, api }) => {
      test.setTimeout(120_000);
      member(api);
      const { submits } = mockMiniGames(api, { today: withArcade() });
      await signedIn(page);
      await page.goto('/vuon-xanh?tab=games');
      await page.getByTestId('mini-play-row-green_conveyor').getByRole('link').click();
      await expect(page).toHaveURL(/\/vuon-xanh\/choi\/green_conveyor$/);
      await startRound(page);
      await expect(page.getByTestId('mini-green-conveyor')).toBeVisible();
      await expectTargets44(page.getByRole('list', { name: arcadeCopy('conveyor.binsAria') }));
      await expectNoHorizontalOverflow(page);
      const { sorted, shook, sawCombo } = await playConveyorRound(page, () => shot(page, `web-${viewport.width}-green-conveyor`));
      expect(shook, 'đã thử một lần sai').toBe(true);
      expect(sawCombo, 'chuỗi đúng nâng hệ số lên x2').toBe(true);
      expect(sorted).toBeGreaterThanOrEqual(12);
      expect(submits).toHaveLength(1);
      expect((submits[0]!.body.answers as string[])[0]).toMatch(/^[rof-]{24}$/);
      const result = page.getByTestId('mini-result');
      await expect(page.getByTestId('mini-result-arcade')).toContainText(arcadeCopy('result.conveyorLine', { score: 96, combo: 14, golden: 3 }));
      await expect(page.getByText(gameCopy('result.water', { n: 10 }))).toBeVisible();
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      await shot(page, `web-${viewport.width}-green-conveyor-result`);
    });
  });
}
