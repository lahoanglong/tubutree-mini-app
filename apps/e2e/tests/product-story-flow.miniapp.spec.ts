import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockCheckout, CHECKOUT_ADDRESS, ORDER_CODE_COD } from './support/checkout-mocks';
import { mockDiscovery, productDetail, CATALOG } from './support/discovery-mocks';
import { PILOT_CART } from './support/pilot-mocks';

/**
 * Mini App 360px và 375px: dải câu chuyện sản phẩm nằm ngay trên trang chi tiết và đường mua đi qua nó. Bấm qua năm thẻ chương 01 → 05 (ảnh nguyên liệu của chương
 * kế được tải trước), đọc thẻ chỉ nguyên liệu, bấm Thêm vào giỏ ở thanh dưới của trang, sang Giỏ, sang Thanh toán và đặt COD. API mock toàn bộ.
 * Ảnh nguyên liệu dùng host ngoài (mock-api chặn host ngoài): cái cần xem là trình duyệt CÓ GỬI request, không phải ảnh có tải về.
 * Có `cutoutUrl` để khung ảnh là ảnh tách nền: chỉ lúc đó sprite nguyên liệu và thẻ chỉ HUD mới vẽ đè lên ảnh (ảnh poster không vẽ gì lên).
 * `cutout: false` là ảnh poster (thẻ nổi): không lớp nguyên liệu, điểm nhấn thành chip dưới ảnh.
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
  cutoutUrl: `${CDN}/cutout.png`,
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

// Ảnh poster: cùng kịch bản nhưng không có cutoutUrl (undefined bị JSON bỏ đi).
const POSTER_STORY = { ...STORY, cutoutUrl: undefined };

function mockFlow(api: MockApi, opts: { stock?: number; cutout?: boolean } = {}): { added: () => boolean } {
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
    storyConfig: opts.cutout === false ? POSTER_STORY : STORY,
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

/** Vào trang chi tiết, chờ dải câu chuyện dựng xong rồi cuộn tới nó (ảnh chương kế chỉ tải khi dải đã gần khung nhìn). */
async function gotoStory(page: Page): Promise<Locator> {
  await page.goto(`/product/${SLUG}`);
  const story = page.getByTestId('product-story');
  await expect(story).toBeVisible({ timeout: 20_000 });
  await story.scrollIntoViewIfNeeded();
  return story;
}

for (const vp of VIEWPORTS) {
  test.describe(`Dải câu chuyện sản phẩm ${vp.width}px: Chi tiết → Giỏ → Thanh toán`, () => {
    // Khung toàn màn (thanh đáy ghim, hai nút mua khoá khi hết hàng) nay chỉ còn ở Reel Trang chủ, do w42a-home-story-reel.*.spec.ts phủ.
    test.use({ viewport: vp });

    test('mọi chương hiện cùng lúc ngay trong trang, thẻ chương từ 44px và nằm gọn trong màn, không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      const story = await gotoStory(page);

      const cards = story.getByTestId('story-step-card');
      await expect(cards).toHaveCount(5);
      for (const c of await cards.all()) {
        await expect(c).toBeVisible();
        const b = (await c.boundingBox())!;
        expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.x, 'thẻ lệch ra ngoài mép trái').toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, 'thẻ tràn mép phải').toBeLessThanOrEqual(vp.width);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('bấm qua năm chương 01 → 05: thẻ sáng đúng, lớp nguyên liệu thêm dần, hiệu ứng rơi theo ease-story 240ms, ảnh chương kế được tải trước', async ({ page, api }) => {
      mockFlow(api);
      const requested: string[] = [];
      page.on('request', (r) => {
        if (r.url().startsWith(CDN)) requested.push(r.url().slice(CDN.length + 1));
      });
      const story = await gotoStory(page);

      const cards = story.getByTestId('story-step-card');
      await expect(cards).toHaveCount(5);
      // Ở chương 01: ảnh chương 02 đã đi tải, chương 03 thì chưa.
      await expect.poll(() => requested.includes('ing-2.png')).toBe(true);
      expect(requested).not.toContain('ing-3.png');

      for (let i = 0; i < 5; i += 1) {
        await cards.nth(i).click();
        await expect(cards.nth(i)).toHaveAttribute('aria-current', 'step');
        await expect(story.locator('[aria-current="step"]')).toHaveCount(1);
        // Mọi chương hiện sẵn: chọn thẻ nào cũng không được ẩn chữ của thẻ khác.
        for (let n = 0; n < 5; n += 1) await expect(cards.nth(n)).toContainText(`Chương ${n + 1}`);
        await expect(cards.nth(i)).toContainText('100g, 250kcal, 45.000đ');
        await expect(story.getByTestId('story-layer')).toHaveCount(i + 1);

        // Lớp vừa thêm là lớp cuối (mỗi chương một lớp, vẽ tích luỹ).
        const drop = await story.getByTestId('story-layer').nth(i).evaluate((el) => {
          const s = getComputedStyle(el);
          return { name: s.animationName, duration: s.animationDuration, easing: s.animationTimingFunction };
        });
        expect(drop).toEqual({ name: 'tubu-story-drop', duration: '0.24s', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        expect(await cards.nth(i).evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');

        // Chương kế (nếu còn) đã được yêu cầu tải ngay khi chương này hiện.
        if (i < 4) await expect.poll(() => requested.includes(`ing-${i + 2}.png`)).toBe(true);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('thẻ chỉ nguyên liệu: tên và hàm lượng nằm gọn trong khung, không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      const story = await gotoStory(page);
      const hud = story.getByTestId('story-hud');
      await hud.scrollIntoViewIfNeeded();
      const callouts = story.getByTestId('story-callout');
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

    test('ảnh poster (không ảnh tách nền): điểm nhấn thành chip dưới khung ảnh, không lớp hay chú thích đè lên ảnh, không tràn ngang', async ({ page, api }) => {
      mockFlow(api, { cutout: false });
      const story = await gotoStory(page);
      const stage = story.getByTestId('story-stage');
      await expect(stage).toHaveAttribute('data-frame', 'floating-card');
      await expect(story.getByTestId('story-hud')).toHaveCount(0);
      await expect(story.getByTestId('story-callout')).toHaveCount(0);
      await expect(story.getByTestId('story-layer')).toHaveCount(0);

      const points = story.getByTestId('story-points');
      await points.scrollIntoViewIfNeeded();
      await expect(stage.getByTestId('story-point')).toHaveCount(0);
      const chips = points.getByTestId('story-point');
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toContainText('Tinh dầu bưởi');
      await expect(chips.nth(0)).toContainText('2%');
      await expect(chips.nth(1)).toContainText('Bồ kết');
      await expect(story.getByTestId('story-closing')).toContainText('An lành cho cả nhà');
      for (const c of await chips.all()) {
        const b = (await c.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      }

      // Chọn chương chỉ đổi thẻ đang chọn: khung poster không thả lớp nguyên liệu nào.
      const cards = story.getByTestId('story-step-card');
      await cards.nth(3).click();
      await expect(cards.nth(3)).toHaveAttribute('aria-current', 'step');
      await expect(story.getByTestId('story-layer')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('chọn chương rồi Thêm vào giỏ ở thanh dưới → Giỏ → Thanh toán → đặt COD thành công', async ({ page, api }) => {
      const state = mockFlow(api);
      const story = await gotoStory(page);
      const third = story.getByTestId('story-step-card').nth(2);
      await third.click();
      await expect(third).toHaveAttribute('aria-current', 'step');

      const add = page.getByTestId('sticky-bar').getByRole('button', { name: 'Thêm vào giỏ' });
      await expect(add).toBeEnabled({ timeout: 15_000 });
      const adding = api.waitForCall('POST', '/cart/items');
      await add.click();
      const call = await adding;
      expect(call.body).toMatchObject({ variationId: VARIATION_ID, quantity: 1 });
      expect(state.added()).toBe(true);

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

    test('giảm chuyển động: dải vẫn đủ năm thẻ chương, bản tĩnh vẽ đủ năm lớp ngay và không hiệu ứng rơi, vẫn không tràn ngang', async ({ page, api }) => {
      mockFlow(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const story = await gotoStory(page);

      await expect(story.getByTestId('story-step-card')).toHaveCount(5);
      const layers = story.getByTestId('story-layer');
      await expect(layers).toHaveCount(5);
      for (const l of await layers.all()) {
        expect(await l.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
