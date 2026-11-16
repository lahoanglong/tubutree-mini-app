import type { Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { STATES, mockWorld, openState } from './support/order-detail-states';
import { mockWasteCustomer, wastePoint } from './support/waste-mocks';

/**
 * Web (W180): chi tiết đơn đã giao có đúng một thẻ mời giữ bao bì gửi kèm đơn kế tiếp
 * (apps/web/src/app/tai-khoan/don-hang/[code]/order-extras.tsx, OrderSecondOrderInvite). Cùng luật với Mini App: thẻ mở trang tạo
 * yêu cầu với ?method=PICKUP và ẩn khi khách đã chạm trần 2 yêu cầu đang mở (W179).
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
  const w = await mockWorld(api, page, 'web', state, Date.now());
  mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], me: { laneFlags: { dropoff: true, mailin: true, pickup: true }, thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 2 }, openRequests } });
  api.get('/config/public', publicConfig({ waste: PICKUP_OPEN, shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } }));
  return w;
}

test.describe('Thẻ mời giữ bao bì gửi kèm đơn sau — web', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ: khổ do spec tự đặt');
  });

  test('đơn đã giao 375px: một thẻ, cao ≥44px, không tràn ngang; bấm mở /doi-rac/tao?method=PICKUP', async ({ page, api }) => {
    const w = await setup(api, page);
    await openState(page, 'web', 375, w.order.code);
    const card = page.locator('#order-second-order-invite');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Giữ bao bì gửi kèm đơn sau')).toBeVisible();
    await expect(card.getByText(/Miễn ship 100%/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Gửi bao bì kèm đơn mua kế tiếp/ })).toHaveCount(1);
    const box = (await card.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await card.click();
    await expect(page).toHaveURL(/\/doi-rac\/tao\?method=PICKUP/);
  });

  test('đã đủ 2 yêu cầu đang mở (W179): không hiện thẻ', async ({ page, api }) => {
    const w = await setup(api, page, [openRequest('a1', 'DROP_OFF'), openRequest('a2', 'MAIL_IN')]);
    await openState(page, 'web', 375, w.order.code);
    await expect(page.getByText('Giao thành công').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
  });

  test('đơn đang giao: không hiện thẻ và không gọi /waste/me', async ({ page, api }) => {
    const w = await setup(api, page, [], SHIPPING);
    await openState(page, 'web', 375, w.order.code);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#order-second-order-invite')).toHaveCount(0);
    expect(api.callsTo('GET', '/waste/me')).toHaveLength(0);
  });
});
