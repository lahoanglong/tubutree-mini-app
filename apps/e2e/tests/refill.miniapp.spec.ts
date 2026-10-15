import type { RefillResult, RefillSummary } from '../../miniapp/src/services/refill-api';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';

/**
 * Zalo Mini App E2E — Đổi vỏ chai (apps/miniapp/src/pages/refill.tsx, route /refill).
 * Route NestJS: refill.controller.ts (GET /refill/me, POST /refill/return với header Idempotency-Key).
 * Nhiều điểm nhận vỏ (R8): /refill/me trả thêm `pickupLocations`, khách chọn một điểm và POST kèm `pickupLocationId`;
 * trường `pickup` (một điểm) vẫn có cho bản app cũ.
 */

const Q1 = { id: 'loc-q1', name: 'Cửa hàng Quận 1', address: '12 Lê Lợi, Quận 1, TP.HCM', hours: '8h–20h hằng ngày', phone: '0901234567' };
const TD = { id: 'loc-td', name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân, TP. Thủ Đức', hours: null, phone: '0912345678' };

const BASE: RefillSummary = {
  pickup: { address: Q1.address, hours: Q1.hours, phone: Q1.phone },
  pickupLocations: [Q1, TD],
  perBottle: 10,
  monthlyCap: 20,
  monthlyUsed: 2,
  monthlyRemaining: 18,
  totalRecycled: 12,
  history: [],
};

const RESULT: RefillResult = { id: 'br-1', quantity: 1, seedsAwarded: 10, status: 'PENDING', monthlyRemaining: 17, totalRecycled: 12 };

function mockRefill(api: MockApi, summary: RefillSummary) {
  mockSession(api, makeUser({ id: 'user-refill', fullName: 'Khách đổi vỏ' }));
  api.get('/refill/me', summary);
  api.post('/refill/return', RESULT);
}

test.describe('Đổi vỏ chai — nhiều điểm nhận', () => {
  test('liệt kê các điểm đang mở, bắt chọn điểm rồi gửi yêu cầu kèm pickupLocationId', async ({ page, api }) => {
    mockRefill(api, BASE);
    await page.goto('/refill');

    const group = page.getByRole('radiogroup', { name: 'Chọn điểm nhận vỏ' });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByText('12 Lê Lợi, Quận 1, TP.HCM')).toBeVisible();
    await expect(group.getByText('8h–20h hằng ngày')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Gọi 0912 345 678' })).toBeVisible();

    const submit = page.getByRole('button', { name: 'Chọn điểm nhận vỏ để gửi yêu cầu' });
    await expect(submit).toBeDisabled();

    await group.getByRole('radio', { name: /Kho Thủ Đức/ }).click();
    await expect(group.getByRole('radio', { name: /Kho Thủ Đức/ })).toHaveAttribute('aria-checked', 'true');
    const posted = api.waitForCall('POST', '/refill/return');
    await page.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }).click();

    const call = await posted;
    expect(call.body).toEqual({ quantity: 1, pickupLocationId: 'loc-td' });
    expect(call.headers['idempotency-key']).toBeTruthy();
    await expect(page.getByText(/Đã gửi yêu cầu!/)).toBeVisible();
  });

  test('chỉ có một điểm: không bắt chọn và tự gửi kèm điểm đó', async ({ page, api }) => {
    mockRefill(api, { ...BASE, pickupLocations: [Q1] });
    await page.goto('/refill');

    await expect(page.getByText('Cửa hàng Quận 1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    const posted = api.waitForCall('POST', '/refill/return');
    await page.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }).click();

    expect((await posted).body).toEqual({ quantity: 1, pickupLocationId: 'loc-q1' });
  });

  test('API cũ chỉ trả một điểm (pickup): vẫn hiện địa chỉ và gửi yêu cầu như trước, không kèm điểm', async ({ page, api }) => {
    const { pickupLocations: _omitted, ...legacy } = BASE;
    mockRefill(api, legacy);
    await page.goto('/refill');

    await expect(page.getByText('12 Lê Lợi, Quận 1, TP.HCM')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    const posted = api.waitForCall('POST', '/refill/return');
    await page.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }).click();

    expect((await posted).body).toEqual({ quantity: 1 });
  });

  test('server báo điểm vừa ngừng nhận vỏ: hiện lỗi và tải lại danh sách điểm', async ({ page, api }) => {
    mockRefill(api, BASE);
    let loads = 0;
    api.get('/refill/me', () => (++loads === 1 ? BASE : { ...BASE, pickupLocations: [Q1] }));
    api.post('/refill/return', () => reply(400, { statusCode: 400, message: 'Điểm nhận này đã ngừng nhận vỏ. Vui lòng chọn điểm nhận khác.' }));
    await page.goto('/refill');

    await page.getByRole('radio', { name: /Kho Thủ Đức/ }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Gửi yêu cầu đổi vỏ' }).click();

    await expect(page.getByText('Điểm nhận này đã ngừng nhận vỏ. Vui lòng chọn điểm nhận khác.')).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByText('Cửa hàng Quận 1')).toBeVisible();
    expect(loads).toBeGreaterThanOrEqual(2);
  });

  test('yêu cầu chờ duyệt tạo trước khi có điểm nhận (không gắn điểm), từ hai điểm: nhắc chọn trong các điểm ở trên, không nói "bên dưới"', async ({ page, api }) => {
    mockRefill(api, {
      ...BASE,
      history: [{ id: 'br-old', quantity: 2, seedsAwarded: 20, status: 'PENDING', createdAt: '2026-10-01T03:00:00.000Z', pickupLocation: null }],
    });
    await page.goto('/refill');

    const note = page.getByText('Chưa chọn điểm — mang đến một trong các điểm nhận ở trên');
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Bạn có 2 vỏ chai đang chờ duyệt/)).toBeVisible();
    await expect(page.getByText(/điểm nhận bên dưới/)).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Chọn điểm nhận vỏ' })).toBeVisible();

    const box = await note.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  // R5-BUYER-4: admin tắt điểm sau khi khách gửi thì yêu cầu đang chờ vẫn phải nói mang đến đâu (tên, địa chỉ, giờ, số gọi).
  test('yêu cầu chờ duyệt gắn với điểm đã tắt: vẫn hiện tên, địa chỉ, giờ, nút gọi và nói rõ điểm tạm ngưng nhận', async ({ page, api }) => {
    const OFF = { id: 'loc-off', name: 'Kho Cũ', address: '9 Nguyễn Huệ, Quận 1', hours: '9h–17h', phone: '0907654321', isActive: false };
    mockRefill(api, {
      ...BASE,
      history: [{ id: 'br-off', quantity: 2, seedsAwarded: 20, status: 'PENDING', createdAt: '2026-10-10T03:00:00.000Z', pickupLocation: OFF }],
    });
    await page.goto('/refill');

    await expect(page.getByText('Mang đến: Kho Cũ')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Điểm này đã tạm ngưng nhận vỏ. Vui lòng gọi điểm hoặc liên hệ Tubu trước khi mang vỏ đến.')).toBeVisible();
    await expect(page.getByText('9 Nguyễn Huệ, Quận 1')).toBeVisible();
    await expect(page.getByText('9h–17h')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gọi 0907 654 321' })).toBeVisible();
    await expect(page.getByText('Điểm nhận: Kho Cũ (đã tạm ngưng)')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
