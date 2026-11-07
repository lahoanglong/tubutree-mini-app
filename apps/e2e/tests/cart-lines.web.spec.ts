import { expect, test } from './support/mock-api';

/**
 * Giỏ web khổ 375px phải là Mini App (cart-lines.miniapp.spec.ts): dòng giảm giá (giá gạch) và dòng Giờ vàng không cao hơn dòng thường chỉ vì
 * thêm giá gạch, giá và bộ đếm nằm chung một hàng. Bộ đếm ô 44px rộng ~134px, cộng cột giá ~70px vượt cột chữ ~203px nên bộ đếm rớt xuống
 * hàng riêng; ô phải là 36px như Mini App (vùng chạm vẫn 44px).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

const line = (over: Record<string, unknown>) => ({
  id: 'c0', variationId: 'v0', slug: 'sp', productName: 'Sản phẩm', variationName: 'Mặc định', thumbnail: null,
  unitPrice: 65_000, quantity: 1, stock: 50, weight: 600, total: 65_000, ...over,
});

test.describe('Web khách: dòng giỏ ở 375px', () => {
  test('dòng giảm giá và dòng Giờ vàng chỉ cao hơn dòng thường một ít; giá và bộ đếm chung một hàng; ô −/+ 36px, vùng chạm 44px', async ({ page, api }) => {
    const flashEnd = new Date(Date.now() + 2 * 3_600_000 + 5 * 60_000).toISOString();
    const items = [
      line({ id: 'c1', variationId: 'v-plain', slug: 'gia-thuong', productName: 'Sản phẩm giá thường' }),
      line({ id: 'c2', variationId: 'v-sale', slug: 'dang-giam', productName: 'Sản phẩm đang giảm', unitPrice: 33_000, listUnitPrice: 50_000, total: 33_000 }),
      line({
        id: 'c3', variationId: 'v-flash', slug: 'gio-vang', productName: 'Sản phẩm Giờ vàng', unitPrice: 84_000, listUnitPrice: 120_000, quantity: 2, total: 168_000,
        isFlash: true, flashEndAt: flashEnd, flashSaleItemId: 'f1',
      }),
    ];
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
    api.get('/me', () => user);
    api.get('/me/coupons', []);
    api.get('/me/wishlist/ids', []);
    api.get('/config/public', {
      freeshipThreshold: 500000,
      support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
      waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
    });
    api.get('/cart', { items, couponCode: null, subtotal: 266_000, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 4 });
    api.get('/flash-sales/active', []);
    api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gio-hang');
    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(3, { timeout: 30_000 });

    const heights = await lines.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    const [plain, sale, flash] = heights as [number, number, number];
    expect(sale - plain, `dòng thường ${plain}px, dòng giảm ${sale}px`).toBeLessThanOrEqual(8);
    // Dòng Giờ vàng thêm nhãn + "Kết thúc sau …" (hai hàng, ~48px) và "Thành tiền" (SL 2, ~22px): chặn trần để không phình thêm. Mini chặn 72,
    // web hơn ~8px vì hàng nhãn cao 48 (Mini 46) và còn khe 4px trên hàng nhãn.
    expect(flash - plain, `dòng thường ${plain}px, dòng Giờ vàng ${flash}px`).toBeLessThanOrEqual(84);
    expect(sale, `dòng giảm giá ${sale}px`).toBeLessThanOrEqual(124);

    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    for (const name of ['Sản phẩm đang giảm', 'Sản phẩm Giờ vàng']) {
      const row = lines.filter({ hasText: name });
      const minus = row.getByRole('button', { name: `Giảm số lượng ${name}` });
      const stepper = await minus.boundingBox();
      const price = await row.getByText(/^\d{2,3}\.\d{3}đ$/).first().boundingBox();
      expect(stepper && price, `dòng "${name}" có giá và bộ đếm`).toBeTruthy();
      expect(Math.abs(mid(price!) - mid(stepper!)), `giá và bộ đếm của "${name}" chung một hàng`).toBeLessThanOrEqual(20);
    }

    for (const b of [
      lines.first().getByRole('button', { name: 'Giảm số lượng Sản phẩm giá thường' }),
      lines.first().getByRole('button', { name: 'Tăng số lượng Sản phẩm giá thường' }),
    ]) {
      const box = (await b.boundingBox())!;
      expect(Math.round(box.width)).toBe(36);
      expect(Math.round(box.height)).toBe(36);
      const hit = await b.evaluate((el) => {
        const s = getComputedStyle(el, '::after');
        return { w: s.width, h: s.height };
      });
      expect(hit).toEqual({ w: '44px', h: '44px' });
    }
  });
});
