import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { ALBUM_CARDS, albumCopy, mockAlbum, REVIEW_ITEMS } from './support/game-album-mocks';
import { expectNoHorizontalOverflow, expectTargets44, gameCopy, mockMiniGames, mockMiniShop, playQuiz, startRound } from './support/game-mini-mocks';

/**
 * Sổ tay Xanh trên web, cùng hành vi với Mini App (`game-album.miniapp.spec.ts`): dòng lối vào dưới "Chơi hôm nay", lưới 2 cột ở điện thoại và
 * máy tính bảng, 4 cột ở 1440; lọc chủ đề, sheet thẻ (tải lười) có Nguồn là liên kết thật và "+ Thêm vào giỏ"; ván "Ôn 5 thẻ" không thưởng; dòng
 * "+N thẻ mới" sau ván thường; cờ tắt, khách chưa đăng nhập, lỗi mạng; trang noindex. Ảnh chụp ghi vào ALBUM_SHOTS_DIR khi có.
 */

const SHOTS = process.env.ALBUM_SHOTS_DIR;

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-web', fullName: 'Khách sổ', phone: '0912345678', pointsBalance: 0 }));
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

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const grid = (page: Page) => page.getByTestId('album-grid');

for (const { width, height, project } of [
  { width: 360, height: 640, project: 'Web Customer Mobile' },
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 768, height: 1024, project: 'Web Customer' },
  { width: 1440, height: 900, project: 'Web Customer' },
]) {
  test.describe(`Web ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `khổ ${width}px chạy ở project ${project}`));

    test('dòng lối vào dưới lưới Sảnh Game mở sổ: một nút chính, chip cuộn ngang, lưới đúng số cột, trang noindex', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      mockAlbum(api);
      await signedIn(page);
      await page.goto('/vuon-xanh?tab=games');
      const entry = page.getByTestId('album-entry');
      await expect(entry).toHaveText(albumCopy('entry', { n: 6, m: 86 }), { timeout: 15_000 });
      await expect(entry).toHaveAttribute('href', '/vuon-xanh/so-tay');
      await expectTargets44(entry);
      await entry.scrollIntoViewIfNeeded();
      await shot(page, `web-${width}-entry`);
      await entry.click();
      await expect(page).toHaveURL(/\/vuon-xanh\/so-tay$/);
      await expect(grid(page)).toBeVisible({ timeout: 15_000 });
      expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
      await expect(page.getByRole('button', { name: albumCopy('review', { n: 5 }) })).toHaveCount(1);
      await expect(grid(page).locator('button.album-tile')).toHaveCount(ALBUM_CARDS.length);
      const cols = await grid(page).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(width >= 1024 ? 4 : 2);
      await expect(grid(page).locator('span.album-tile').first()).toHaveText('?');
      // Thẻ mới gặp hôm nay lật vào (rotateY): giữa lúc lật bề ngang đo được gần 0.
      await grid(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined));
      await expectTargets44(grid(page));
      await expectNoHorizontalOverflow(page);
      await shot(page, `web-${width}-album`);
    });

    test('lọc chủ đề, sheet thẻ có Nguồn mở tab mới, "+ Thêm vào giỏ" thêm một lần', async ({ page, api }) => {
      member(api);
      mockAlbum(api);
      const { cartPosts } = mockMiniShop(api);
      await signedIn(page);
      await page.goto('/vuon-xanh/so-tay');
      await expect(grid(page)).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: new RegExp(albumCopy('topic.quiz')) }).click();
      await expect(grid(page).locator('button.album-tile')).toHaveCount(2);
      await grid(page).getByText(ALBUM_CARDS[2]!.title).click();
      const sheet = page.getByTestId('album-card-sheet');
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(sheet).toContainText(ALBUM_CARDS[2]!.explanation);
      const source = sheet.getByRole('link', { name: gameCopy('result.sourceHost', { host: 'moitruong.gov.vn' }) });
      await expect(source).toHaveAttribute('target', '_blank');
      await expect(source).toHaveAttribute('rel', /noopener/);
      await shot(page, `web-${width}-sheet`);
      await sheet.getByRole('button', { name: gameCopy('result.add') }).dblclick();
      await expect.poll(() => cartPosts.length).toBe(1);
      await expect(page).toHaveURL(/\/vuon-xanh\/so-tay$/);
    });
  });
}

test.describe('Web 390px: ván ôn, dòng +N, cờ tắt, khách, lỗi mạng', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

  test('Ôn 5 thẻ: ván không thưởng tới màn kết quả, gửi đúng mã ván ôn, nút chính về Vườn Xanh', async ({ page, api }) => {
    member(api);
    mockMiniGames(api);
    const { calls } = mockAlbum(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/so-tay');
    await page.getByRole('button', { name: albumCopy('review', { n: 5 }) }).click({ timeout: 15_000 });
    for (let i = 0; i < REVIEW_ITEMS.length; i++) {
      await expect(page.getByTestId('mini-quiz-prompt')).toHaveText(REVIEW_ITEMS[i]!.prompt, { timeout: 15_000 });
      await page.getByTestId('mini-quiz-option-0').click();
      await page.getByRole('button', { name: gameCopy(i === REVIEW_ITEMS.length - 1 ? 'quiz.finish' : 'quiz.next') }).click();
    }
    const result = page.getByTestId('mini-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText(gameCopy('result.noReward'));
    expect(calls.find((c) => c.path === '/game/album/review/submit')?.body).toMatchObject({ roundId: 'rv-1', answers: [0, 0, 0, 0, 0] });
    await shot(page, 'web-390-review-result');
    await result.getByRole('button', { name: gameCopy('result.done') }).click();
    await expect(page).toHaveURL(/\/vuon-xanh$/);
  });

  test('dòng "+N thẻ mới vào Sổ tay Xanh" ở màn kết quả ván Đố Xanh thường, là liên kết tới sổ', async ({ page, api }) => {
    member(api);
    mockMiniGames(api);
    mockAlbum(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/daily_quiz');
    await startRound(page);
    await playQuiz(page);
    const line = page.getByTestId('album-new-cards');
    await expect(line).toHaveText(albumCopy('newCards', { n: 2 }), { timeout: 15_000 });
    await expect(line).toHaveAttribute('href', '/vuon-xanh/so-tay');
    await shot(page, 'web-390-new-cards');
  });

  test('cờ tắt (404): không có dòng lối vào ở Vườn Xanh, mở thẳng thì báo tạm nghỉ', async ({ page, api }) => {
    member(api);
    mockMiniGames(api);
    mockAlbum(api, { off: true });
    await signedIn(page);
    await page.goto('/vuon-xanh?tab=games');
    await expect(page.getByTestId('mini-play-row-sort')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('album-entry')).toHaveCount(0);
    await page.goto('/vuon-xanh/so-tay');
    await expect(page.getByText(albumCopy('off'))).toBeVisible({ timeout: 15_000 });
  });

  test('khách chưa đăng nhập: sổ mời đăng nhập; sổ và Vườn Xanh (không có dòng lối vào) không gọi API sổ', async ({ page, api }) => {
    api.allowUnmocked('POST /events');
    mockMiniGames(api, { guest: 'NOT_LOGGED_IN' });
    const { calls } = mockAlbum(api);
    await page.goto('/vuon-xanh/so-tay');
    await expect(page.getByText(albumCopy('guest'))).toBeVisible({ timeout: 15_000 });
    await shot(page, 'web-390-guest');
    await page.goto('/vuon-xanh');
    await expect(page.getByTestId('mini-play-status-sort')).toHaveText(gameCopy('row.trial'), { timeout: 15_000 });
    await expect(page.getByTestId('album-entry')).toHaveCount(0);
    expect(calls).toHaveLength(0);
  });

  test('lỗi mạng khi tải sổ: báo lỗi kèm Thử lại, thử lại thì hiện sổ', async ({ page, api }) => {
    member(api);
    mockAlbum(api, { failLoads: 2 });
    await signedIn(page);
    await page.goto('/vuon-xanh/so-tay');
    const retry = page.getByRole('button', { name: 'Thử lại' });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await retry.click();
    await expect(grid(page)).toBeVisible({ timeout: 15_000 });
  });
});
