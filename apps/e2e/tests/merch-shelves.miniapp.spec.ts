import { mkdirSync } from 'fs';
import path from 'path';
import type { Locator, Page } from '@playwright/test';
import { expect, mockSession, test, type MockApi } from './support/mock-api';
import { mockTourWorld, productCard, seedCatalog, tourUser } from './support/tour-world';

/**
 * W4-06 Xếp kệ ở Mini App: khi API đánh dấu kệ Bán chạy là kệ chọn tay (`curated: true` trên mọi thẻ), trang /best-sellers và kệ Trang chủ
 * đổi tiêu đề thành "Tubu chọn cho bạn", bỏ dòng thước đo và số hạng; thẻ thường (API cũ, đủ số bán) giữ nguyên "Bán chạy nhất" #1..#n.
 * Mock toàn bộ API. Có MERCH_SHOTS_DIR thì chụp ảnh 360×640 và 390×844 vào thư mục đó.
 */
const SHOTS_DIR = process.env.MERCH_SHOTS_DIR;
const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
];

const PINNED = seedCatalog().slice(2, 6).reverse();
const ORGANIC = seedCatalog().filter((p) => !PINNED.some((x) => x.id === p.id));
const curatedCards = () => PINNED.map((p) => ({ ...productCard(p), curated: true }));

/** Như API: món ghim (dấu `curated`) đứng đầu trang 1, sau là bảng xếp hạng thường không dấu; tổng tính cả hai nên vẫn còn trang sau. */
function mockCuratedBestSellers(api: MockApi) {
  api.get('/products', ({ call }) => {
    const page = Number(call.query.get('page') ?? 1);
    const limit = Number(call.query.get('limit') ?? 20);
    if (!(call.query.get('sort') ?? '').startsWith('best_seller')) {
      return { data: seedCatalog().slice(0, limit).map(productCard), meta: { page, limit, total: seedCatalog().length } };
    }
    const all = [...curatedCards(), ...ORGANIC.map(productCard)];
    return { data: all.slice((page - 1) * limit, page * limit), meta: { page, limit, total: all.length } };
  });
}

function setup(api: MockApi) {
  const user = tourUser('CUSTOMER');
  mockSession(api, user);
  mockTourWorld(api, user);
  api.allowUnmocked('GET /auth/me', 'GET /waste/requests', 'POST /cart/coupon');
}

const grid = (page: Page): Locator => page.getByTestId('catalog-grid');
const ranks = (page: Page): Locator => grid(page).locator('[data-ds-part="rank"]');

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function shoot(page: Page, name: string) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: false });
}

test.describe('Mini App — kệ Bán chạy chọn tay', () => {
  for (const size of SIZES) {
    test(`/best-sellers ${size.width}×${size.height}: "Tubu chọn cho bạn", đúng thứ tự ghim, không số hạng, không dòng thước đo`, async ({ page, api }) => {
      setup(api);
      mockCuratedBestSellers(api);
      await page.setViewportSize(size);
      await page.goto('/best-sellers');
      await expect(page.getByRole('heading', { level: 1, name: 'Tubu chọn cho bạn' })).toBeVisible({ timeout: 15_000 });
      await expect(grid(page)).toBeVisible({ timeout: 15_000 });
      // Nút tim (aria-pressed) cũng là button: chỉ lấy nút mở thẻ.
      const cards = grid(page).locator('button:not([aria-pressed])');
      await expect(cards).toHaveCount(PINNED.length);
      for (const [i, p] of PINNED.entries()) await expect(cards.nth(i)).toHaveAccessibleName(new RegExp(p.name));
      await expect(ranks(page)).toHaveCount(0);
      await expect(page.getByText('Theo lượt bán 30 ngày qua')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Bán chạy nhất' })).toHaveCount(0);
      // Phần xếp hạng thường sau món ghim không hiện và không có "Xem thêm" dù API còn trang sau.
      await expect(grid(page).getByText(ORGANIC[0]!.name)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
      await noHorizontalOverflow(page);
      await shoot(page, `mini-best-sellers-curated-${size.width}x${size.height}.png`);
    });

    test(`Trang chủ ${size.width}×${size.height}: kệ hiện "Tubu chọn cho bạn", không số hạng`, async ({ page, api }) => {
      setup(api);
      mockCuratedBestSellers(api);
      await page.setViewportSize(size);
      await page.goto('/');
      const heading = page.getByRole('heading', { name: 'Tubu chọn cho bạn' });
      await expect(heading).toBeAttached({ timeout: 15_000 });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      const rail = page.locator('section', { has: heading }).first();
      await expect(rail.getByText(PINNED[0]!.name).first()).toBeVisible();
      await expect(rail.getByText(ORGANIC[0]!.name)).toHaveCount(0);
      await expect(rail.locator('[data-ds-part="rank"]')).toHaveCount(0);
      await expect(rail.getByText('Theo lượt bán 30 ngày qua')).toHaveCount(0);
      await noHorizontalOverflow(page);
      await shoot(page, `mini-home-curated-${size.width}x${size.height}.png`);
    });
  }

  test('thẻ không mang dấu curated (đủ số bán hoặc API cũ): giữ "Bán chạy nhất", số hạng và dòng thước đo như hôm nay', async ({ page, api }) => {
    setup(api);
    api.get('/products', ({ call }) => {
      const page = Number(call.query.get('page') ?? 1);
      const limit = Number(call.query.get('limit') ?? 20);
      return { data: page === 1 ? PINNED.map(productCard) : [], meta: { page, limit, total: PINNED.length } };
    });
    await page.setViewportSize(SIZES[1]!);
    await page.goto('/best-sellers');
    await expect(page.getByRole('heading', { level: 1, name: 'Bán chạy nhất' })).toBeVisible({ timeout: 15_000 });
    await expect(ranks(page)).toHaveText(PINNED.map((_, i) => `#${i + 1}`), { timeout: 15_000 });
    await expect(page.getByText('Theo lượt bán 30 ngày qua', { exact: true })).toBeVisible();
  });
});
