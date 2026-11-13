import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web khách 360px và 375px (project di động): dải câu chuyện sản phẩm nằm ngay trên trang chi tiết và đường mua đi qua nó. Đọc các chương bằng thẻ,
 * bấm Thêm vào giỏ ở thanh dính đáy (mở bảng chọn phân loại vì sản phẩm có từ 2 phân loại), sang Giỏ rồi sang Thanh toán.
 * Phần server của Next gọi API thật nên spec dùng sản phẩm mẫu của seed (dầu gội Pơ Lang, có kịch bản mẫu); mọi lời gọi từ trình duyệt đi qua mock.
 * Host phải là localhost (baseURL): middleware coi nhãn đầu của Host là subdomain gian hàng. Không đặt đơn thật.
 */
const SLUG = 'dau-goi-buoi-po-lang';
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 375, height: 812 },
] as const;

interface SeedVariation {
  id: string;
  name: string;
  stock: number;
  retailPrice: number;
  salePrice: number | null;
}
interface SeedProduct {
  variations: SeedVariation[];
}

async function seeded(request: APIRequestContext): Promise<SeedProduct | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${SLUG}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as SeedProduct) : null;
}

const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};
const ADDR = {
  id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình',
  street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};

/** Giỏ trả về ở các lời gọi /cart: rỗng cho tới khi POST /cart/items chạy, rồi có một dòng của phân loại vừa thêm. */
function cartOf(lines: unknown[], subtotal: number) {
  return { items: lines, couponCode: null, subtotal, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: lines.length };
}

function mockShop(api: MockApi, p: SeedProduct): { added: () => boolean } {
  let added = false;
  const lineOf = (v: SeedVariation, quantity: number) => {
    const unitPrice = v.salePrice ?? v.retailPrice;
    return {
      id: 'story-line-1', variationId: v.id, productName: 'Dầu gội bưởi Pơ Lang', variationName: v.name, slug: SLUG, thumbnail: null,
      unitPrice, quantity, stock: v.stock, total: unitPrice * quantity, fulfiller: TUBU,
    };
  };
  let line: ReturnType<typeof lineOf> | null = null;

  // Trang sản phẩm
  api.get('/flash-sales/active', []);
  api.get(`/products/${SLUG}`, { variations: p.variations });
  api.get(`/products/${SLUG}/related`, []);
  api.get(`/products/${SLUG}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${SLUG}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get(`/products/${SLUG}/reviews/can-review`, { canReview: false });
  api.get('/me/wishlist/ids', []);
  api.get('/affiliate/me', { isAffiliate: false });
  api.get('/config/public', { freeshipThreshold: 500000, subscribeDiscountPct: 0.12 });

  // Phiên đã đăng nhập: không có phiên thì "Thêm vào giỏ" chuyển sang trang đăng nhập thay vì gọi giỏ.
  api.post('/auth/refresh', { accessToken: 'e2e-token', user: USER });
  api.get('/me', USER);
  api.get('/auth/me', { ...USER, ownsBrand: false });
  api.get('/me/addresses', [ADDR]);
  api.get('/me/coupons', []);
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/me/notifications', []);
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });

  // Giỏ và thanh toán
  api.get('/cart', () => (line ? cartOf([line], line.total) : cartOf([], 0)));
  api.post('/cart/items', ({ call }) => {
    const body = call.body as { variationId: string; quantity: number };
    const v = p.variations.find((x) => x.id === body.variationId) ?? p.variations[0]!;
    line = lineOf(v, body.quantity);
    added = true;
    return cartOf([line], line.total);
  });
  api.post('/checkout/quote', () => {
    const subtotal = line?.total ?? 0;
    return {
      subtotal, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: subtotal + 30000,
      pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
    };
  });
  api.post('/checkout/coupon-previews', { previews: [] });
  return { added: () => added };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Trang dựng hai bản dải câu chuyện (điện thoại và màn rộng), mỗi lúc chỉ một bản hiện: lấy bản đang thấy. */
async function gotoStory(page: Page): Promise<Locator> {
  await page.goto(`/san-pham/${SLUG}`);
  const story = page.locator('[data-section="pdp-story"]').locator('visible=true');
  await expect(story).toHaveCount(1);
  await story.scrollIntoViewIfNeeded();
  return story;
}

for (const vp of VIEWPORTS) {
  test.describe(`Web khách ${vp.width}px: dải câu chuyện sản phẩm trên trang chi tiết`, () => {
    // Khung toàn màn (focus trap, Esc, hai nút mua khoá khi hết hàng) nay chỉ còn ở Reel Trang chủ, do w42a-home-story-reel.*.spec.ts phủ.
    test.use({ viewport: vp });

    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Dải câu chuyện kiểm ở khổ điện thoại, chỉ project Web Customer Mobile');
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
        }
      });
    });

    test('mọi chương hiện cùng lúc ngay trong trang, thẻ chương từ 44px và nằm gọn trong màn, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const story = await gotoStory(page);

      const cards = await story.getByTestId('story-step-card').all();
      expect(cards.length).toBeGreaterThanOrEqual(3);
      for (const c of cards) {
        await expect(c).toBeVisible();
        const b = (await c.boundingBox())!;
        expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.x, 'thẻ lệch ra ngoài mép trái').toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, 'thẻ tràn mép phải').toBeLessThanOrEqual(vp.width);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('bấm từng thẻ chương: thẻ sáng đúng, chữ các chương giữ nguyên, chuyển thẻ theo đường cong 240ms, số đều', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const story = await gotoStory(page);

      const cards = story.getByTestId('story-step-card');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
      // Mọi chương đã hiện sẵn: chọn thẻ nào cũng không được ẩn hay đổi chữ của thẻ khác.
      const texts = await cards.allTextContents();
      for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        // Thẻ nằm trong HTML máy chủ nên bấm được trước khi React hydrate nhưng chưa ăn: bấm lại tới khi thẻ sáng.
        await expect(async () => {
          await cards.nth(i).click();
          await expect(cards.nth(i)).toHaveAttribute('aria-current', 'step', { timeout: 1_000 });
        }).toPass({ timeout: 15_000 });
        await expect(story.locator('[aria-current="step"]')).toHaveCount(1);
        expect(await cards.allTextContents()).toEqual(texts);

        const style = await cards.nth(i).evaluate((el) => {
          const s = getComputedStyle(el);
          return { duration: s.transitionDuration, easing: s.transitionTimingFunction, numeric: s.fontVariantNumeric };
        });
        expect(style.duration).toContain('0.24s');
        expect(style.easing).toContain('cubic-bezier(0.22, 1, 0.36, 1)');
        expect(style.numeric).toContain('tabular-nums');
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('chọn chương rồi Thêm vào giỏ ở thanh dính → bảng phân loại → Giỏ → Thanh toán', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      const state = mockShop(api, p!);
      const story = await gotoStory(page);
      // Khổ điện thoại có hai nút "Thêm vào giỏ" cùng data-testid (thân trang ẩn dưới md, thanh dính): lấy bản ở thanh dính. Nút bật là lúc trang đã hydrate.
      const add = page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');
      await expect(add).toBeEnabled({ timeout: 30_000 });
      const third = story.getByTestId('story-step-card').nth(2);
      await third.click();
      await expect(third).toHaveAttribute('aria-current', 'step');

      const adding = api.waitForCall('POST', '/cart/items');
      await add.click();
      // Sản phẩm có từ 2 phân loại thì điện thoại hỏi chọn trong bảng rồi mới thêm.
      if (p!.variations.length >= 2) {
        const sheet = page.getByRole('dialog', { name: 'Chọn phân loại' });
        await expect(sheet).toBeVisible();
        const inStock = p!.variations.findIndex((v) => v.stock > 0);
        expect(inStock).toBeGreaterThanOrEqual(0);
        await sheet.getByRole('group', { name: 'Phân loại' }).getByRole('button').nth(inStock).click();
        await sheet.getByRole('button', { name: /^Thêm vào giỏ/ }).click();
      }
      const call = await adding;
      const body = call.body as { variationId: string; quantity: number };
      expect(p!.variations.map((v) => v.id)).toContain(body.variationId);
      expect(body.quantity).toBeGreaterThanOrEqual(1);
      expect(state.added()).toBe(true);

      await page.goto('/gio-hang');
      await expect(page.getByText('Dầu gội bưởi Pơ Lang').first()).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      await page.getByRole('link', { name: /^Thanh toán \(/ }).locator('visible=true').click();
      await expect(page).toHaveURL(/\/thanh-toan/);
      await expect(page.getByRole('button', { name: /^Đặt hàng/ }).first()).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giảm chuyển động: dải vẫn đủ thẻ chương, chuyển sang bản tĩnh, thẻ không còn chuyển màu, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const story = await gotoStory(page);

      // Thiết lập giảm chuyển động chỉ biết ở trình duyệt nên cờ bản tĩnh bật sau hydrate.
      await expect(story.getByTestId('product-story')).toHaveAttribute('data-animated', 'false');
      const cards = story.getByTestId('story-step-card');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      expect(await cards.first().evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
