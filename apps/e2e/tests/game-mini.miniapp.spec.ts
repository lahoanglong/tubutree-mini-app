import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { observeCls, readClsTotal } from './support/cls-observer';
import {
  expectNoHorizontalOverflow,
  expectTargets44,
  finishSort,
  gameCopy,
  miniToday,
  mockMiniGames,
  playQuiz,
  QUIZ_PRODUCT,
  sortProgress,
  sortResult,
  startRound,
} from './support/game-mini-mocks';

/**
 * Game mini đợt A ở Mini App: thẻ "Chơi hôm nay" thay khối đố vui và sảnh arcade khi cờ bật, giữ nguyên bố cục khi cờ tắt (404 như PROD),
 * một ván Đố Xanh và một ván Đúng Thùng trọn vẹn với API mock, vùng chạm, tràn ngang và CLS ở 360 và 393px.
 */

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-mini', fullName: 'Khách game', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

/** Khách Mini App là tài khoản khách theo thiết bị (zaloId guest_, chưa có SĐT): máy chủ trả NOT_REAL_USER, ván không tính thưởng. */
function deviceGuest(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-guest', fullName: null, zaloId: 'guest_e2e', phone: null, pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
  api.allowUnmocked('POST /events');
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 393, height: 852 },
]) {
  test.describe(`Mini App ${viewport.width}px`, () => {
    test.use({ viewport });

    test('cờ tắt (404): Vườn Xanh giữ sảnh arcade và khối đố vui, không có thẻ Chơi hôm nay', async ({ page, api }) => {
      member(api);
      await page.goto('/game');
      await expect(page.getByTestId('arcade-hub')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#game-quiz')).toHaveCount(1);
      await expect(page.getByTestId('mini-play-today')).toHaveCount(0);
      expect(api.calls.some((c) => c.method === 'GET' && c.path === '/game/mini/today')).toBe(true);
    });

    test('cờ bật: một thẻ Chơi hôm nay thay sảnh arcade và khối đố vui, dòng gọn ghi lượt thưởng còn lại', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      await page.goto('/game');
      const card = page.getByTestId('mini-play-today');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toHaveCount(1);
      await expect(page.getByTestId('arcade-hub')).toHaveCount(0);
      await expect(page.locator('#game-quiz')).toHaveCount(0);
      await expect(page.getByTestId('mini-play-status-daily_quiz')).toHaveText(gameCopy('row.left', { n: 1 }));
      await expect(page.getByTestId('mini-play-status-sort')).toHaveText(gameCopy('row.left', { n: 2 }));
      const rowH = await page.getByTestId('mini-play-row-sort').evaluate((el) => el.getBoundingClientRect().height);
      expect(rowH, 'dòng gọn: ít nhất 6 dòng trên màn 640px').toBeLessThanOrEqual(640 / 6);
      await expectTargets44(card);
      await expectNoHorizontalOverflow(page);
    });

    test('Đố Xanh trọn ván: 3 câu, chuỗi ngày, kết quả có Vì sao, Nguồn và thẻ sản phẩm; điểm danh làm mới không tải lại', async ({ page, api }) => {
      member(api);
      api.get('/me/daily-check-in', { checkedInToday: false, pointsDone: false, waterDone: false, streakDays: 3, currentCycleDay: 3, todayPoints: 0, todayWater: 10, rewards: [] });
      const { submits } = mockMiniGames(api);
      await observeCls(page);
      await page.goto('/game');
      await page.getByTestId('mini-play-row-daily_quiz').click();
      await expect(page).toHaveURL(/\/game\/play\/daily_quiz$/);
      await expect(page.getByTestId('mini-streak')).toHaveText(gameCopy('top.streak', { n: 3 }));
      await expectTargets44(page.getByTestId('mini-intro'));
      await startRound(page);
      await expect(page.getByTestId('mini-quiz')).toBeVisible();
      const options = page.locator('.tubu-mg-option');
      await expect(options).toHaveCount(4);
      for (const h of await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(48);
      await expectTargets44(page.getByTestId('mini-quiz'));
      await expectNoHorizontalOverflow(page);
      await playQuiz(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body).toMatchObject({ roundId: 'r-daily_quiz', answers: [0, 0, 0] });
      expect(String(submits[0]!.body.deviceId)).toMatch(/^[0-9a-f]{32}$/);
      await expect(page.getByTestId('mini-result-score')).toHaveText(gameCopy('result.score', { c: 2, t: 3 }));
      await expect(page.getByText(gameCopy('result.water', { n: 6 }))).toBeVisible();
      await expect(page.getByText(gameCopy('result.checkIn', { n: 4 }))).toBeVisible();
      await expect(page.getByTestId('mini-streak')).toHaveText(gameCopy('top.streak', { n: 4 }));
      await expect(page.getByTestId('mini-review-item')).toHaveCount(3);
      await expect(page.getByTestId('mini-review').getByText(`${gameCopy('result.why')}:`).first()).toBeVisible();
      await expect(page.getByTestId('mini-review').getByText(gameCopy('result.sourceHost', { host: 'moitruong.gov.vn' })).first()).toBeVisible();
      await expect(page.getByTestId('mini-result-product')).toContainText(QUIZ_PRODUCT.name);
      await expect(page.getByRole('button', { name: gameCopy('result.done') })).toHaveCount(1);
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
      await expect.poll(() => api.calls.filter((c) => c.method === 'GET' && c.path === '/me/daily-check-in').length).toBeGreaterThanOrEqual(2);
      const { cls, sources } = await readClsTotal(page);
      expect(cls, sources.join('\n')).toBeLessThanOrEqual(0.1);
    });

    test('Đúng Thùng trọn ván: chạm thẻ rồi thùng, chạm thẳng thùng, kéo thả; thả ngoài thì thẻ về chỗ; chạm đúp tính một lần', async ({ page, api }) => {
      member(api);
      api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: false, pickup: false } }));
      const { submits } = mockMiniGames(api);
      await page.goto('/game/play/sort');
      await startRound(page);
      await expect(page.getByTestId('mini-sort')).toBeVisible();
      const bins = page.locator('.tubu-mg-bin');
      await expect(bins).toHaveCount(3);
      for (const b of await bins.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
        expect(b.width).toBeGreaterThanOrEqual(96);
        expect(b.height).toBeGreaterThanOrEqual(72);
      }
      await expectTargets44(page.getByTestId('mini-sort'));
      await expectNoHorizontalOverflow(page);
      const card = page.getByTestId('mini-sort-card');
      expect(await card.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
      expect(await page.locator('.tubu-mg-stage').evaluate((el) => getComputedStyle(el).touchAction)).not.toBe('none');

      await card.click();
      await expect(card).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('mini-sort-bin-recycle').click();
      await expect(sortProgress(page)).toHaveText('1/10');
      await page.waitForTimeout(350);

      await page.getByTestId('mini-sort-bin-food').click();
      await expect(sortProgress(page)).toHaveText('2/10');
      await page.waitForTimeout(350);

      const cb = (await card.boundingBox())!;
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.down();
      await page.mouse.move(cb.x + cb.width / 2, cb.y - 60, { steps: 6 });
      await page.mouse.up();
      await expect(sortProgress(page)).toHaveText('2/10');
      await expect(card).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => card.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');

      const bin = (await page.getByTestId('mini-sort-bin-other').boundingBox())!;
      const c2 = (await card.boundingBox())!;
      await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2);
      await page.mouse.down();
      await page.mouse.move(bin.x + bin.width / 2, bin.y + bin.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect(sortProgress(page)).toHaveText('3/10');
      await page.waitForTimeout(350);

      await page.getByTestId('mini-sort-bin-recycle').dblclick();
      await expect(sortProgress(page)).toHaveText('4/10');
      await page.waitForTimeout(350);

      await finishSort(page, 4);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      expect(submits).toHaveLength(1);
      expect(submits[0]!.body.answers).toEqual(['recycle', 'food', 'other', 'recycle', 'recycle', 'recycle', 'recycle', 'recycle', 'recycle', 'recycle']);
      await expect(page.getByTestId('mini-result-score')).toHaveText(gameCopy('result.score', { c: 7, t: 10 }));
      await expect(page.getByTestId('mini-review-item')).toHaveCount(10);
      await expect(page.getByRole('button', { name: gameCopy('invite.sort') })).toBeVisible();
      await expectTargets44(page.getByTestId('mini-result'));
      await expectNoHorizontalOverflow(page);
    });

    test('hết lượt thưởng: dòng ghi đã nhận đủ, màn mở đầu gắn nhãn không tính thưởng trước khi bấm Bắt đầu', async ({ page, api }) => {
      member(api);
      const today = miniToday();
      mockMiniGames(api, { today: { ...today, games: today.games.map((g) => (g.game === 'daily_quiz' ? { ...g, rewardedRoundsLeft: 0, playedToday: 1 } : g)) } });
      await page.goto('/game');
      await expect(page.getByTestId('mini-play-status-daily_quiz')).toHaveText(gameCopy('row.full'), { timeout: 15_000 });
      await page.getByTestId('mini-play-row-daily_quiz').click();
      await expect(page.getByTestId('mini-no-reward')).toHaveText(gameCopy('intro.noReward'), { timeout: 15_000 });
      await expect(page.getByText(gameCopy('reason.NO_REWARDED_ROUNDS_LEFT'))).toBeVisible();
    });

    test('chạm trần tài khoản: màn kết quả nói thật vì sao không cộng thưởng', async ({ page, api }) => {
      member(api);
      mockMiniGames(api, { sort: sortResult({ water: 0, points: 0, capped: ['account_water', 'account_points'] }) });
      await page.goto('/game/play/sort');
      await startRound(page);
      await finishSort(page, 0);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(gameCopy('cap.account'))).toBeVisible();
      await expect(page.getByText(gameCopy('result.water', { n: 10 }))).toHaveCount(0);
    });

    test('mất mạng lúc nộp: giữ đáp án và tự gửi lại', async ({ page, api }) => {
      member(api);
      const { submits } = mockMiniGames(api, { failFirstSubmit: true });
      await page.goto('/game/play/daily_quiz');
      await startRound(page);
      await playQuiz(page);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 20_000 });
      expect(submits).toHaveLength(2);
      expect(submits[1]!.body.answers).toEqual(submits[0]!.body.answers);
    });

    test('tài khoản khách theo thiết bị: chơi thử được, ván gắn nhãn không tính thưởng, nút chính là Đăng nhập để nhận thưởng', async ({ page, api }) => {
      deviceGuest(api);
      mockMiniGames(api, { guest: 'NOT_REAL_USER' });
      await page.goto('/game');
      await expect(page.getByTestId('mini-play-status-sort')).toHaveText(gameCopy('row.trial'), { timeout: 15_000 });
      await page.getByTestId('mini-play-row-sort').click();
      await expect(page.getByTestId('mini-no-reward')).toBeVisible();
      await startRound(page);
      await finishSort(page, 0);
      await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: gameCopy('result.login') })).toBeVisible();
      await expect(page.getByRole('button', { name: gameCopy('result.done') })).toHaveCount(0);
    });
  });
}
