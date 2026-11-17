import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { observeCls, readClsTotal } from './support/cls-observer';
import {
  expectNoHorizontalOverflow,
  expectTargets44,
  finishSort,
  gameCopy,
  mockMiniGames,
  playQuiz,
  QUIZ_PRODUCT,
  sortProgress,
  startRound,
} from './support/game-mini-mocks';

/**
 * Game mini đợt A trên web: cùng hành vi với Mini App (thẻ "Chơi hôm nay" sau cờ, ván Đố Xanh và Đúng Thùng), thêm phần riêng của web:
 * chơi trọn bằng bàn phím, Nguồn là liên kết thật, màn chơi noindex, từ 1024px vùng chơi ≤ 720px kèm cột phải.
 */

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
async function tabAndPress(page: Page, target: Locator, key = 'Enter', max = 12) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) {
      await page.keyboard.press(key);
      return;
    }
  }
  throw new Error('Không Tab tới được phần tử cần bấm');
}

test.describe('Web 390px (điện thoại)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

  test('cờ tắt (404): Vườn Xanh giữ sảnh arcade và khối đố vui, không có thẻ Chơi hôm nay', async ({ page, api }) => {
    member(api);
    await signedIn(page);
    await page.goto('/vuon-xanh');
    await expect(page.getByTestId('arcade-hub')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#game-quiz')).toHaveCount(1);
    await expect(page.getByTestId('mini-play-today')).toHaveCount(0);
  });

  test('cờ bật: một thẻ Chơi hôm nay thay sảnh arcade và khối đố vui; Đố Xanh trọn ván bằng chạm, CLS ≤ 0,1', async ({ page, api }) => {
    member(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await observeCls(page);
    await page.goto('/vuon-xanh');
    const card = page.getByTestId('mini-play-today');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveCount(1);
    await expect(page.getByTestId('arcade-hub')).toHaveCount(0);
    await expect(page.locator('#game-quiz')).toHaveCount(0);
    await expect(page.getByTestId('mini-play-row-daily_quiz')).toHaveAttribute('href', '/vuon-xanh/choi/daily_quiz');
    await expectTargets44(card);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('mini-play-row-daily_quiz').click();
    await expect(page).toHaveURL(/\/vuon-xanh\/choi\/daily_quiz$/);
    await startRound(page);
    await expectTargets44(page.getByTestId('mini-quiz'));
    await expectNoHorizontalOverflow(page);
    await playQuiz(page);
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ roundId: 'r-daily_quiz', answers: [0, 0, 0] });
    await expect(page.getByTestId('mini-streak')).toHaveText(gameCopy('top.streak', { n: 4 }));
    await expectTargets44(page.getByTestId('mini-result'));
    await expectNoHorizontalOverflow(page);
    const { cls, sources } = await readClsTotal(page);
    expect(cls, sources.join('\n')).toBeLessThanOrEqual(0.1);
  });

  test('khách chưa đăng nhập: thẻ dưới cổng đăng nhập, chơi thử Đúng Thùng bằng mã ván, nút chính là Đăng nhập để nhận thưởng', async ({ page, api }) => {
    api.allowUnmocked('POST /events');
    const { submits } = mockMiniGames(api, { guest: 'NOT_LOGGED_IN' });
    await page.goto('/vuon-xanh');
    await expect(page.getByTestId('mini-play-status-sort')).toHaveText(gameCopy('row.trial'), { timeout: 15_000 });
    await expect(page.getByTestId('arcade-hub')).toHaveCount(0);
    await page.getByTestId('mini-play-row-sort').click();
    await expect(page.getByTestId('mini-no-reward')).toBeVisible();
    await startRound(page);
    await finishSort(page, 0);
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ token: 'tok.e2e', roundId: null });
    await expect(page.getByRole('button', { name: gameCopy('result.login') })).toBeVisible();
    await expect(page.getByRole('button', { name: gameCopy('result.done') })).toHaveCount(0);
  });
});

test.describe('Web 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer', 'khổ rộng chạy ở project Web Customer'));

  test('Đố Xanh trọn ván bằng bàn phím; vùng chơi ≤ 720px kèm cột Cách chơi; Nguồn mở tab mới; thẻ sản phẩm có entrySource', async ({ page, api }) => {
    member(api);
    mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/daily_quiz');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    const aside = page.locator('.tubu-mg-aside');
    await expect(aside).toBeVisible();
    expect((await page.locator('.tubu-mg-main').boundingBox())!.width).toBeLessThanOrEqual(720);
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId('mini-quiz')).toBeVisible();
      await tabAndPress(page, page.getByTestId('mini-quiz-option-1'));
      await expect(page.getByTestId('mini-quiz-option-1')).toHaveAttribute('aria-pressed', 'true');
      await tabAndPress(page, page.getByRole('button', { name: gameCopy(i === 2 ? 'quiz.finish' : 'quiz.next') }));
    }
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    const source = page.getByTestId('mini-review').getByRole('link', { name: gameCopy('result.sourceAria', { n: 1 }) });
    await expect(source).toHaveAttribute('href', 'https://www.moitruong.gov.vn/phan-loai-rac');
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', /noopener/);
    await expect(page.getByTestId('mini-result-product')).toHaveAttribute('href', `/san-pham/${QUIZ_PRODUCT.slug}?entrySource=game:daily_quiz`);
    await expectTargets44(page.getByTestId('mini-result'));
    await expectNoHorizontalOverflow(page);
  });

  test('Đúng Thùng trọn ván bằng bàn phím: chọn thẻ rồi thùng, hoặc bấm thẳng thùng; lời mời Đổi rác dẫn tới /doi-rac/tao', async ({ page, api }) => {
    member(api);
    api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: false, pickup: false } }));
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/sort');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    await expect(page.getByTestId('mini-sort')).toBeVisible();
    await tabAndPress(page, page.getByTestId('mini-sort-card'));
    await expect(page.getByTestId('mini-sort-card')).toHaveAttribute('aria-pressed', 'true');
    await tabAndPress(page, page.getByTestId('mini-sort-bin-food'));
    await expect(sortProgress(page)).toHaveText('1/10');
    for (let i = 1; i < 10; i++) {
      await page.waitForTimeout(350);
      await page.getByTestId('mini-sort-bin-other').focus();
      await page.keyboard.press('Enter');
      await expect(sortProgress(page).or(page.getByTestId('mini-result'))).toBeVisible();
    }
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect((submits[0]!.body.answers as unknown[])[0]).toBe('food');
    expect(submits[0]!.body.answers).toHaveLength(10);
    await expect(page.getByRole('link', { name: gameCopy('invite.sort') })).toHaveAttribute('href', '/doi-rac/tao');
  });

  test('game không có giao diện: 404', async ({ page, api }) => {
    member(api);
    await signedIn(page);
    const res = await page.goto('/vuon-xanh/choi/match');
    expect(res?.status()).toBe(404);
  });
});
