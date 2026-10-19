import { test, expect, makeUser, mockSession } from './support/mock-api';
import {
  BANK_QR,
  CHECKOUT_ADDRESS,
  CHECKOUT_LOYALTY,
  CHECKOUT_QUOTE,
  mockCheckout,
  ORDER_CODE_BANK,
  ORDER_CODE_COD,
} from './support/checkout-mocks';

/**
 * Zalo Mini App E2E - Luồng Đặt hàng & Thanh toán (Checkout Lifecycle)
 *
 * Kiểm tra:
 * 1. Màn hình Thanh toán:
 *    - Tải địa chỉ giao hàng, danh sách sản phẩm, báo giá (POST /checkout/quote)
 *    - Số dư Ví đọc từ GET /me/wallet (không phải từ user đăng nhập); chỉ còn 3 phương thức (COD, chuyển
 *      khoản, Ví Tubu), không còn TubuXu (PD-3: xu đã gộp vào Điểm Xanh)
 *    - Điểm Xanh = lô thường + lô quy đổi (không hết hạn) đọc từ GET /me/loyalty, gửi một số pointsToUse
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

    // Số dư lấy từ GET /me/wallet (350.000đ), KHÔNG phải số trong user (200.000đ).
    await expect(page.getByRole('radio', { name: 'Ví Tubu (350.000đ)' })).toBeVisible();
    // PD-3: không còn phương thức TubuXu; còn COD, chuyển khoản, Ví Tubu (radio địa chỉ không tính).
    await expect(page.getByRole('radio', { name: /(?<![\p{L}])xu(?![\p{L}])/iu })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /Thanh toán khi nhận hàng|Chuyển khoản ngân hàng|Ví Tubu/ })).toHaveCount(3);

    // waste.pickup tắt (publicConfig mặc định) → không có mục Thu kèm rác, cũng không còn khối thu gom cũ.
    await expect(page.locator('#checkout-recycling')).toHaveCount(0);
    await expect(page.locator('#checkout-waste-pickup')).toHaveCount(0);
  });

  // R5-BUYER-5: giỏ rỗng mà vẫn POST /checkout/quote thì máy chủ trả 400 và log đầy lỗi.
  test('Giỏ rỗng: báo giỏ trống và không gọi báo giá (POST /checkout/quote)', async ({ page, api }) => {
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0, unavailableItems: [] });
    await page.goto('/checkout');

    await expect(page.getByText('Giỏ còn trống đấy')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(api.callsTo('POST', '/checkout/quote')).toHaveLength(0);
  });

  test('Điểm Xanh: gộp lô thường + lô quy đổi thành một số dùng được, ghi rõ phần không hết hạn', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ })).toBeEnabled({ timeout: 15_000 });

    // 50 điểm thường + 50 điểm quy đổi = 100 điểm đề nghị dùng; phần quy đổi nói rõ không hết hạn.
    await expect(page.getByText('Bạn đang có 100 điểm')).toBeVisible();
    await expect(page.getByText('trong đó 50 điểm không hết hạn, trả tới 100% giá trị hàng')).toBeVisible();
  });

  test('Bật dùng Điểm Xanh: báo giá và đặt đơn gửi MỘT số pointsToUse = thường + quy đổi (BE tự chia lô)', async ({ page, api }) => {
    // BE chia hai lô: thường chịu trần 20% giá trị hàng (130.000đ → 26 điểm), quy đổi không trần (50 điểm).
    api.post('/checkout/quote', ({ call }) => {
      const wanted = ((call.body ?? {}) as { pointsToUse?: number }).pointsToUse ?? 0;
      if (wanted <= 0) return CHECKOUT_QUOTE;
      return { ...CHECKOUT_QUOTE, pointsUsed: 76, pointsUsedConverted: 50, pointsDiscount: 76000, total: 73000 };
    });
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ })).toBeEnabled({ timeout: 15_000 });

    const quoted = api.waitForCall('POST', '/checkout/quote');
    await page.locator('[role="checkbox"]').filter({ hasText: 'trong đó 50 điểm không hết hạn' }).click();
    expect((await quoted).body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id, pointsToUse: 100 });

    await expect(page.getByText('Dùng 76 điểm — giảm 76.000đ')).toBeVisible({ timeout: 10_000 });
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 73\.000đ/ });
    await expect(placeBtn).toBeEnabled();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    expect((await placed).body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id, paymentMethod: 'COD', pointsToUse: 100 });
  });

  test('Đơn 0đ do điểm phủ hết: ẩn chọn phương thức, ghi rõ đã trả đủ bằng Điểm Xanh, gửi COD', async ({ page, api }) => {
    // Khách có nhiều điểm quy đổi; freeship nên điểm phủ nốt phần hàng còn lại → tổng 0đ.
    mockSession(api, makeUser({ id: 'user-checkout', fullName: 'Nguyễn Văn A', pointsBalance: 50, pointsConvertedBalance: 200, walletBalance: 200000 }));
    api.get('/me/loyalty', { ...CHECKOUT_LOYALTY, pointsConvertedBalance: 200 });
    api.post('/checkout/quote', ({ call }) => {
      const wanted = ((call.body ?? {}) as { pointsToUse?: number }).pointsToUse ?? 0;
      if (wanted <= 0) return CHECKOUT_QUOTE;
      return { ...CHECKOUT_QUOTE, pointsUsed: 130, pointsUsedConverted: 104, pointsDiscount: 130000, shippingFee: 0, total: 0 };
    });
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ })).toBeEnabled({ timeout: 15_000 });

    await page.locator('[role="checkbox"]').filter({ hasText: 'trong đó 200 điểm không hết hạn' }).click();
    await expect(page.getByText('Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('radio', { name: /Thanh toán khi nhận hàng|Chuyển khoản ngân hàng|Ví Tubu/ })).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await page.getByRole('button', { name: /Đặt hàng · 0đ/ }).click();
    const call = await placed;
    expect(call.body).toMatchObject({ paymentMethod: 'COD', pointsToUse: 250 });
    expect(api.callsTo('GET', '/payments/bank-qr/:code')).toHaveLength(0);
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
    // default publicConfig has waste.pickup false, so the checkout makes no /waste/* call and shows no switch
    expect(call.body).not.toHaveProperty('wasteRequestId');
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
