import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { HOME_ME, HOME_PUBLIC } from './support/home-merged';

/**
 * W42A, web khách (project di động) ở 320/360/375/393px: dải Story đầu Trang chủ và Reel toàn màn.
 * Phần server của Next gọi API thật nên dải lấy từ kệ Bán chạy nhất của seed (cần từ 3 món còn hàng, không thì bỏ qua); mọi lời gọi từ trình duyệt đi qua mock.
 * Chi tiết sản phẩm do mock dựng từ thẻ (một phân loại còn hàng) để nút "Thêm vào giỏ" thêm thẳng, không mở bảng chọn phân loại.
 * Host phải là localhost (baseURL): middleware coi nhãn đầu của Host là subdomain gian hàng. Không đặt đơn thật.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

interface SeedCard {
  slug: string;
  name: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  inStock: boolean;
  repVariationId?: string;
}

async function seededBestSellers(request: APIRequestContext): Promise<SeedCard[] | null> {
  for (const sort of ['best_seller_30d', 'best_seller']) {
    const r = await request.get(`${API_ORIGIN}/api/products?sort=${sort}&limit=10`).catch(() => null);
    if (!r?.ok()) continue;
    const page = (await r.json()) as { data?: SeedCard[] };
    const cards = (page.data ?? []).filter((c) => c.inStock !== false && c.slug && c.name?.trim());
    return cards.length >= 3 ? cards : null;
  }
  return null;
}

const USER = {
  id: 'u-w42a', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const priceOf = (c: SeedCard) => c.salePrice ?? c.basePrice;

function mockHome(api: MockApi, cards: SeedCard[]): { added: () => { variationId: string; quantity: number }[] } {
  const added: { variationId: string; quantity: number }[] = [];
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me/notifications/unread-count', { count: 0 });
  api.get('/me/subscriptions', []);
  api.get('/me/wishlist/ids', []);
  const empty = { items: [] as unknown[], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 };
  api.get('/cart', () => empty);
  api.post('/cart/items', ({ call }) => {
    const body = call.body as { variationId: string; quantity: number };
    added.push(body);
    const card = cards.find((c) => `v-${c.slug}` === body.variationId) ?? cards[0]!;
    const line = {
      id: 'w42a-line', variationId: body.variationId, productName: card.name, variationName: 'Mặc định', slug: card.slug, thumbnail: null,
      unitPrice: priceOf(card), quantity: body.quantity, stock: 9, total: priceOf(card) * body.quantity, fulfiller: TUBU,
    };
    return { ...empty, items: [line], subtotal: line.total, itemCount: 1 };
  });
  // Cùng nguồn với dải: món có thể không nằm trong bản seed nếu máy chủ trả khác lúc dựng trang, nên chi tiết dựng được cho mọi slug.
  api.get('/products/:slug', ({ params }) => {
    const slug = params.slug!;
    const c = bySlug.get(slug);
    const price = c ? priceOf(c) : 100000;
    return {
      id: slug, slug, brand: 'Tubu', name: c?.name ?? slug, shortDesc: null, description: 'Mô tả ngắn.', images: [], thumbnail: null,
      basePrice: c?.basePrice ?? price, salePrice: c?.salePrice ?? null, certifications: [], ingredients: null, storyConfig: null,
      variations: [{ id: `v-${slug}`, sku: slug, name: 'Mặc định', attributes: {}, retailPrice: c?.basePrice ?? price, salePrice: c?.salePrice ?? null, stock: 9 }],
    };
  });
  const page = (data: unknown[]) => ({ data, meta: { page: 1, limit: data.length, total: data.length } });
  api.get('/home', { ...HOME_PUBLIC, bestSellers: page(cards), featured: page(cards), newest: page(cards) });
  api.get('/home/me', HOME_ME);
  return { added: () => added };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const rings = (page: Page) => page.getByTestId('story-reel-item');

async function openHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('story-reel-strip')).toBeVisible({ timeout: 20_000 });
}

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

for (const vp of VIEWPORTS) {
  test.describe(`Web khách ${vp.width}px: dải Story và Reel Trang chủ`, () => {
    test.use({ viewport: vp });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Dải Story kiểm ở khổ điện thoại, chỉ project Web Customer Mobile');
    });

    test('dải đứng giữa lối tắt và Giờ vàng, mọi vòng từ 44px, không tràn ngang', async ({ page, api, request }) => {
      const cards = await seededBestSellers(request);
      test.skip(!cards, 'DB e2e chưa có từ 3 món Bán chạy nhất còn hàng');
      mockHome(api, cards!);
      await openHome(page);

      const strip = page.getByTestId('story-reel-strip');
      const box = (await strip.boundingBox())!;
      expect(box.height, 'dải giữ chỗ 144 như khung chờ chung').toBeGreaterThanOrEqual(144);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);

      const count = await rings(page).count();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(8);
      for (let i = 0; i < count; i += 1) await expectTouchTarget44(rings(page).nth(i));
      expect(await noHorizontalScroll(page)).toBe(true);

      const order = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock));
      expect(order.indexOf('stories')).toBeGreaterThan(order.indexOf('shortcuts'));
      expect(order.indexOf('stories')).toBeLessThan(order.indexOf('flash'));
    });

    test('chạm vòng mở Reel toàn màn, đóng lại thì vòng đổi xám; phím Esc cũng đóng', async ({ page, api, request }) => {
      const cards = await seededBestSellers(request);
      test.skip(!cards, 'DB e2e chưa có từ 3 món Bán chạy nhất còn hàng');
      mockHome(api, cards!);
      await openHome(page);

      const first = rings(page).first();
      await expect(first).toHaveAttribute('data-seen', 'false');
      await first.click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('story-position')).toHaveText(new RegExp(`^1/${await rings(page).count()}$`));

      const box = (await dialog.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(vp.width);
      expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(1);
      expect(await noHorizontalScroll(page)).toBe(true);
      await expectTouchTarget44(dialog.getByTestId('story-close'));

      await dialog.getByTestId('story-close').click();
      await expect(dialog).toHaveCount(0);
      await expect(first).toHaveAttribute('data-seen', 'true');
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'false');

      await rings(page).nth(1).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'true');
    });

    test('Reel: nút "Thêm vào giỏ · giá" và "Câu chuyện kế" từ 44px, không có Mua ngay; kế sang món sau', async ({ page, api, request }) => {
      const cards = await seededBestSellers(request);
      test.skip(!cards, 'DB e2e chưa có từ 3 món Bán chạy nhất còn hàng');
      mockHome(api, cards!);
      await openHome(page);

      await rings(page).first().click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      await expect(dialog.getByTestId('story-add-to-cart')).toBeVisible();
      await expect(dialog.getByTestId('story-add-to-cart')).toHaveText(/^Thêm vào giỏ · [\d.]+đ$/);
      await expect(dialog.getByRole('button', { name: 'Xem câu chuyện của sản phẩm kế tiếp' })).toHaveText('Câu chuyện kế');
      await expect(dialog.getByTestId('story-buy-now')).toHaveCount(0);
      await expectTouchTarget44(dialog.getByTestId('story-add-to-cart'));
      await expectTouchTarget44(dialog.getByTestId('story-next'));

      const bar = (await dialog.locator('.tubu-story-bar').boundingBox())!;
      expect(Math.abs(bar.y + bar.height - vp.height)).toBeLessThanOrEqual(1);
      expect(bar.x + bar.width).toBeLessThanOrEqual(vp.width);

      await dialog.getByTestId('story-next').click();
      await expect(dialog.getByTestId('story-position')).toHaveText(/^2\//);
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'true');
    });

    test('Reel: Thêm vào giỏ thêm đúng một sản phẩm đúng giá hiện trên nút, đóng Reel rồi báo đã thêm', async ({ page, api, request }) => {
      const cards = await seededBestSellers(request);
      test.skip(!cards, 'DB e2e chưa có từ 3 món Bán chạy nhất còn hàng');
      const shop = mockHome(api, cards!);
      await openHome(page);

      const slug = (await rings(page).first().getAttribute('data-slug'))!;
      const card = cards!.find((c) => c.slug === slug);
      await rings(page).first().click();
      const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
      if (card) await expect(dialog.getByTestId('story-add-to-cart')).toHaveText(`Thêm vào giỏ · ${vnd(priceOf(card))}`);

      const adding = api.waitForCall('POST', '/cart/items');
      await dialog.getByTestId('story-add-to-cart').click();
      const call = await adding;
      expect(call.body).toMatchObject({ variationId: `v-${slug}`, quantity: 1 });
      expect(shop.added()).toHaveLength(1);
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Đã thêm vào giỏ!')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
