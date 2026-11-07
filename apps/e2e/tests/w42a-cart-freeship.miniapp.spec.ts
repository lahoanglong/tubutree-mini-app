import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockPilotCart, PILOT_CART } from './support/pilot-mocks';
import { THUMB } from './support/buy-flow-mocks';

/**
 * W42A, Mini App ở 320/360/375/393px: thanh Miễn phí giao hàng và dải món bù đơn ở ĐẦU Giỏ. API mock toàn bộ (giỏ có trạng thái: "+ Thêm" đẩy một dòng
 * vào giỏ và lần đọc sau trả giỏ mới). Giỏ có một dòng 80.000đ, ngưỡng 200.000đ, còn thiếu 120.000đ; kệ Bán chạy nhất gồm sáu món để dải luôn đủ 3 món
 * sau mỗi lần thêm. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const THRESHOLD = 200_000;
// Còn thiếu 120.000: "Khoai" (130.000) đóng được khoảng thiếu nên đứng đầu; thêm "Bơ" (40.000) thì còn thiếu 80.000 và "Mận" (95.000) thành món đóng.
const BEST = [
  { slug: 'bo', name: 'Bơ', price: 40_000 },
  { slug: 'khoai', name: 'Khoai', price: 130_000 },
  { slug: 'dau', name: 'Dâu', price: 60_000 },
  { slug: 'man', name: 'Mận', price: 95_000 },
  { slug: 'oi', name: 'Ổi', price: 30_000 },
  { slug: 'sau-rieng', name: 'Sầu riêng', price: 400_000 },
] as const;

interface Line {
  id: string;
  variationId: string;
  productName: string;
  slug: string;
  unitPrice: number;
}

function mockCart(api: MockApi, best: readonly { slug: string; name: string; price: number }[] = BEST): void {
  const lines: Line[] = [{ id: 'l0', variationId: 'v-ban-dau', productName: 'Serum dưỡng ẩm', slug: 'serum', unitPrice: 80_000 }];
  const cart = () => {
    const subtotal = lines.reduce((s, l) => s + l.unitPrice, 0);
    return {
      ...PILOT_CART,
      items: lines.map((l) => ({
        ...PILOT_CART.items[0]!,
        id: l.id,
        variationId: l.variationId,
        slug: l.slug,
        productName: l.productName,
        variationName: 'Mặc định',
        thumbnail: null,
        unitPrice: l.unitPrice,
        quantity: 1,
        stock: 9,
        total: l.unitPrice,
      })),
      subtotal,
      freeship: subtotal >= THRESHOLD,
      freeshipThreshold: THRESHOLD,
      itemCount: lines.length,
    };
  };
  mockPilotCart(api);
  api.get('/cart', cart);
  api.post('/cart/items', ({ call }) => {
    const body = call.body as { variationId: string };
    const item = best.find((b) => `v-${b.slug}` === body.variationId)!;
    lines.push({ id: `l-${item.slug}`, variationId: body.variationId, productName: item.name, slug: item.slug, unitPrice: item.price });
    return cart();
  });
  api.get('/products', {
    data: best.map((b) => ({
      id: b.slug, slug: b.slug, brand: 'Tubu', name: b.name, thumbnail: THUMB, basePrice: b.price, salePrice: null, isFeatured: false, inStock: true,
      repVariationId: `v-${b.slug}`,
    })),
    meta: { page: 1, limit: 24, total: best.length },
  });
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const progress = (page: Page) => page.getByTestId('freeship-progress');
const addButton = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^Thêm ${name} vào giỏ`) });

async function openCart(page: Page): Promise<void> {
  await page.goto('/cart');
  await expect(progress(page)).toBeVisible({ timeout: 20_000 });
}

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: Giỏ, Miễn phí giao hàng`, () => {
    test.use({ viewport: vp });

    test('thanh và dải ở ĐẦU giỏ (trên "Chọn tất cả"), chân dính không còn dòng Miễn phí giao hàng, nút "+ Thêm" từ 44px, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);

      await expect(progress(page)).toContainText('Mua thêm 120.000đ để được Miễn phí giao hàng');
      await expect(progress(page)).toHaveAttribute('data-reached', 'false');
      const bar = page.getByRole('progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '40');
      await expect(bar).toHaveAttribute('aria-label', 'Đã đạt 40% để được Miễn phí giao hàng');

      const top = (await progress(page).boundingBox())!;
      const selectAll = (await page.getByText('Chọn tất cả', { exact: true }).first().boundingBox())!;
      const line = (await page.getByText('Serum dưỡng ẩm').first().boundingBox())!;
      expect(top.y).toBeLessThan(selectAll.y);
      expect(selectAll.y).toBeLessThan(line.y);
      expect(top.x).toBeGreaterThanOrEqual(0);
      expect(top.x + top.width).toBeLessThanOrEqual(vp.width);

      const sticky = page.getByTestId('sticky-bar');
      await expect(sticky).toBeVisible();
      await expect(sticky.getByText(/Miễn phí giao hàng/)).toHaveCount(0);

      const rail = page.getByTestId('freeship-addons');
      await expect(rail).toBeVisible();
      const cards = page.getByTestId('freeship-addon');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
      await expect(cards.first()).toHaveAttribute('data-slug', 'khoai');
      await expect(cards.filter({ hasText: 'Sầu riêng' })).toHaveCount(0);
      const buttons = page.getByTestId('freeship-add');
      for (let i = 0; i < count; i += 1) {
        await buttons.nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(buttons.nth(i));
      }
      await expect(page.getByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      // Ánh sáng chạy trên phần đã đầy khi chuyển động được bật.
      const shimmer = await page.getByTestId('freeship-fill').evaluate((el) => getComputedStyle(el, '::after').animationName);
      expect(shimmer).toBe('tubu-freeship-shimmer');
    });

    test('"+ Thêm" một chạm: thêm đúng một sản phẩm, thanh chạy lên mức mới, món vừa thêm rời khỏi dải, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);

      await addButton(page, 'Bơ').scrollIntoViewIfNeeded();
      const adding = api.waitForCall('POST', '/cart/items');
      await addButton(page, 'Bơ').click();
      const call = await adding;
      expect(call.body).toMatchObject({ variationId: 'v-bo', quantity: 1 });

      await expect(progress(page)).toContainText('Mua thêm 80.000đ để được Miễn phí giao hàng');
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
      await expect(page.getByTestId('freeship-fill')).toHaveAttribute('style', /width:\s*60%/);
      await expect(page.getByText('Bơ', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Thêm Bơ vào giỏ/ })).toHaveCount(0);
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);

      // Còn thiếu 80.000: "Mận" (95.000) thành món đóng, "Khoai" (130.000) quá đắt nên rời dải.
      const slugs = await page.getByTestId('freeship-addon').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')));
      expect(slugs[0]).toBe('man');
      expect(slugs).not.toContain('khoai');
      expect(slugs.length).toBeGreaterThanOrEqual(3);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('thêm đủ để đạt ngưỡng: dòng chúc mừng, thanh và dải biến mất, khối không co lại dưới 56px, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      const before = (await progress(page).boundingBox())!.height;
      expect(before).toBeGreaterThanOrEqual(56);

      await addButton(page, 'Bơ').click();
      await expect(progress(page)).toContainText('Mua thêm 80.000đ');
      await addButton(page, 'Mận').click();

      await expect(progress(page)).toHaveAttribute('data-reached', 'true');
      await expect(progress(page)).toContainText('🎉 Đơn hàng đã được Miễn phí giao hàng');
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await expect(page.getByTestId('freeship-addons')).toHaveCount(0);
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(2);

      const after = (await progress(page).boundingBox())!;
      expect(after.height, 'khối giữ chiều cao tối thiểu khi thanh biến mất').toBeGreaterThanOrEqual(56 - 1);
      expect(after.x + after.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('Bán chạy nhất chỉ có hai món: thanh vẫn hiện, dải ẩn hẳn (không để tiêu đề trơ)', async ({ page, api }) => {
      mockCart(api, BEST.slice(0, 2));
      await openCart(page);
      await expect(progress(page)).toContainText('Mua thêm 120.000đ');
      await expect(page.getByTestId('freeship-addons')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giảm chuyển động: phần đầy không chạy ánh sáng và không đổi bề rộng bằng transition, vẫn không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openCart(page);
      const fill = page.getByTestId('freeship-fill');
      const style = await fill.evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        return { animation: after.animationName, display: after.display, transition: getComputedStyle(el).transitionProperty };
      });
      expect(style.animation).toBe('none');
      expect(style.display).toBe('none');
      expect(style.transition).toBe('none');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
