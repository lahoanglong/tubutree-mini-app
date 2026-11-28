import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import {
  BASKET_TASK,
  basketIndex,
  expectNoHorizontalOverflow,
  expectTargets44,
  gameCopy,
  MATCH_CARDS,
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
 * Game mini đợt B trên web: cùng hành vi với Mini App ở 390px (chạm), thêm phần riêng của web ở 1440px: chơi trọn bằng bàn phím, lưới Ghép Cặp 4
 * cột, bản đồ Đoán Xuất Xứ ở cột phải (có Hoàng Sa, Trường Sa), thêm bộ Giỏ Đúng Việc vào giỏ một lần.
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
async function tabAndPress(page: Page, target: Locator, key = 'Enter', max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) {
      await page.keyboard.press(key);
      return;
    }
  }
  throw new Error('Không Tab tới được phần tử cần bấm');
}

/** Lệnh ghi vào API game (nộp ván, nhận thưởng): sau khi thêm giỏ không được có thêm lệnh nào. */
const gameWrites = (api: MockApi) => api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/game')).length;

const matchIndex = (id: string) => MATCH_CARDS.findIndex((c) => c.cardId === id);

test.describe('Web 390px (điện thoại) đợt B', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại chạy ở project Web Customer Mobile'));

  test('Ghép Cặp trọn ván bằng chạm: lưới 3 cột, kết quả có sản phẩm theo cặp', async ({ page, api }) => {
    member(api);
    mockMiniShop(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh?tab=games');
    await expect(page.getByTestId('mini-play-row-match').getByRole('link')).toHaveAttribute('href', '/vuon-xanh/choi/match', { timeout: 15_000 });
    await page.getByTestId('mini-play-row-match').getByRole('link').click();
    await expect(page).toHaveURL(/\/vuon-xanh\/choi\/match$/);
    await startRound(page);
    const board = page.getByTestId('mini-match');
    await expect(board).toBeVisible();
    const xs = await page.locator('.tubu-mg-tile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size, 'lưới 3 cột').toBe(3);
    await expectTargets44(board);
    await expectNoHorizontalOverflow(page);
    await playMatch(page);
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ roundId: 'r-match', answers: MATCH_PAIRS });
    await expect(page.getByTestId('mini-result-products').locator('a').first()).toHaveAttribute('href', '/san-pham/dau-goi-bo-ket?entrySource=game:match');
    await expectTargets44(page.getByTestId('mini-result'));
    await expectNoHorizontalOverflow(page);
  });

  test('Đoán Xuất Xứ trọn ván bằng chạm: không có bản đồ ở điện thoại', async ({ page, api }) => {
    member(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/origin');
    await startRound(page);
    await expect(page.getByTestId('mini-origin')).toBeVisible();
    await expect(page.getByTestId('mini-origin-map')).toHaveCount(0);
    await expectTargets44(page.getByTestId('mini-origin'));
    await expectNoHorizontalOverflow(page);
    await playOrigin(page);
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ answers: [0, 1, 2, 3, 0] });
    await expect(page.getByTestId('mini-result-product')).toContainText(ORIGIN_PRODUCT.name);
    await expectNoHorizontalOverflow(page);
  });

  test('Giỏ Đúng Việc trọn ván bằng chạm, thêm bộ vào giỏ một lần (chạm đúp), không gọi API game', async ({ page, api }) => {
    member(api);
    const { cartPosts } = mockMiniShop(api);
    mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/basket');
    await startRound(page);
    await expect(page.getByTestId('mini-basket')).toBeVisible();
    await expectTargets44(page.getByTestId('mini-basket'));
    await expectNoHorizontalOverflow(page);
    for (const slug of ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas']) await page.getByTestId(`mini-basket-item-${basketIndex(slug)}`).click();
    await page.getByRole('button', { name: gameCopy('basket.done') }).click();
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    const set = page.getByTestId('mini-basket-set');
    await expect(set).toBeVisible();
    const before = gameWrites(api);
    await set.getByRole('button', { name: gameCopy('basket.add') }).dblclick();
    await expect(page.getByTestId('mini-basket-status')).toContainText(gameCopy('basket.added', { n: 2 }));
    expect(cartPosts).toHaveLength(1);
    expect(cartPosts[0]!.items).toHaveLength(2);
    expect(gameWrites(api)).toBe(before);
    await expect(set.getByRole('button', { name: gameCopy('basket.viewCart') })).toBeVisible();
    await expectTargets44(page.getByTestId('mini-result'));
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('Web 1440px đợt B', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'Web Customer', 'khổ rộng chạy ở project Web Customer'));

  test('Ghép Cặp trọn ván bằng bàn phím: lưới 4 cột, thẻ là nút có tên đọc được', async ({ page, api }) => {
    member(api);
    mockMiniShop(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/match');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    await expect(page.getByTestId('mini-match')).toBeVisible();
    const xs = await page.locator('.tubu-mg-tile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size, 'lưới 4 cột').toBe(4);
    const first = page.getByTestId('mini-match-card-0');
    await expect(first).toHaveAttribute('aria-label', gameCopy('match.cardAria', { n: 1, label: MATCH_CARDS[0]!.label, side: gameCopy('match.side.ingredient') }));
    await tabAndPress(page, first);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    for (const [a, b] of MATCH_PAIRS) {
      for (const id of [a, b]) {
        const card = page.getByTestId(`mini-match-card-${matchIndex(id)}`);
        if ((await card.getAttribute('data-state')) === 'selected') continue;
        await card.focus();
        await page.keyboard.press(id === b ? 'Enter' : 'Space');
      }
    }
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ answers: MATCH_PAIRS });
    await expectNoHorizontalOverflow(page);
  });

  test('Đoán Xuất Xứ trọn ván bằng bàn phím; bản đồ cột phải tô vùng đang chọn, có Hoàng Sa và Trường Sa', async ({ page, api }) => {
    member(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/origin');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    const map = page.getByTestId('mini-origin-map');
    await expect(map).toBeVisible();
    await expect(map.getByRole('img', { name: /Hoàng Sa và Trường Sa/ })).toBeVisible();
    await expect(map).toContainText('Hoàng Sa');
    await expect(map).toContainText('Trường Sa');
    const optBox = (await page.getByTestId('mini-origin-option-0').boundingBox())!;
    const mapBox = (await map.boundingBox())!;
    expect(mapBox.x, 'bản đồ ở cột phải các lựa chọn').toBeGreaterThan(optBox.x + optBox.width);
    for (let i = 0; i < ORIGIN_ITEMS.length; i++) {
      await expect(page.getByTestId('mini-origin-prompt')).toHaveText(ORIGIN_ITEMS[i]!.prompt);
      const pick = i % 4;
      await tabAndPress(page, page.getByTestId(`mini-origin-option-${pick}`));
      await expect(page.getByTestId(`mini-origin-option-${pick}`)).toHaveAttribute('aria-pressed', 'true');
      if (i === 0) await expect(map).toHaveAttribute('data-spot', 'dong-bac');
      await tabAndPress(page, page.getByRole('button', { name: gameCopy(i === ORIGIN_ITEMS.length - 1 ? 'quiz.finish' : 'origin.next') }));
    }
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ answers: [0, 1, 2, 3, 0] });
    await expect(page.getByTestId('mini-result-product').locator('a').first()).toHaveAttribute('href', `/san-pham/${ORIGIN_PRODUCT.slug}?entrySource=game:origin`);
    await expectNoHorizontalOverflow(page);
  });

  test('Giỏ Đúng Việc trọn ván bằng bàn phím: Space chọn/bỏ, món thứ tư không vào; thêm bộ vào giỏ bằng Enter', async ({ page, api }) => {
    member(api);
    const { cartPosts } = mockMiniShop(api);
    const { submits } = mockMiniGames(api);
    await signedIn(page);
    await page.goto('/vuon-xanh/choi/basket');
    await expect(page.getByTestId('mini-intro')).toBeVisible({ timeout: 15_000 });
    await tabAndPress(page, page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }));
    await expect(page.getByTestId('mini-basket-task')).toHaveText(BASKET_TASK.task);
    for (const slug of ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas', 'khan-lau-soi-tre']) {
      await page.getByTestId(`mini-basket-item-${basketIndex(slug)}`).focus();
      await page.keyboard.press('Space');
    }
    await expect(page.getByTestId(`mini-basket-item-${basketIndex('khan-lau-soi-tre')}`)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('mini-basket-hint')).toHaveText(gameCopy('basket.full'));
    await tabAndPress(page, page.getByRole('button', { name: gameCopy('basket.done') }));
    await expect(page.getByTestId('mini-result')).toBeVisible({ timeout: 15_000 });
    expect(submits[0]!.body).toMatchObject({ answers: ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'tui-vai-canvas'] });
    const add = page.getByTestId('mini-basket-set').getByRole('button', { name: gameCopy('basket.add') });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mini-basket-status')).toContainText(gameCopy('basket.added', { n: 2 }));
    expect(cartPosts).toHaveLength(1);
    await expectNoHorizontalOverflow(page);
  });
});
