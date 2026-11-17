import type { Page } from '@playwright/test';
import { matcherCopy } from '../../../packages/app-core/src/game-mini/matcher-copy';
import { test, expect, makeUser, mockSession, publicConfig, reply, type MockApi } from './support/mock-api';
import { mockNewbieGame } from './support/game-newbie-states';
import { expectNoHorizontalOverflow, expectTargets44, mockMiniGames } from './support/game-mini-mocks';

/**
 * Chọn Chuẩn Xanh trên web (cờ game.matcher_enabled): 5 bước dưới 1 phút, bộ 2–4 món, MỘT nút chính "Thêm cả bộ vào giỏ" thêm một lệnh lô;
 * khách thêm vào giỏ trình duyệt khi giỏ khách bật, không thì giữ bộ qua đăng nhập; bộ dự phòng; cờ tắt chỉ báo tạm nghỉ. Ảnh chụp 360/390/1440
 * ghi vào MATCHER_SHOTS_DIR khi có.
 */

const SHOTS = process.env.MATCHER_SHOTS_DIR;
const PATH = '/vuon-xanh/chon-chuan-xanh';

const opt = (value: string, label: string, tags: string[]) => ({ value, label, tags });
const CONTENT = {
  questions: [
    {
      code: 'need',
      step: 1,
      prompt: 'Bạn đang cần đồ cho việc gì nhất?',
      options: [opt('laundry', 'Giặt quần áo', ['laundry']), opt('kitchen', 'Rửa chén, bếp', ['kitchen']), opt('floor', 'Lau nhà, nhà tắm', ['floor'])],
      when: null,
    },
    {
      code: 'kitchen_how',
      step: 2,
      prompt: 'Nhà bạn rửa chén thế nào?',
      options: [opt('hand', 'Rửa tay', ['hand']), opt('machine', 'Máy rửa chén', ['machine'])],
      when: ['kitchen'],
    },
    { code: 'laundry_who', step: 2, prompt: 'Giặt cho ai là chính?', options: [opt('family', 'Cả nhà', ['adult']), opt('kids', 'Bé nhỏ', ['kids'])], when: ['laundry'] },
    { code: 'floor_where', step: 2, prompt: 'Lau chỗ nào nhiều nhất?', options: [opt('floor', 'Sàn nhà', ['floor_main']), opt('bath', 'Nhà tắm', ['bath'])], when: ['floor'] },
    {
      code: 'size_home',
      step: 3,
      prompt: 'Bạn muốn mua cỡ nào?',
      options: [opt('small', 'Chai nhỏ dùng thử', ['small']), opt('large', 'Chai lớn dùng lâu', ['large']), opt('refill', 'Can refill', ['refill'])],
      when: ['laundry', 'kitchen', 'floor'],
    },
  ],
  trivia: [
    { id: 'gm-matcher-t-a', prompt: 'Enzyme protease trong nước giặt xử lý vết gì?', options: ['Vết đạm như máu, sữa', 'Vết dầu mỡ', 'Vết mực'], answer: 0, explanation: 'Protease cắt chuỗi đạm nên hợp vết máu, sữa, trứng.', sourceUrl: 'https://www.example.org/protease' },
    { id: 'gm-matcher-t-b', prompt: 'Baking soda có tính gì?', options: ['Axit nhẹ', 'Kiềm nhẹ', 'Trung tính'], answer: 1, explanation: 'Baking soda là muối kiềm nhẹ, pH khoảng 8–9.', sourceUrl: 'https://www.example.org/baking-soda' },
    { id: 'gm-matcher-t-c', prompt: 'Axit citric giúp gì khi rửa ấm?', options: ['Tạo bọt', 'Tan cặn vôi', 'Tạo mùi'], answer: 1, explanation: 'Axit citric hoà tan cặn canxi cacbonat.', sourceUrl: 'https://www.example.org/citric' },
  ],
};
const item = (n: number, over: Record<string, unknown> = {}) => ({
  slug: `mon-xanh-${n}`,
  productId: `p-${n}`,
  variationId: `v-${n}`,
  name: ['Bột rửa chén cho máy Fuwa3e', 'Muối rửa chén cho máy', 'Nước làm bóng chén', 'Nước rửa chén sinh học'][n - 1]!,
  variationName: n === 1 ? '1kg' : null,
  imageUrl: null,
  price: [189_000, 99_000, 129_000, 79_000][n - 1]!,
  compareAtPrice: n === 2 ? 120_000 : null,
  flash: false,
  why: ['Hợp máy rửa chén, cỡ lớn dùng lâu.', 'Làm mềm nước cho máy.', 'Chén khô ráo, không vệt nước.', 'Dùng thêm khi rửa tay nồi chảo.'][n - 1]!,
  ...over,
});
const RESULT = { outcomeId: 'gm-matcher-o-kitchen-machine', code: 'kitchen_machine', title: 'Bộ máy rửa chén', fallback: false, items: [1, 2, 3, 4].map((n) => item(n)), total: 496_000, water: 0 };

function matcherOn(api: MockApi, result: unknown = RESULT) {
  api.get('/game/matcher/status', { enabled: true });
  api.get('/game/matcher', CONTENT);
  api.post('/game/matcher/result', () => result);
  api.allowUnmocked('POST /events');
}

function member(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-matcher', fullName: 'Khách chọn', phone: '0912345678', pointsBalance: 0 }));
  mockNewbieGame(api, 'new');
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

/** Đi trọn 5 bước bằng chạm; trả số mili giây từ lúc bấm Bắt đầu tới khi bộ hiện. */
async function play(page: Page, values: [string, string, string], shotPrefix?: string) {
  const root = page.getByTestId('matcher');
  await expect(page.getByTestId('matcher-intro')).toBeVisible({ timeout: 15_000 });
  if (shotPrefix) await shot(page, `${shotPrefix}-1-intro`);
  const t0 = Date.now();
  await root.getByRole('button', { name: matcherCopy('intro.start') }).click();
  await root.locator(`button[data-value="${values[0]}"]`).click();
  await expect(page.getByTestId('matcher-trivia')).toBeVisible();
  await page.getByTestId('matcher-trivia').locator('.tubu-mg-option').first().click();
  await expect(page.getByTestId('matcher-trivia-feedback')).toBeVisible();
  if (shotPrefix) await shot(page, `${shotPrefix}-2-trivia`);
  await root.getByRole('button', { name: matcherCopy('next') }).click();
  await root.locator(`button[data-value="${values[1]}"]`).click();
  await page.getByTestId('matcher-trivia').locator('.tubu-mg-option').nth(1).click();
  await root.getByRole('button', { name: matcherCopy('next') }).click();
  await expect(page.getByTestId('matcher-question-3')).toBeVisible();
  if (shotPrefix) await shot(page, `${shotPrefix}-3-question`);
  await root.locator(`button[data-value="${values[2]}"]`).click();
  await expect(page.getByTestId('matcher-result')).toBeVisible({ timeout: 15_000 });
  return Date.now() - t0;
}

async function expectOnePrimary(page: Page) {
  await expect(page.getByTestId('matcher-result').locator('button.zaui-btn-primary')).toHaveCount(1);
}

for (const vp of [
  { width: 360, height: 780, project: 'Web Customer Mobile' },
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
]) {
  test.describe(`Chọn Chuẩn Xanh web ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== vp.project, `khổ ${vp.width}px chạy ở project ${vp.project}`));

    test('thành viên: lối vào ở Chơi hôm nay, 5 bước dưới 60 giây, thêm cả bộ một lệnh 4 món, không tự chuyển trang', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      matcherOn(api);
      api.post('/cart/items/batch', { items: [], subtotal: 0, discount: 0, itemCount: 4 });
      await signedIn(page);
      await page.goto('/vuon-xanh');
      const row = page.getByTestId('mini-play-row-matcher');
      await expect(row).toHaveAttribute('href', `${PATH}?from=play_today`, { timeout: 15_000 });
      await row.click();
      await expect(page).toHaveURL(new RegExp(`${PATH}\\?from=play_today$`));
      const ms = await play(page, ['kitchen', 'machine', 'large'], `${vp.width}-member`);
      expect(ms, '5 bước dưới 60 giây').toBeLessThan(60_000);
      const result = page.getByTestId('matcher-result');
      await expect(result.getByTestId('matcher-items').locator('li')).toHaveCount(4);
      await expect(page.getByTestId('matcher-total')).toContainText(matcherCopy('result.total', { n: 4 }));
      await expectOnePrimary(page);
      await expectTargets44(result);
      await expectNoHorizontalOverflow(page);
      await shot(page, `${vp.width}-member-4-result`);
      const answers = (api.callsTo('POST', '/game/matcher/result')[0]!.body as { answers: unknown }).answers;
      expect(answers).toEqual([
        { code: 'need', value: 'kitchen' },
        { code: 'kitchen_how', value: 'machine' },
        { code: 'size_home', value: 'large' },
      ]);
      await result.getByRole('button', { name: matcherCopy('result.addAll') }).click();
      await expect(page.getByTestId('matcher-add-status')).toHaveText(matcherCopy('result.added', { n: 4 }));
      const batches = api.callsTo('POST', '/cart/items/batch');
      expect(batches).toHaveLength(1);
      expect((batches[0]!.body as { items: unknown[] }).items).toHaveLength(4);
      await expect(page).toHaveURL(new RegExp(`${PATH}`));
      await expect(result.getByRole('button', { name: matcherCopy('result.viewCart') })).toBeVisible();
      await expectOnePrimary(page);
      await shot(page, `${vp.width}-member-5-added`);
    });

    test('khách, giỏ khách bật: chơi trọn, thêm cả bộ vào giỏ trình duyệt, không gọi API giỏ', async ({ page, api }) => {
      api.get('/config/public', { ...publicConfig(), webGuestCartEnabled: true });
      matcherOn(api);
      await page.goto(`${PATH}?from=empty_cart`);
      await play(page, ['laundry', 'family', 'refill']);
      await page.getByTestId('matcher-result').getByRole('button', { name: matcherCopy('result.addAll') }).click();
      await expect(page.getByTestId('matcher-add-status')).toHaveText(matcherCopy('result.added', { n: 4 }));
      const lines = await page.evaluate(() => JSON.parse(localStorage.getItem('tubu.guestCart.v1') ?? '[]') as { variationId: string }[]);
      expect(lines.map((l) => l.variationId)).toEqual(['v-1', 'v-2', 'v-3', 'v-4']);
      expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(0);
      expect((api.callsTo('POST', '/game/matcher/result')[0]!.body as { deviceId?: string }).deviceId).toBeUndefined();
    });

    test('khách, giỏ khách tắt: "Thêm cả bộ" sang đăng nhập, quay về đúng trang', async ({ page, api }) => {
      matcherOn(api);
      await page.goto(PATH);
      await play(page, ['floor', 'bath', 'small']);
      await page.getByTestId('matcher-result').getByRole('button', { name: matcherCopy('result.addAll') }).click();
      await expect(page).toHaveURL(new RegExp(`/dang-nhap\\?returnTo=${encodeURIComponent(PATH)}`));
      expect(await page.evaluate(() => sessionStorage.getItem('tubu.matcher.pending.v1'))).not.toBeNull();
    });

    test('bộ dự phòng: "Bán chạy còn hàng" kèm câu ghi chú, vẫn một nút chính', async ({ page, api }) => {
      member(api);
      matcherOn(api, { ...RESULT, fallback: true, title: 'Nước rửa chén', items: [item(4, { why: '' }), item(3, { why: '' })] });
      await signedIn(page);
      await page.goto(PATH);
      await play(page, ['kitchen', 'hand', 'small']);
      await expect(page.getByTestId('matcher-result')).toHaveAttribute('data-fallback', 'true');
      await expect(page.getByTestId('matcher-result')).toContainText(matcherCopy('result.fallback'));
      await expect(page.getByTestId('matcher-fallback-note')).toBeVisible();
      await expect(page.getByTestId('matcher-items')).toContainText(matcherCopy('result.whyFallback'));
      await expectOnePrimary(page);
      await expectNoHorizontalOverflow(page);
      await shot(page, `${vp.width}-fallback`);
    });

    test('vùng chạm từng bước ≥ 44px, quay lại giữ đáp án', async ({ page, api }) => {
      matcherOn(api);
      await page.goto(PATH);
      await expect(page.getByTestId('matcher-intro')).toBeVisible({ timeout: 15_000 });
      const root = page.getByTestId('matcher');
      await root.getByRole('button', { name: matcherCopy('intro.start') }).click();
      await expectTargets44(root);
      await root.locator('button[data-value="kitchen"]').click();
      await page.getByTestId('matcher-trivia').locator('.tubu-mg-option').first().click();
      await expectTargets44(root);
      await page.getByTestId('matcher-back').click();
      await expect(root.locator('button[data-value="kitchen"]')).toHaveAttribute('aria-pressed', 'true');
      await expectNoHorizontalOverflow(page);
    });

    test('cờ tắt (mặc định PROD): trang chỉ báo tạm nghỉ, Chơi hôm nay không có dòng Chọn Chuẩn Xanh', async ({ page, api }) => {
      member(api);
      mockMiniGames(api);
      api.get('/game/matcher', reply(404, { statusCode: 404, code: 'GAME_DISABLED', message: 'Trò chơi đang tạm tắt' }));
      await signedIn(page);
      await page.goto('/vuon-xanh');
      await expect(page.getByTestId('mini-play-today')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('mini-play-row-matcher')).toHaveCount(0);
      await page.goto(PATH);
      await expect(page.getByTestId('matcher-off')).toContainText(matcherCopy('error.disabled'));
      await expect(page.getByRole('button', { name: matcherCopy('intro.start') })).toHaveCount(0);
      await shot(page, `${vp.width}-flag-off`);
    });
  });
}
