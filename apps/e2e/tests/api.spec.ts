import { test, expect } from '@playwright/test';

/**
 * API E2E Tests — Checkout Flow
 *
 * Token được lấy từ E2E_API_TOKEN (do global-setup.ts tạo ra bằng dev-token.ts).
 * Token này ký đúng JWT_ACCESS_SECRET thật → qua được JwtAuthGuard, chạm đến business logic.
 *
 * Nếu DB không chạy → E2E_API_TOKEN rỗng → test nhận 401, vẫn có warning rõ ràng.
 */
test.describe('API E2E Tests - Checkout Flow', () => {
  let token: string;

  test.beforeAll(async () => {
    token = process.env.E2E_API_TOKEN ?? '';
    if (!token) {
      console.warn(
        '[api.spec] Không có E2E_API_TOKEN — chạy global-setup thất bại. ' +
          'Hãy đảm bảo Docker DB đang chạy trước khi test.'
      );
    }
  });

  test('POST /checkout/quote - Trả về lỗi nghiệp vụ khi giỏ hàng trống', async ({ request }) => {
    test.skip(!token, 'Bỏ qua: E2E_API_TOKEN chưa được tạo (DB chưa chạy)');

    const res = await request.post('/checkout/quote', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        addressId: 'address-does-not-exist',
        pointsToUse: 0,
      },
    });

    // Với JWT hợp lệ: Guard pass → vào business logic.
    // Giỏ hàng của user test trống → phải trả 400, không phải 500.
    expect(res.status()).toBeLessThan(500);
    expect(res.status()).not.toBe(401); // Xác nhận JWT đã được accept

    if (res.status() === 400) {
      const body = (await res.json()) as { message?: string | string[] };
      const msg = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? '');
      // Backend trả tiếng Việt: "Giỏ hàng trống." (checkout.service.ts)
      expect(msg.toLowerCase()).toMatch(/tr[oô]ng|empty|address/i);
    }
  });

  test('POST /checkout/place-order - Idempotency Key chống đặt đơn lặp', async ({ request }) => {
    test.skip(!token, 'Bỏ qua: E2E_API_TOKEN chưa được tạo (DB chưa chạy)');

    const idempotencyKey = `idemp-e2e-${Date.now()}`;
    const body = {
      addressId: 'address-does-not-exist',
      paymentMethod: 'COD',
      pointsToUse: 0,
    };
    const headers = {
      Authorization: `Bearer ${token}`,
      'idempotency-key': idempotencyKey,
    };

    // Gọi lần 1
    const res1 = await request.post('/checkout/place-order', { headers, data: body });
    const status1 = res1.status();
    const responseBody1 = await res1.json() as unknown;

    // Không được là 401 (token phải hợp lệ) hay 500 (không được crash)
    expect(status1).not.toBe(401);
    expect(status1).toBeLessThan(500);

    // Gọi lần 2 với CÙNG idempotency-key
    const res2 = await request.post('/checkout/place-order', { headers, data: body });
    const status2 = res2.status();
    const responseBody2 = await res2.json() as unknown;

    // Idempotency: response phải HOÀN TOÀN giống lần 1
    // (bao gồm cả trường hợp 400 — lỗi phải cùng nội dung)
    expect(status2).toBe(status1);
    expect(responseBody2).toEqual(responseBody1);
  });
});
