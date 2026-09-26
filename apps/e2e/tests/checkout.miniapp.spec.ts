import { test, expect } from './support/mock-api';
import { BANK_QR, CHECKOUT_ADDRESS, mockCheckout, ORDER_CODE_BANK, ORDER_CODE_COD } from './support/checkout-mocks';

/**
 * Zalo Mini App E2E - Luồng Đặt hàng & Thanh toán (Checkout Lifecycle)
 *
 * Kiểm tra:
 * 1. Màn hình Thanh toán:
 *    - Tải địa chỉ giao hàng, danh sách sản phẩm, báo giá (POST /checkout/quote)
 *    - Số dư Ví / TubuXu đọc từ GET /me/wallet (không phải từ user đăng nhập)
 * 2. Đặt hàng:
 *    - COD → màn OrderSuccess với mã đơn; body gửi đúng addressId/paymentMethod + Idempotency-Key
 *    - BANK_TRANSFER → chuyển sang /bank-payment/:code (VietQR)
 *
 * Toàn bộ API được mock (tests/support/mock-api.ts) — không cần API/DB.
 */
test.describe('Zalo Mini App E2E - Luồng Thanh toán & Đặt hàng (Checkout Lifecycle)', () => {
  test.beforeEach(async ({ api }) => {
    mockCheckout(api);
  });

  test('Màn hình Thanh toán: Hiển thị đúng địa chỉ, danh sách món và báo giá tạm tính', async ({ page }) => {
    await page.goto('/checkout');

    // Chờ địa chỉ + báo giá (nút đặt hàng ghi tổng tiền chỉ khi quote đã về).
    await expect(page.getByText(CHECKOUT_ADDRESS.street, { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nước Rửa Chén Sinh Học Tubu 500ml')).toBeVisible();
    await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ })).toBeEnabled();
    await expect(page.getByText('149.000đ').first()).toBeVisible();

    // Số dư lấy từ GET /me/wallet (350.000đ / 80.000 xu), KHÔNG phải số trong user (200.000đ).
    await expect(page.getByRole('radio', { name: 'Ví Tubu (350.000đ)' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'TubuXu (80.000 xu)' })).toBeVisible();

    // Tính năng thu gom tắt (recyclingEnabled=false) → không hiện lựa chọn.
    await expect(page.locator('#checkout-recycling')).toHaveCount(0);
  });

  test('Đặt hàng thành công với COD: Chuyển sang màn hình xác nhận đơn', async ({ page, api }) => {
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;

    expect(call.body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id, paymentMethod: 'COD', pointsToUse: 0 });
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
    expect(call.headers['idempotency-key'] ?? '').not.toBe('');

    // OrderSuccess (components/checkout/order-success.tsx): tiêu đề + mã đơn + nhắc tiền mặt COD.
    await expect(page.getByText('Cảm ơn bạn đã chọn Tubu')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ORDER_CODE_COD)).toBeVisible();
    await expect(page.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeVisible();
    expect(api.callsTo('POST', '/checkout/place-order')).toHaveLength(1);
  });

  test('Đặt hàng với Chuyển khoản (BANK_TRANSFER): Điều hướng sang màn hình QR thanh toán', async ({ page, api }) => {
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const bankRadio = page.getByRole('radio', { name: 'Chuyển khoản ngân hàng' });
    await bankRadio.click();
    await expect(bankRadio).toHaveAttribute('aria-checked', 'true');

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id, paymentMethod: 'BANK_TRANSFER' });
    expect(call.headers['idempotency-key'] ?? '').not.toBe('');

    await expect(page).toHaveURL(new RegExp(`/bank-payment/${ORDER_CODE_BANK}`), { timeout: 10_000 });
    await expect(page.getByText('Quét QR để chuyển khoản')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(BANK_QR.bank.accountNo).first()).toBeVisible();
    await expect(page.getByText(ORDER_CODE_BANK).first()).toBeVisible();
  });
});
