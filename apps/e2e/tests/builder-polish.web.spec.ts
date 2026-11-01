import { expect, reply, test } from './support/mock-api';
import { mockBuilder, setBuilderSession } from './support/builder-web-mocks';
import { mockDiscovery } from './support/discovery-mocks';
import { assertSeededOnCi } from './support/a11y-db';
import { LG_COMBO_ITEMS, LG_SHELF_FEW, LG_SHELF_MANY, LG_SHELF_SIX, LG_SHELVES_SLUG, seedLgShelves } from './support/lg-shelves-db';

/**
 * G6 (P2 #35, #36): web máy tính 1280px. Trình dựng: hai nút lên hàng tiêu đề (không thanh dính đáy), chi tiết khối hai cột. Trang gian hàng công khai:
 * ComboCard có trần bề rộng, kệ ít món thành lưới. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`); riêng trang công khai do máy chủ web
 * dựng từ API thật nên dùng gian hàng mẫu của `seedLgShelves` trong DB tạm.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test.describe('Trình dựng gian hàng web 1280px (G6 #35)', () => {
  test.beforeEach(async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'khổ máy tính chỉ chạy ở project Web Customer');
    await setBuilderSession(page);
    mockBuilder(api);
  });

  test('hai nút "Xem trước" và "Chia sẻ" nằm ở hàng tiêu đề, không còn thanh dính đáy', async ({ page }) => {
    await page.goto('/ctv/gian-hang');
    await expect(page.getByText('Bộ sưu tập A')).toBeVisible({ timeout: 20_000 });
    const slot = page.getByTestId('builder-head-actions');
    await expect(slot).toBeVisible();
    const h1 = (await page.getByRole('heading', { level: 1, name: 'Gian hàng của tôi' }).boundingBox())!;
    const preview = (await slot.getByText('Xem trước').boundingBox())!;
    expect(Math.abs(preview.y + preview.height / 2 - (h1.y + h1.height / 2)), 'nút cùng hàng với tiêu đề').toBeLessThanOrEqual(24);
    // Hai bản nút cùng có trong cây; CSS chỉ cho bản ở hàng tiêu đề nhìn thấy từ lg, thanh dính đáy là display:none.
    await expect(page.locator('text="Xem trước"').locator('visible=true')).toHaveCount(1);
    await expect(page.getByTestId('builder-bar')).toBeHidden();
  });

  test('hàng tiêu đề và hai nút đứng yên từ lần vẽ đầu: tiêu đề không dịch khi nút tới (H3 #7)', async ({ page }) => {
    // Ghi vị trí h1 và nút đầu của ô hàng tiêu đề ở MỖI khung hình từ lúc tải trang.
    await page.addInitScript(() => {
      const frames: { h1: number | null; btn: number | null; btnShown: boolean }[] = [];
      (window as unknown as { __frames: typeof frames }).__frames = frames;
      const tick = () => {
        const h1 = document.querySelector('h1');
        const b = document.querySelector<HTMLElement>('[data-testid="builder-head-actions"] a, [data-testid="builder-head-actions"] button');
        frames.push({ h1: h1 ? h1.getBoundingClientRect().y : null, btn: b ? b.getBoundingClientRect().y : null, btnShown: !!b && b.getClientRects().length > 0 });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto('/ctv/gian-hang');
    await expect(page.getByTestId('builder-head-actions').getByText('Xem trước')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(600);
    const frames = await page.evaluate(() => (window as unknown as { __frames: { h1: number | null; btn: number | null; btnShown: boolean }[] }).__frames);
    const h1 = frames.map((f) => f.h1).filter((y): y is number => y !== null);
    expect(h1.length, 'h1 có mặt ở nhiều khung').toBeGreaterThan(5);
    expect(Math.max(...h1) - Math.min(...h1), `y của h1 qua các khung: ${[...new Set(h1)].join(', ')}`).toBeLessThanOrEqual(1);
    const shown = frames.filter((f) => f.btnShown).map((f) => f.btn!);
    expect(shown.length).toBeGreaterThan(5);
    expect(Math.max(...shown) - Math.min(...shown), 'nút đứng yên từ khung đầu nhìn thấy').toBeLessThanOrEqual(1);
  });

  test('dưới lg (375px) ô hàng tiêu đề ẩn và thanh dính đáy hiện', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/ctv/gian-hang');
    await expect(page.getByTestId('builder-bar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('builder-head-actions')).toBeHidden();
  });

  test('chi tiết khối: khung "Khách sẽ thấy" nằm cột phải, trang không tràn ngang', async ({ page }) => {
    await page.goto('/ctv/gian-hang?khoi=c1');
    const preview = page.getByTestId('shop-section-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    const box = (await preview.boundingBox())!;
    expect(box.x, 'khung xem trước ở cột phải').toBeGreaterThan(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Gian hàng công khai web (G6 #36)', () => {
  let seeded = false;
  test.beforeAll(async () => {
    seeded = await seedLgShelves();
    assertSeededOnCi(seeded);
  });
  test.beforeEach(async ({ api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'khổ máy tính chỉ chạy ở project Web Customer');
    test.skip(!seeded, 'DB e2e không phải DB tạm: không dựng được gian hàng mẫu');
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    api.get('/config/public', {});
    api.get('/me/wishlist/ids', []);
    mockDiscovery(api);
  });

  const section = (page: import('@playwright/test').Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

  /** Số cột của `GRID_PRODUCTS` (lưới Sản phẩm) theo bề rộng cửa sổ: 5 từ lg (1024px), 6 từ xl (1280px); khe 16px từ md. */
  const COLUMNS_AT = (width: number) => (width >= 1280 ? 6 : 5);
  const GAP = 16;

  async function expectProductsGridColumns(page: import('@playwright/test').Page, width: number): Promise<void> {
    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeHidden();
    const grid = few.getByTestId('shop-rail-lg');
    await expect(grid).toBeVisible();
    const box = (await grid.boundingBox())!;
    const tiles = await grid.locator('[data-ds="product-tile"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(tiles).toHaveLength(LG_SHELF_FEW);
    const cols = COLUMNS_AT(width);
    const expected = (box.width - GAP * (cols - 1)) / cols;
    for (const t of tiles) expect(Math.abs(t.width - expected), `thẻ rộng ${t.width}px, lưới Sản phẩm ${cols} cột cho ${expected}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(tiles[0]!.left - box.x), 'thẻ đầu sát mép trái lưới').toBeLessThanOrEqual(1);
    // Hàng chưa đầy dồn trái là chủ ý (như hàng cuối của lưới Sản phẩm): thẻ liền nhau cách đúng một khe.
    expect(Math.abs(tiles[1]!.left - tiles[0]!.right - GAP)).toBeLessThanOrEqual(1);
  }

  test('1280px: ComboCard không rộng quá 600px; kệ ít món là lưới cùng 6 cột với lưới Sản phẩm, kệ nhiều món vẫn là kệ ngang', async ({ page }) => {
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const combo = page.getByTestId('shop-combo');
    await expect(combo).toBeVisible({ timeout: 20_000 });
    expect((await combo.boundingBox())!.width, 'ComboCard giãn hết khung').toBeLessThanOrEqual(600);
    expect(LG_COMBO_ITEMS).toBeGreaterThanOrEqual(2);

    await expectProductsGridColumns(page, 1280);

    const many = section(page, 'Kệ nhiều món');
    await expect(many.getByTestId('shop-rail-lg')).toHaveCount(0);
    await expect(many.getByTestId('shop-rail')).toBeVisible();
    expect(LG_SHELF_MANY).toBeGreaterThan(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('1100px (lg, dưới xl): kệ ít món là lưới 5 cột như lưới Sản phẩm', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    await expect(page.getByTestId('shop-combo')).toBeVisible({ timeout: 20_000 });
    await expectProductsGridColumns(page, 1100);
  });

  // Ngưỡng RAIL_AS_GRID_MAX (6 món) vẫn là lưới chuẩn của trang: ở lg 5 cột nên sáu món xếp 5 + 1 (thẻ lẻ ở hàng hai, dồn trái, cùng bề rộng), ở xl 6 cột nên vừa một hàng.
  for (const [label, width, perRow] of [['1100px (lg, 5 cột)', 1100, 5], ['1280px (xl, 6 cột)', 1280, 6]] as const) {
    test(`${label}: kệ đúng ${LG_SHELF_SIX} món là lưới chuẩn, ${perRow} thẻ ở hàng đầu`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/s/${LG_SHELVES_SLUG}`);
      const six = section(page, 'Kệ sáu món');
      const grid = six.getByTestId('shop-rail-lg');
      await expect(grid).toBeVisible({ timeout: 20_000 });
      const box = (await grid.boundingBox())!;
      const tiles = await grid.locator('[data-ds="product-tile"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
      expect(tiles).toHaveLength(LG_SHELF_SIX);
      const cols = COLUMNS_AT(width);
      const expected = (box.width - GAP * (cols - 1)) / cols;
      for (const t of tiles) expect(Math.abs(t.width - expected), `thẻ rộng ${t.width}px, lưới Sản phẩm ${cols} cột cho ${expected}px`).toBeLessThanOrEqual(1);
      const firstRow = tiles.filter((t) => Math.abs(t.top - tiles[0]!.top) <= 1);
      expect(firstRow, 'số thẻ ở hàng đầu').toHaveLength(perRow);
      if (perRow < LG_SHELF_SIX) {
        const rest = tiles.slice(perRow);
        expect(rest, 'thẻ lẻ ở hàng hai').toHaveLength(LG_SHELF_SIX - perRow);
        expect(rest[0]!.top, 'hàng hai nằm dưới hàng đầu').toBeGreaterThan(tiles[0]!.bottom - 1);
        expect(Math.abs(rest[0]!.left - box.x), 'thẻ lẻ dồn trái, cùng cột với thẻ đầu').toBeLessThanOrEqual(1);
      }
    });
  }

  for (const [label, width] of [['1280px', 1280], ['375px', 375]] as const) {
    test(`${label}: kệ ít món chỉ có một bản thẻ trong cây trợ năng và một bản ảnh nhìn thấy (bản kia display:none)`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
      await page.goto(`/s/${LG_SHELVES_SLUG}`);
      const few = section(page, 'Kệ ít món');
      await expect(few.getByTestId(width === 375 ? 'shop-rail' : 'shop-rail-lg')).toBeVisible({ timeout: 20_000 });
      // Playwright bỏ phần tử display:none khỏi getByRole: hai bản cùng thấy được thì số liên kết gấp đôi.
      const links = few.getByRole('link');
      const names = await links.evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()));
      const productLinks = await few.locator('a[href^="/san-pham/"]:visible').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
      expect(new Set(productLinks).size, 'mỗi sản phẩm một liên kết nhìn thấy').toBe(productLinks.length);
      expect(productLinks).toHaveLength(LG_SHELF_FEW);
      expect(new Set(names).size, `tên liên kết không trùng: ${names.join(' | ')}`).toBe(names.length);
      const tilesShown = await few.locator('[data-ds="product-tile"]:visible').count();
      expect(tilesShown).toBe(LG_SHELF_FEW);
    });
  }

  test('375px: vẫn là kệ ngang như Mini, không có lưới', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeVisible({ timeout: 20_000 });
    await expect(few.getByTestId('shop-rail-lg')).toBeHidden();
  });
});
