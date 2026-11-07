import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { CART_AFTER_ADD } from './support/buy-flow-mocks';

/**
 * W42A, Mini App ở 320/360/375/393px: dải Story đầu Trang chủ và Reel toàn màn. API mock toàn bộ (kệ Bán chạy nhất là
 * `GET /products?sort=best_seller_30d` của catalog giả, nên dải luôn có từ 3 món). Chi tiết món là bản một phân loại còn hàng của
 * `mockDiscovery`, nên "Thêm vào giỏ" thêm thẳng, không mở bảng chọn phân loại. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const rings = (page: Page) => page.getByTestId('story-reel-item');
const reel = (page: Page) => page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
const blocks = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.homeBlock!),
  );

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('story-reel-strip')).toBeVisible({ timeout: 20_000 });
  await expect(rings(page).first()).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: dải Story và Reel Trang chủ`, () => {
    test.use({ viewport: vp });

    test('dải đứng ngay dưới lối tắt, trên khu vực hàng, cao đúng 144px, mọi vòng từ 44px, không tràn ngang', async ({ page, api }) => {
      mockDiscovery(api);
      await openHome(page);

      const strip = page.getByTestId('story-reel-strip');
      const box = (await strip.boundingBox())!;
      expect(Math.abs(box.height - 144), 'dải giữ chỗ 144 như khung chờ chung').toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);

      const count = await rings(page).count();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(8);
      for (let i = 0; i < count; i += 1) {
        await rings(page).nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(rings(page).nth(i));
      }
      await expect(page.getByRole('heading', { level: 2, name: 'Câu chuyện sản phẩm' })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      const order = await blocks(page);
      expect(order).toEqual(expect.arrayContaining(['shortcuts', 'stories', 'categories']));
      expect(order.indexOf('stories')).toBeGreaterThan(order.indexOf('shortcuts'));
      expect(order.indexOf('stories')).toBeLessThan(order.indexOf('categories'));
    });

    test('chạm vòng mở Reel toàn màn, đóng lại thì vòng đổi xám; phím Esc cũng đóng', async ({ page, api }) => {
      mockDiscovery(api);
      await openHome(page);

      const first = rings(page).first();
      await expect(first).toHaveAttribute('data-seen', 'false');
      await first.click();
      const dialog = reel(page);
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
      await expect(first).toHaveAccessibleName(/^Xem lại câu chuyện /);
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'false');

      await rings(page).nth(1).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'true');
    });

    test('Reel: "Thêm vào giỏ · giá" và "Câu chuyện kế" nằm gọn trong thanh đáy, từ 44px, không có Mua ngay; kế sang món sau', async ({ page, api }) => {
      mockDiscovery(api);
      await openHome(page);

      await rings(page).first().click();
      const dialog = reel(page);
      const add = dialog.getByTestId('story-add-to-cart');
      const next = dialog.getByTestId('story-next');
      await expect(add).toBeVisible();
      await expect(add).toHaveText(/^Thêm vào giỏ · [\d.]+đ$/);
      await expect(next).toHaveAccessibleName('Xem câu chuyện của sản phẩm kế tiếp');
      await expect(dialog.getByTestId('story-buy-now')).toHaveCount(0);
      await expectTouchTarget44(add);
      await expectTouchTarget44(next);

      const bar = (await dialog.locator('.tubu-story-bar').boundingBox())!;
      expect(Math.abs(bar.y + bar.height - vp.height)).toBeLessThanOrEqual(1);
      expect(bar.x).toBe(0);
      expect(bar.width).toBe(vp.width);
      const [a, n] = [(await add.boundingBox())!, (await next.boundingBox())!];
      expect(n.x, 'nút kế nằm trong thanh').toBeGreaterThanOrEqual(0);
      expect(n.x + n.width, 'nút kế không đè nút thêm').toBeLessThanOrEqual(a.x + 1);
      expect(a.x + a.width, 'nút thêm không tràn thanh').toBeLessThanOrEqual(vp.width);
      // Máy hẹp chỉ còn mũi tên; từ 360px có nhãn "Câu chuyện kế". Tên truy cập giữ nguyên ở cả hai.
      if (vp.width >= 360) await expect(next).toContainText('Câu chuyện kế');
      else await expect(next.getByText('Câu chuyện kế')).toBeHidden();
      expect(await add.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

      await next.click();
      await expect(dialog.getByTestId('story-position')).toHaveText(/^2\//);
      await expect(add).toHaveText(/^Thêm vào giỏ · [\d.]+đ$/);
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(rings(page).nth(1)).toHaveAttribute('data-seen', 'true');
    });

    test('Reel: Thêm vào giỏ thêm đúng một sản phẩm đúng giá hiện trên nút, đóng Reel rồi báo đã thêm', async ({ page, api }) => {
      mockDiscovery(api);
      api.post('/cart/items', CART_AFTER_ADD);
      await openHome(page);

      const slug = (await rings(page).first().getAttribute('data-slug'))!;
      const card = CATALOG.find((c) => c.slug === slug)!;
      await rings(page).first().click();
      const dialog = reel(page);
      await expect(dialog.getByTestId('story-add-to-cart')).toHaveText(`Thêm vào giỏ · ${vnd(card.salePrice ?? card.basePrice)}`);

      const adding = api.waitForCall('POST', '/cart/items');
      await dialog.getByTestId('story-add-to-cart').click();
      const call = await adding;
      expect(call.body).toMatchObject({ variationId: `var-${card.id}`, quantity: 1 });
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(/Đã thêm vào giỏ/).first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('món hết hàng: Reel khoá nút thêm, ghi "Hết hàng", không gọi thêm giỏ', async ({ page, api }) => {
      mockDiscovery(api);
      api.get('/products/:slug', ({ params }) => {
        const c = CATALOG.find((x) => x.slug === params.slug)!;
        return {
          id: c.id, slug: c.slug, brand: c.brand, name: c.name, shortDesc: null, description: '', images: [], thumbnail: c.thumbnail, basePrice: c.basePrice,
          salePrice: c.salePrice, certifications: [], variations: [{ id: `var-${c.id}`, sku: c.id, name: 'Mặc định', attributes: {}, retailPrice: c.basePrice, salePrice: c.salePrice, stock: 0 }],
        };
      });
      await openHome(page);

      await rings(page).first().click();
      const add = reel(page).getByTestId('story-add-to-cart');
      await expect(add).toBeDisabled();
      await expect(add).toHaveText('Hết hàng');
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
    });
  });
}
