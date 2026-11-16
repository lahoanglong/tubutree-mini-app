import type { Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { STATES, mockWorld, openState } from './support/order-detail-states';
import { mockWasteCustomer, wastePoint } from './support/waste-mocks';

/**
 * Zalo Mini App (W180): chi tiết đơn đã giao có đúng một thẻ mời giữ bao bì gửi kèm đơn kế tiếp
 * (apps/miniapp/src/components/orders/second-order-invite.tsx). Thẻ mở màn tạo yêu cầu với đường "Thu kèm đơn" chọn sẵn
 * và ẩn khi khách đã chạm trần 2 yêu cầu đang mở (W179).
 */
const DELIVERED = STATES.find((s) => s.key === 'delivered')!;
const SHIPPING = STATES.find((s) => s.key === 'shipping')!;
const PICKUP_OPEN = { enabled: true, dropoff: true, mailin: true, pickup: true };

const openRequest = (id: string, method: 'DROP_OFF' | 'MAIL_IN') => ({
  id,
  code: `TR-${id}`,
  method,
  status: 'OPEN' as const,
  closeReason: null,
  createdAt: '2026-11-15T03:00:00.000Z',
  expiresAt: null,
  estimatedPoints: 3000,
  pointsAwarded: null,
  pointName: 'Kho Tubu',
  orderCode: null,
  lines: [],
});

async function setup(api: MockApi, page: Page, openRequests: ReturnType<typeof openRequest>[] = [], state = DELIVERED) {
  const w = await mockWorld(api, page, 'miniapp', state, Date.now());
  mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], me: { laneFlags: { dropoff: true, mailin: true, pickup: true }, thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 2 }, openRequests } });
  api.get('/config/public', publicConfig({ waste: PICKUP_OPEN, shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } }));
  return w;
}

for (const width of [375, 320] as const) {
  test(`đơn đã giao ${width}px: một thẻ mời, cả thẻ là một nút ≥44px, không tràn ngang`, async ({ page, api }) => {
    const w = await setup(api, page);
    await openState(page, 'miniapp', 375, w.order.code);
    await page.setViewportSize({ width, height: 812 });
    const card = page.locator('#order-second-order-invite');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('Giữ bao bì gửi kèm đơn sau')).toBeVisible();
    await expect(card.getByText(/Miễn ship 100%/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Giữ bao bì gửi kèm đơn sau/ })).toHaveCount(1);
    const box = (await card.getByRole('button').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(96);
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('chạm thẻ: mở /recycle/new?method=PICKUP, chọn món rồi sang bước 2 thấy "Thu kèm đơn" đã chọn sẵn', async ({ page, api }) => {
  const w = await setup(api, page);
  await openState(page, 'miniapp', 375, w.order.code);
  await page.locator('#order-second-order-invite').getByRole('button').click();
  await expect(page).toHaveURL(/\/recycle\/new\?method=PICKUP/);
  const card = page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' });
  const plus = card.getByRole('button', { name: 'Tăng số lượng' });
  await expect(plus).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 3; i++) await plus.click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('radio', { name: /Thu kèm đơn/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await expect(page.getByRole('radio', { name: /Mang tới điểm nhận/ })).toHaveAttribute('aria-checked', 'false');
});

test('đã đủ 2 yêu cầu đang mở (W179): không hiện thẻ', async ({ page, api }) => {
  const w = await setup(api, page, [openRequest('a1', 'DROP_OFF'), openRequest('a2', 'MAIL_IN')]);
  await openState(page, 'miniapp', 375, w.order.code);
  await expect(page.getByText('Giao thành công').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
});

test('đơn đang giao: không hiện thẻ và không gọi /waste/me', async ({ page, api }) => {
  const w = await setup(api, page, [], SHIPPING);
  await openState(page, 'miniapp', 375, w.order.code);
  await expect(page.locator('main, .zaui-page').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
  expect(api.callsTo('GET', '/waste/me')).toHaveLength(0);
});

test('đường kèm đơn tắt ở cấu hình công khai: không hiện thẻ', async ({ page, api }) => {
  const w = await setup(api, page);
  api.get('/config/public', publicConfig({ waste: { ...PICKUP_OPEN, pickup: false }, shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } }));
  await openState(page, 'miniapp', 375, w.order.code);
  await expect(page.getByText('Giao thành công').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
});
