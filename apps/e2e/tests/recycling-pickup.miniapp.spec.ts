import type { OrderDTO } from '@tubutree/shared-types';
import { test, expect, makeOrder, makeUser, mockSession } from './support/mock-api';
import { mockCheckout, publicConfig } from './support/checkout-mocks';

/**
 * Zalo Mini App E2E — Thu gom vật liệu tái chế (đơn đổi hàng Gomdon/BestExpress).
 *
 * UI dưới test:
 *   - apps/miniapp/src/pages/checkout.tsx: khối #checkout-recycling, toggle role=checkbox
 *     aria-label "Gửi lại vật liệu tái chế". CHỈ hiện khi GET /config/public trả recyclingEnabled:true.
 *     Body POST /checkout/place-order chỉ có hasRecyclingPickup:true (+ recyclingNote đã trim) khi
 *     khách bật; ngược lại KHÔNG có hai key đó (utils/format.ts recyclingCheckoutFields — tương thích
 *     API bản cũ bật forbidNonWhitelisted).
 *   - apps/miniapp/src/pages/order-detail.tsx: khối #order-recycling, tiêu đề theo gomdonStatus
 *     (utils/format.ts recyclingPickupView), "Mã vận đơn BestExpress:" khi có gomdonPartnerCode.
 */

const TOGGLE_NAME = 'Gửi lại vật liệu tái chế';
const NOTE_PLACEHOLDER = 'Ghi chú loại vật dụng muốn gửi';

test.describe('Checkout — lựa chọn gửi lại vật liệu tái chế', () => {
  test('Tính năng TẮT (recyclingEnabled=false): không hiện lựa chọn, body đặt hàng không có trường thu gom', async ({ page, api }) => {
    mockCheckout(api, { recyclingEnabled: false });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    await expect(page.locator('#checkout-recycling')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: TOGGLE_NAME, exact: true })).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
  });

  test('API bản cũ không trả recyclingEnabled → coi như tắt, không hiện lựa chọn', async ({ page, api }) => {
    mockCheckout(api);
    const { recyclingEnabled: _omit, ...legacy } = publicConfig();
    api.get('/config/public', legacy);
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ })).toBeEnabled({ timeout: 15_000 });
    expect(api.callsTo('GET', '/config/public').length).toBeGreaterThan(0);
    await expect(page.locator('#checkout-recycling')).toHaveCount(0);
  });

  test('Tính năng BẬT: hiện lựa chọn (mặc định tắt) — không bấm thì body vẫn không có trường thu gom', async ({ page, api }) => {
    mockCheckout(api, { recyclingEnabled: true });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const section = page.locator('#checkout-recycling');
    await expect(section).toBeVisible();
    const toggle = section.getByRole('checkbox', { name: TOGGLE_NAME, exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    // 2 × 600g → ~1.2 kg (cùng công thức BE gomdon-weight.ts).
    await expect(section.getByText('Thu gom tối đa ~1.2 kg')).toBeVisible();
    await expect(page.getByPlaceholder(NOTE_PLACEHOLDER)).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ paymentMethod: 'COD' });
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
  });

  test('Bật lựa chọn + ghi chú → gửi hasRecyclingPickup:true và recyclingNote đã trim', async ({ page, api }) => {
    mockCheckout(api, { recyclingEnabled: true });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const toggle = page.getByRole('checkbox', { name: TOGGLE_NAME, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const note = page.getByPlaceholder(NOTE_PLACEHOLDER);
    await expect(note).toBeVisible();
    await note.fill('  3 cục pin, vỏ hộp sữa  ');
    // COD: không hiện lời nhắc "đặt lịch sau khi thanh toán".
    await expect(page.getByText('Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.')).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({
      paymentMethod: 'COD',
      hasRecyclingPickup: true,
      recyclingNote: '3 cục pin, vỏ hộp sữa',
    });
    await expect(page.getByText('Cảm ơn bạn đã chọn Tubu')).toBeVisible({ timeout: 10_000 });
  });

  test('Bật rồi tắt lại → body không còn trường thu gom (kể cả ghi chú đã gõ)', async ({ page, api }) => {
    mockCheckout(api, { recyclingEnabled: true });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const toggle = page.getByRole('checkbox', { name: TOGGLE_NAME, exact: true });
    await toggle.click();
    await page.getByPlaceholder(NOTE_PLACEHOLDER).fill('quần áo cũ');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByPlaceholder(NOTE_PLACEHOLDER)).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
  });

  test('Chuyển khoản + thu gom: nhắc lịch thu gom đặt sau khi nhận thanh toán, vẫn gửi hasRecyclingPickup', async ({ page, api }) => {
    mockCheckout(api, { recyclingEnabled: true });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('radio', { name: 'Chuyển khoản ngân hàng' }).click();
    await page.getByRole('checkbox', { name: TOGGLE_NAME, exact: true }).click();
    await expect(page.getByText('Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.')).toBeVisible();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ paymentMethod: 'BANK_TRANSFER', hasRecyclingPickup: true });
    // Không gõ ghi chú → không gửi recyclingNote rỗng.
    expect(call.body).not.toHaveProperty('recyclingNote');
    await expect(page.getByText('Quét QR để chuyển khoản')).toBeVisible({ timeout: 10_000 });
  });
});

// ───────────────────────────── Chi tiết đơn ─────────────────────────────

interface DetailCase {
  name: string;
  order: Partial<OrderDTO>;
  title: string;
  waybill: string | null;
  /** Nút "Hủy đơn" ở action bar có hiện không. */
  canCancel: boolean;
  /** Câu chi tiết phải hiện đúng (bỏ trống = không kiểm). */
  detail?: string;
  /** Đơn đã rời hàng đợi CSKH → tuyệt đối không hứa "CSKH sẽ liên hệ". */
  noCskhPromise?: boolean;
}

/** utils/format.ts NEUTRAL_PICKUP_DETAIL — cùng câu với web lib/recycling.ts. */
const NEUTRAL_DETAIL = 'Nếu bưu tá chưa nhận vật liệu tái chế, nhắn Zalo OA Tubu để được hẹn lại.';

const RECYCLING = { hasRecyclingPickup: true, recyclingNote: '3 cục pin, vỏ hộp sữa' } as const;

const DETAIL_CASES: DetailCase[] = [
  {
    name: 'COD vừa đặt, chưa có vận đơn (gomdonStatus null)',
    order: { ...RECYCLING, status: 'CONFIRMED', gomdonStatus: null },
    title: 'Đang đặt lịch thu gom',
    waybill: null,
    canCancel: true,
  },
  {
    name: 'Đã tạo vận đơn BestExpress (gomdonStatus "1")',
    order: { ...RECYCLING, status: 'CONFIRMED', gomdonStatus: '1', gomdonPartnerCode: 'BEX000111' },
    title: 'Đã đặt lịch thu gom',
    waybill: 'BEX000111',
    canCancel: true,
  },
  {
    name: 'Chuyển khoản chưa trả (AWAITING_PAYMENT)',
    order: {
      ...RECYCLING,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      gomdonStatus: 'AWAITING_PAYMENT',
    },
    title: 'Chờ thanh toán',
    waybill: null,
    canCancel: true,
  },
  {
    name: 'Tạo vận đơn thất bại (FAILED) → CSKH liên hệ',
    order: { ...RECYCLING, status: 'CONFIRMED', gomdonStatus: 'FAILED' },
    title: 'CSKH sẽ liên hệ hẹn thu gom',
    waybill: null,
    canCancel: true,
  },
  {
    name: 'Bưu tá đã lấy hàng (gomdonStatus "3") → không cho khách tự huỷ',
    order: { ...RECYCLING, status: 'CONFIRMED', gomdonStatus: '3', gomdonPartnerCode: 'BEX000333' },
    title: 'Bưu tá đang giao hàng',
    waybill: 'BEX000333',
    canCancel: false,
  },
  {
    name: 'Giao thành công (gomdonStatus "7")',
    order: { ...RECYCLING, status: 'DELIVERED', paymentStatus: 'PAID', gomdonStatus: '7', gomdonPartnerCode: 'BEX000777' },
    title: 'Đã giao hàng',
    waybill: 'BEX000777',
    canCancel: false,
  },
  {
    name: 'Đơn đã huỷ → ẩn mã vận đơn',
    order: { ...RECYCLING, status: 'CANCELLED', gomdonStatus: '1', gomdonPartnerCode: 'BEX000999', gomdonCancelStatus: 'CANCELLED' },
    title: 'Đã huỷ thu gom',
    waybill: null,
    canCancel: false,
  },
  {
    name: 'Đã giao bằng vận đơn tay (DELIVERED, Gomdon FAILED) → trung tính, không hứa CSKH',
    order: { ...RECYCLING, status: 'DELIVERED', paymentStatus: 'PAID', gomdonStatus: 'FAILED' },
    title: 'Đã giao hàng',
    waybill: null,
    canCancel: false,
    detail: NEUTRAL_DETAIL,
    noCskhPromise: true,
  },
  {
    name: 'Admin "Đã xử lý tay" (MANUAL_HANDLED) → trung tính, ẩn mã vận đơn cũ',
    order: { ...RECYCLING, status: 'CONFIRMED', gomdonStatus: 'MANUAL_HANDLED', gomdonPartnerCode: 'BEX000444' },
    title: 'Thu gom được xử lý riêng',
    waybill: null,
    canCancel: true,
    detail: NEUTRAL_DETAIL,
    noCskhPromise: true,
  },
];

test.describe('Chi tiết đơn — trạng thái thu gom theo gomdonStatus', () => {
  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-recycle' }));
    // Đơn DELIVERED tải thêm danh sách đổi/trả (orders.controller.ts @Get('me/returns')).
    api.get('/orders/me/returns', []);
  });

  for (const [i, c] of DETAIL_CASES.entries()) {
    test(`#order-recycling: ${c.name}`, async ({ page, api }) => {
      const code = `TUBU-RC-${i + 1}`;
      api.get('/orders/:code', makeOrder({ code, ...c.order }));
      await page.goto(`/order/${code}`);

      const box = page.locator('#order-recycling');
      await expect(box).toBeVisible({ timeout: 15_000 });
      await expect(box.getByText('Thu gom vật liệu tái chế', { exact: true })).toBeVisible();
      await expect(box.getByText(c.title, { exact: true })).toBeVisible();
      await expect(box).toContainText(`Vật dụng gửi: ${RECYCLING.recyclingNote}`);

      if (c.waybill) {
        await expect(box).toContainText(`Mã vận đơn BestExpress: ${c.waybill}`);
      } else {
        await expect(box).not.toContainText('Mã vận đơn BestExpress:');
      }
      if (c.detail) await expect(box).toContainText(c.detail);
      if (c.noCskhPromise) await expect(box).not.toContainText('CSKH');

      const cancelBtn = page.getByRole('button', { name: 'Hủy đơn', exact: true });
      if (c.canCancel) await expect(cancelBtn).toBeVisible();
      else await expect(cancelBtn).toHaveCount(0);
    });
  }

  test('Đơn không chọn thu gom → không có khối #order-recycling', async ({ page, api }) => {
    api.get('/orders/:code', makeOrder({ code: 'TUBU-RC-NONE', status: 'CONFIRMED', hasRecyclingPickup: false }));
    await page.goto('/order/TUBU-RC-NONE');
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#order-recycling')).toHaveCount(0);
  });
});
