import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockCheckout, CHECKOUT_ADDRESS, ORDER_CODE_COD } from './support/checkout-mocks';
import { mockDiscovery, productDetail, CATALOG } from './support/discovery-mocks';
import { PILOT_CART } from './support/pilot-mocks';

/**
 * Mini App 360px và 375px: Reel 100dvh của câu chuyện sản phẩm đi trọn đường mua. Mở Reel, vuốt qua năm chương 01 → 05 (ảnh nguyên liệu của chương kế
 * được tải trước), đọc thẻ chỉ nguyên liệu, bấm Thêm vào giỏ ngay ở thanh đáy của Reel, sang Giỏ, sang Thanh toán và đặt COD. API mock toàn bộ.
 * Ảnh nguyên liệu dùng host ngoài (mock-api chặn host ngoài): cái cần xem là trình duyệt CÓ GỬI request, không phải ảnh có tải về.
 */
const SLUG = 'tinh-dau-thu-nghiem';
const BASE = CATALOG[0]!;
const CDN = 'https://cdn.tubu.test';
const VARIATION_ID = 'flow-v1';
const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 375, height: 812 },
] as const;

const STORY = {
  version: 1,
  enabled: true,
  scenes: [
    {
      kind: 'ingredient_assembly',
      steps: [1, 2, 3, 4, 5].map((n) => ({
        title: `Chương ${n}`,
        body: `Nội dung chương ${n}: 100g, 250kcal, 45.000đ.`,
        layers: [{ id: `ing-${n}`, imageUrl: `${CDN}/ing-${n}.png`, label: `Nguyên liệu ${n}`, from: 'top', xPct: 20 + n * 10, yPct: 40, scale: 1, rotateDeg: 0 }],
      })),
    },
    {
      kind: 'hud_callouts',
      closing: 'An lành cho cả nhà',
      points: [
        { id: 'h1', xPct: 28, yPct: 30, label: 'Tinh dầu bưởi', value: '2%', barPct: 2, side: 'left' },
        { id: 'h2', xPct: 72, yPct: 62, label: 'Bồ kết', value: '3%', barPct: 3, side: 'right' },
      ],
    },
  ],
};

const CART_LINE = {
  ...PILOT_CART.items[0]!,
  id: 'flow-line-1',
  variationId: VARIATION_ID,
  slug: SLUG,
  productName: 'Tinh dầu thử nghiệm',
  variationName: 'Mặc định',
  unitPrice: 165_000,
  quantity: 1,
  total: 165_000,
};
const FULL_CART = { ...PILOT_CART, items: [CART_LINE], subtotal: 165_000, itemCount: 1 };
const EMPTY = { ...PILOT_CART, items: [], subtotal: 0, itemCount: 0 };

function mockFlow(api: MockApi, opts: { stock?: number } = {}): { added: () => boolean } {
  let added = false;
  mockDiscovery(api);
  // Sau mockDiscovery: nó đặt /me/addresses rỗng, còn Thanh toán cần địa chỉ mặc định của mockCheckout.
  mockCheckout(api);
  api.get('/products/:slug', () => ({
    ...productDetail(BASE.slug)!,
    slug: SLUG,
    brand: 'Tubu',
    name: 'Tinh dầu thử nghiệm',
    shortDesc: 'Tinh dầu thiên nhiên.',
    certifications: ['Vegan'],
    ingredients: [{ name: 'Tinh dầu bưởi', percentage: '2%', benefit: 'Kích thích mọc tóc' }],
    storyConfig: STORY,
    variations: [{ id: VARIATION_ID, sku: 'FLOW-1', name: 'Mặc định', attributes: {}, retailPrice: 165_000, salePrice: null, stock: opts.stock ?? 5 }],
  }));
  api.get('/cart', () => (added ? FULL_CART : EMPTY));
  api.post('/cart/items', () => {
    added = true;
    return FULL_CART;
  });
  api.allowUnmocked('GET /coupons/available', 'GET /me/vouchers', 'GET /products/:slug/reviews/can-review');
  return { added: () => added };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const vp of VIEWPORTS) {
  test.describe(`Reel câu chuyện sản phẩm ${vp.width}px: Reel → Giỏ → Thanh toán`, () => {
    test.use({ viewport: vp });

    test('Reel phủ 100dvh, thanh đáy ghim đúng đáy, vùng chạm từ 44px, không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog).toBeVisible();

      const box = (await dialog.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(vp.width);
      expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(1);

      const bar = (await dialog.locator('.tubu-story-bar').boundingBox())!;
      expect(Math.abs(bar.y + bar.height - vp.height)).toBeLessThanOrEqual(1);
      expect(bar.x).toBe(0);
      expect(bar.width).toBe(vp.width);

      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await dialog.getByTestId('story-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      const targets = [dialog.getByTestId('story-close'), dialog.getByTestId('story-add-to-cart'), dialog.getByTestId('story-buy-now'), ...(await dialog.getByTestId('story-step-chip').all())];
      expect(targets).toHaveLength(8);
      for (const t of targets) {
        const b = (await t.boundingBox())!;
        expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
      }
    });

    test('vuốt qua năm chương 01 → 05: chữ và lớp nguyên liệu đổi, hiệu ứng vào theo ease-story 240ms, ảnh chương kế được tải trước', async ({ page, api }) => {
      mockFlow(api);
      const requested: string[] = [];
      page.on('request', (r) => {
        if (r.url().startsWith(CDN)) requested.push(r.url().slice(CDN.length + 1));
      });
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog).toBeVisible();

      const chips = dialog.getByTestId('story-step-chip');
      await expect(chips).toHaveCount(5);
      // Ở chương 01: ảnh chương 02 đã đi tải, chương 03 thì chưa.
      await expect.poll(() => requested.includes('ing-2.png')).toBe(true);
      expect(requested).not.toContain('ing-3.png');

      for (let i = 0; i < 5; i += 1) {
        await chips.nth(i).click();
        await expect(chips.nth(i)).toHaveAttribute('aria-current', 'step');
        await expect(dialog.getByTestId('story-step-panel')).toContainText(`Chương ${i + 1}`);
        await expect(dialog.getByTestId('story-step-panel')).toContainText('100g, 250kcal, 45.000đ');
        await expect(dialog.getByTestId('story-layer')).toHaveCount(i + 1);

        const anim = await dialog.locator('.tubu-story-panel-in').evaluate((el) => {
          const s = getComputedStyle(el);
          return { name: s.animationName, duration: s.animationDuration, easing: s.animationTimingFunction, numeric: s.fontVariantNumeric };
        });
        expect(anim).toEqual({ name: 'tubu-story-panel-in', duration: '0.24s', easing: 'cubic-bezier(0.22, 1, 0.36, 1)', numeric: 'tabular-nums' });

        // Chương kế (nếu còn) đã được yêu cầu tải ngay khi chương này hiện.
        if (i < 4) await expect.poll(() => requested.includes(`ing-${i + 2}.png`)).toBe(true);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('thẻ chỉ nguyên liệu: tên và hàm lượng nằm gọn trong khung, không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      const hud = dialog.getByTestId('story-hud');
      await hud.scrollIntoViewIfNeeded();
      const callouts = dialog.getByTestId('story-callout');
      await expect(callouts).toHaveCount(2);
      await expect(callouts.nth(0)).toContainText('Tinh dầu bưởi');
      await expect(callouts.nth(0)).toContainText('2%');
      await expect(callouts.nth(1)).toContainText('Bồ kết');
      for (const c of await callouts.all()) {
        const b = (await c.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('Thêm vào giỏ ở thanh đáy Reel → Giỏ → Thanh toán → đặt COD thành công', async ({ page, api }) => {
      const state = mockFlow(api);
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await dialog.getByTestId('story-step-chip').nth(2).click();

      const adding = api.waitForCall('POST', '/cart/items');
      await dialog.getByTestId('story-add-to-cart').click();
      const call = await adding;
      expect(call.body).toMatchObject({ variationId: VARIATION_ID, quantity: 1 });
      expect(state.added()).toBe(true);
      await expect(dialog).toHaveCount(0);

      await page.getByRole('button', { name: 'Xem giỏ hàng' }).click();
      await expect(page).toHaveURL(/\/cart/);
      await expect(page.getByText('Tinh dầu thử nghiệm').first()).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      await page.getByTestId('sticky-bar').getByRole('button', { name: /^Thanh toán/ }).click();
      await expect(page).toHaveURL(/\/checkout/);
      await expect(page.getByText(CHECKOUT_ADDRESS.street, { exact: false })).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      const placeBtn = page.getByRole('button', { name: /^Đặt hàng/ });
      await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
      const placed = api.waitForCall('POST', '/checkout/place-order');
      await placeBtn.click();
      expect((await placed).body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id, paymentMethod: 'COD' });
      await expect(page.getByText('Cảm ơn bạn đã chọn Tubu')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(ORDER_CODE_COD)).toBeVisible();
    });

    test('hết hàng: thanh đáy Reel khoá cả hai nút, không gọi thêm giỏ', async ({ page, api }) => {
      mockFlow(api, { stock: 0 });
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog.getByTestId('story-add-to-cart')).toBeDisabled();
      await expect(dialog.getByTestId('story-buy-now')).toBeDisabled();
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
    });

    test('giảm chuyển động: không còn chip và hiệu ứng, cả năm chương hiện tĩnh, vẫn không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/product/${SLUG}`);
      await expect(page.getByTestId('product-story')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }).click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('story-step-chip')).toHaveCount(0);
      await expect(dialog.getByTestId('story-static-steps').locator('li')).toHaveCount(5);
      await expect(dialog.locator('.tubu-story-panel-in')).toHaveCount(0);
      const layerAnim = await dialog.getByTestId('story-layer').first().evaluate((el) => getComputedStyle(el).animationName);
      expect(layerAnim).toBe('none');
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(dialog.getByTestId('story-add-to-cart')).toBeEnabled();
    });
  });
}
