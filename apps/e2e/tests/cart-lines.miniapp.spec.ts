import { test, expect } from './support/mock-api';
import { mockPilotCart, PILOT_CART } from './support/pilot-mocks';
import type { CartLine, CartSummary } from '../../miniapp/src/services/shop-api';

/**
 * Giỏ Mini App ở 375px: dòng đang giảm giá (giá gạch) không được cao hơn dòng thường chỉ vì thêm giá gạch. Xếp ngang thì giá bán + giá gạch +
 * bộ đếm 36px không vừa một hàng ở cột chữ ~190px, giá rớt xuống dòng và dòng giảm giá cao gần gấp rưỡi: đúng nhóm hàng mà thiết kế muốn nổi.
 * Giá và bộ đếm phải nằm chung một hàng.
 */
const line = (over: Partial<CartLine>): CartLine => ({ ...PILOT_CART.items[0]!, ...over });

test.describe('Zalo Mini App E2E - dòng giỏ ở 375px', () => {
  test('dòng giảm giá và dòng Giờ vàng chỉ cao hơn dòng thường một ít; giá và bộ đếm chung một hàng', async ({ page, api }) => {
    mockPilotCart(api);
    const flashEnd = new Date(Date.now() + 2 * 3_600_000 + 5 * 60_000).toISOString();
    const items: CartLine[] = [
      line({ id: 'c1', variationId: 'v-plain', productName: 'Sản phẩm giá thường', unitPrice: 65_000, total: 65_000 }),
      line({ id: 'c2', variationId: 'v-sale', productName: 'Sản phẩm đang giảm', unitPrice: 33_000, listUnitPrice: 50_000, total: 33_000 }),
      line({
        id: 'c3', variationId: 'v-flash', productName: 'Sản phẩm Giờ vàng', unitPrice: 84_000, listUnitPrice: 120_000, quantity: 2, total: 168_000,
        isFlash: true, flashEndAt: flashEnd, flashSaleItemId: 'f1',
      }),
    ];
    const cart: CartSummary = { ...PILOT_CART, items, subtotal: 266_000, itemCount: 4 };
    api.get('/cart', cart);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: 'Sản phẩm giá thường', exact: true })).toBeVisible({ timeout: 15_000 });

    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(3);
    const heights = await lines.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    const [plain, sale, flash] = heights as [number, number, number];
    // Giá gạch xếp dưới giá bán, cao bằng bộ đếm: dòng giảm giá không cao hơn dòng thường quá 8px.
    expect(sale - plain, `dòng thường ${plain}px, dòng giảm ${sale}px`).toBeLessThanOrEqual(8);
    // Dòng Giờ vàng thêm nhãn "Giờ vàng" + "Kết thúc sau …" (hai hàng vì cột chữ chỉ ~190px, ~46px) và "Thành tiền" (SL 2, ~20px): chặn
    // trần để không phình thêm (trước đây ~210px khi giá gạch xếp ngang).
    expect(flash - plain, `dòng thường ${plain}px, dòng Giờ vàng ${flash}px`).toBeLessThanOrEqual(72);
    expect(sale).toBeLessThanOrEqual(124);

    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    for (const name of ['Sản phẩm đang giảm', 'Sản phẩm Giờ vàng']) {
      const row = lines.filter({ hasText: name });
      const stepper = await row.getByRole('button', { name: 'Giảm số lượng' }).boundingBox();
      const price = await row.getByText(/^\d{2,3}\.\d{3}đ$/).first().boundingBox();
      expect(stepper && price, `dòng "${name}" có giá và bộ đếm`).toBeTruthy();
      expect(Math.abs(mid(price!) - mid(stepper!)), `giá và bộ đếm của "${name}" chung một hàng`).toBeLessThanOrEqual(20);
    }
  });
});
