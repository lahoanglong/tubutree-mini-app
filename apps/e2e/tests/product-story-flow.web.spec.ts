import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web khách 360px và 375px (project di động): khung toàn màn của câu chuyện sản phẩm đi trọn đường mua. Mở khung từ trang sản phẩm, đi qua các chương,
 * bấm Thêm vào giỏ ở thanh đáy (khối mua mở bảng chọn phân loại vì sản phẩm có từ 2 phân loại), sang Giỏ rồi sang Thanh toán.
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

async function openStory(page: Page): Promise<Locator> {
  await page.goto(`/san-pham/${SLUG}`);
  const open = page.getByTestId('pdp-story-open').locator('visible=true');
  await expect(open).toHaveCount(1);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const vp of VIEWPORTS) {
  test.describe(`Web khách ${vp.width}px: khung toàn màn câu chuyện sản phẩm`, () => {
    test.use({ viewport: vp });

    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khung toàn màn kiểm ở khổ điện thoại, chỉ project Web Customer Mobile');
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
        }
      });
    });

    test('khung phủ đúng màn, thanh mua ghim đáy, vùng chạm từ 44px, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const dialog = await openStory(page);

      const box = (await dialog.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(vp.width);
      expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(1);

      const bar = (await dialog.locator('.tubu-story-bar').boundingBox())!;
      expect(Math.abs(bar.y + bar.height - vp.height)).toBeLessThanOrEqual(1);

      expect(await noHorizontalScroll(page)).toBe(true);

      const chips = await dialog.getByTestId('story-step-chip').all();
      expect(chips.length).toBeGreaterThanOrEqual(3);
      const targets = [dialog.getByTestId('story-close'), dialog.getByTestId('story-add-to-cart'), dialog.getByTestId('story-buy-now'), ...chips];
      for (const t of targets) {
        const b = (await t.boundingBox())!;
        expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
      }
    });

    test('qua từng chương: chip sáng đúng, chữ đổi, hiệu ứng vào theo đường cong 240ms, số đều', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const dialog = await openStory(page);

      const chips = dialog.getByTestId('story-step-chip');
      const count = await chips.count();
      expect(count).toBeGreaterThanOrEqual(3);
      const panel = dialog.getByTestId('story-step-panel');

      let previous = '';
      for (let i = 0; i < count; i += 1) {
        await chips.nth(i).click();
        await expect(chips.nth(i)).toHaveAttribute('aria-current', 'step');
        if (i > 0) await expect(panel).not.toHaveText(previous);
        previous = (await panel.textContent()) ?? '';
        expect(previous.trim().length).toBeGreaterThan(0);

        const anim = await dialog.locator('.tubu-story-panel-in').evaluate((el) => {
          const s = getComputedStyle(el);
          return { name: s.animationName, duration: s.animationDuration, easing: s.animationTimingFunction, numeric: s.fontVariantNumeric };
        });
        expect(anim.name).toBe('tubu-story-panel-in');
        expect(anim.duration).toBe('0.24s');
        expect(anim.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
        expect(anim.numeric).toContain('tabular-nums');
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('Thêm vào giỏ ở thanh đáy → bảng phân loại → Giỏ → Thanh toán', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      const state = mockShop(api, p!);
      const dialog = await openStory(page);
      await dialog.getByTestId('story-step-chip').nth(2).click();

      const adding = api.waitForCall('POST', '/cart/items');
      await dialog.getByTestId('story-add-to-cart').click();
      // Khối mua bấm lại hộ: sản phẩm có từ 2 phân loại thì điện thoại hỏi chọn trong bảng rồi mới thêm.
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
      await expect(dialog).toHaveCount(0);

      await page.goto('/gio-hang');
      await expect(page.getByText('Dầu gội bưởi Pơ Lang').first()).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      await page.getByRole('link', { name: /^Thanh toán \(/ }).locator('visible=true').click();
      await expect(page).toHaveURL(/\/thanh-toan/);
      await expect(page.getByRole('button', { name: /^Đặt hàng/ }).first()).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giảm chuyển động: không còn chip và hiệu ứng, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const dialog = await openStory(page);

      await expect(dialog.getByTestId('story-step-chip')).toHaveCount(0);
      await expect(dialog.locator('.tubu-story-panel-in')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
