import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web khách 360px và 375px (project di động): dải câu chuyện sản phẩm nội tuyến (W133) đi trọn đường mua. Đọc các chương ngay trên trang, chọn phân loại ở vòng cung
 * (khối mua theo), bấm Thêm vào giỏ ở thanh đáy của trang (khối mua mở bảng chọn phân loại vì sản phẩm có từ 2 phân loại), sang Giỏ rồi sang Thanh toán.
 * Trang sản phẩm không còn khung toàn màn và nút mua riêng của câu chuyện; khung toàn màn chỉ còn cho Reel Trang chủ (spec ở w42a-home-story-reel.web.spec.ts).
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

/** Vào trang sản phẩm và trả về dải câu chuyện đang hiện (hai bản, điện thoại và máy tính, mỗi lúc một bản hiện). */
async function openPdpStory(page: Page): Promise<Locator> {
  await page.goto(`/san-pham/${SLUG}`);
  const story = page.locator('[data-section="pdp-story"]').locator('visible=true');
  await expect(story).toHaveCount(1);
  await story.scrollIntoViewIfNeeded();
  await expect(story.getByTestId('product-story')).toBeVisible();
  return story;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Đo sân khấu và thẻ chương đầu trong một lần evaluate để cùng một lần cuộn, không lệch vì ảnh nạp muộn giữa hai lần đo. */
async function stageAndFirstCard(story: Locator): Promise<{ stage: Box; card: Box }> {
  return story.evaluate((el) => {
    const box = (selector: string): Box => {
      const r = el.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { stage: box('[data-testid="story-stage"]'), card: box('[data-testid="story-step-card"]') };
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`Web khách ${vp.width}px: dải câu chuyện sản phẩm nội tuyến`, () => {
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

    test('dải vừa bề rộng màn, ảnh trên các chương dưới, thẻ chương từ 44px, thanh mua của trang vẫn bấm được, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const story = await openPdpStory(page);

      const box = (await story.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);

      const g = await stageAndFirstCard(story);
      expect(g.stage.y + g.stage.h, 'một cột: ảnh nằm trên thẻ chương đầu').toBeLessThanOrEqual(g.card.y + 1);

      const cards = await story.getByTestId('story-step-card').all();
      expect(cards.length).toBeGreaterThanOrEqual(3);
      for (const card of cards) {
        const b = (await card.boundingBox())!;
        expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
        expect(b.x + b.width, 'thẻ không tràn ra ngoài màn').toBeLessThanOrEqual(vp.width);
      }

      // Khung toàn màn và thanh mua riêng của câu chuyện đã bỏ: nút mua nằm ở thanh đáy của trang và không bị dải che.
      await expect(page.getByTestId('pdp-story-open')).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
      const add = page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');
      await expect(add).toBeVisible();
      const ab = (await add.boundingBox())!;
      expect(ab.height, 'chiều cao nút Thêm vào giỏ ở thanh đáy').toBeGreaterThanOrEqual(44);
      expect(ab.y + ab.height).toBeLessThanOrEqual(vp.height + 1);
    });

    test('qua từng chương: thẻ sáng đúng, mọi chữ vẫn hiện, thẻ đổi nền theo đường cong 240ms, số đều', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      const story = await openPdpStory(page);
      await expect(story.getByTestId('product-story')).toHaveAttribute('data-animated', 'true');

      const cards = story.getByTestId('story-step-card');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
      await expect(cards.first()).toHaveAttribute('aria-current', 'step');

      for (let i = 0; i < count; i += 1) {
        await cards.nth(i).click();
        await expect(cards.nth(i)).toHaveAttribute('aria-current', 'step');
        await expect(story.locator('[data-testid="story-step-card"][aria-current="step"]')).toHaveCount(1);
        expect(((await cards.nth(i).textContent()) ?? '').trim().length).toBeGreaterThan(0);
        // Chương chưa chọn vẫn đọc được: chữ không ẩn sau thẻ khác.
        await expect(story.locator('.tubu-story-step-body')).toHaveCount(count);
        for (const body of await story.locator('.tubu-story-step-body').all()) await expect(body).toBeVisible();

        const style = await cards.nth(i).evaluate((el) => {
          const s = getComputedStyle(el);
          return { duration: s.transitionDuration.split(',')[0]!.trim(), easing: s.transitionTimingFunction, numeric: getComputedStyle(el.querySelector('.tubu-story-num')!).fontVariantNumeric };
        });
        expect(style.duration).toBe('0.24s');
        expect(style.easing).toContain('cubic-bezier(0.22, 1, 0.36, 1)');
        expect(style.numeric).toContain('tabular-nums');
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('chọn phân loại ở vòng cung → chip và bảng chọn của khối mua theo → Thêm vào giỏ ở thanh đáy → Giỏ → Thanh toán', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      test.skip(p!.variations.length < 2, 'Sản phẩm mẫu cần từ 2 phân loại để có vòng cung và bảng chọn phân loại');
      const state = mockShop(api, p!);
      const story = await openPdpStory(page);
      await story.getByTestId('story-step-card').nth(2).click();

      // Chọn một phân loại còn hàng khác với phân loại đang chọn sẵn.
      const arc = story.getByTestId('story-arc-item');
      await expect(arc).toHaveCount(p!.variations.length);
      const checked = await arc.evaluateAll((els) => els.map((el) => el.getAttribute('aria-checked') === 'true'));
      const target = p!.variations.findIndex((v, i) => v.stock > 0 && !checked[i]);
      expect(target, 'có phân loại còn hàng khác phân loại đang chọn').toBeGreaterThanOrEqual(0);
      await arc.nth(target).click();
      await expect(arc.nth(target)).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-section="pdp-variation-chips"] button').nth(target)).toHaveAttribute('aria-pressed', 'true');

      const adding = api.waitForCall('POST', '/cart/items');
      await page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart').click();
      // Điện thoại có từ 2 phân loại thì hỏi chọn trong bảng; bảng mở sẵn ở phân loại vừa chọn ở vòng cung, không cần chọn lại.
      const sheet = page.getByRole('dialog', { name: 'Chọn phân loại' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('group', { name: 'Phân loại' }).getByRole('button').nth(target)).toHaveAttribute('aria-pressed', 'true');
      await sheet.getByRole('button', { name: /^Thêm vào giỏ/ }).click();
      const call = await adding;
      const body = call.body as { variationId: string; quantity: number };
      expect(body.variationId).toBe(p!.variations[target]!.id);
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

    test('giảm chuyển động: bản tĩnh vẫn đủ các thẻ chương, thẻ không còn chuyển đổi, không tràn ngang', async ({ page, api, request }) => {
      const p = await seeded(request);
      test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
      mockShop(api, p!);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const story = await openPdpStory(page);

      // Thiết lập giảm chuyển động chỉ biết ở trình duyệt nên dải đổi sang bản tĩnh sau lần hydrate đầu.
      await expect(story.getByTestId('product-story')).toHaveAttribute('data-animated', 'false');
      const cards = story.getByTestId('story-step-card');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      await expect(cards.first()).toHaveAttribute('aria-current', 'step');
      expect(await cards.first().evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
