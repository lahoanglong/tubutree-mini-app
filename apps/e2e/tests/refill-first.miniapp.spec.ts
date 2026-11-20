import type { Page } from '@playwright/test';
import type { CartLine, CartSummary, PurchasedItem } from '../../miniapp/src/services/shop-api';
import { test, expect, makeUser, mockSession, publicConfig } from './support/mock-api';
import { mockPilotCart, PILOT_CART } from './support/pilot-mocks';
import { mockBuyFlowSession, PURCHASED, THUMB } from './support/buy-flow-mocks';
import { mockWasteCustomer, wasteDetail, wastePoint } from './support/waste-mocks';

/**
 * Mini App, wave tubu-w4-04: gợi ý gói Refill cho chai khách đã có (giỏ, dải Mua lại món quen) và "Gửi lại như lần trước" ở Đổi rác.
 * API mock toàn bộ. Đặt `REFILL_SHOTS_DIR` thì chụp ảnh từng trạng thái vào thư mục đó.
 */
const SHOTS = process.env.REFILL_SHOTS_DIR;
const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${name}.png` });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const BOTTLE: CartLine = {
  ...PILOT_CART.items[0]!,
  id: 'ci-bottle',
  productId: 'p-bottle',
  variationId: 'v-bottle',
  slug: 'nuoc-rua-chen-500ml',
  productName: 'Nước rửa chén Fuwa3e 500ml',
  variationName: '',
  unitPrice: 60_000,
  quantity: 2,
  stock: 9,
  total: 120_000,
};
const REFILL_LINE: CartLine = { ...BOTTLE, id: 'ci-refill', productId: 'p-refill', variationId: 'v-refill', slug: 'refill-nuoc-rua-chen-10l', productName: 'Refill Nước rửa chén Fuwa3e 10L', unitPrice: 650_000, quantity: 1, total: 650_000 };
const OFFER = { productId: 'p-refill', slug: 'refill-nuoc-rua-chen-10l', name: 'Refill Nước rửa chén Fuwa3e 10L', thumbnail: null, variationId: 'v-refill', price: 650_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true };
const cartOf = (items: CartLine[]): CartSummary => ({ ...PILOT_CART, items, subtotal: items.reduce((s, l) => s + l.total, 0), itemCount: items.reduce((s, l) => s + l.quantity, 0), freeshipThreshold: 199_000 });

const link = (page: Page) => page.getByTestId('refill-swap-link');

test.describe('Giỏ Mini: đổi dòng chai sang gói Refill', () => {
  test('cờ tắt: không hỏi cặp refill, không có liên kết', async ({ page, api }) => {
    mockPilotCart(api);
    api.get('/cart', cartOf([BOTTLE]));
    await page.setViewportSize(VIEWPORTS[1]);
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: BOTTLE.productName, exact: true })).toBeVisible({ timeout: 15_000 });
    await shot(page, 'cart-flag-off-390');
    await expect(link(page)).toHaveCount(0);
    expect(api.callsTo('GET', '/catalog/refill-pairs/mine')).toHaveLength(0);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.width}x${vp.height}: liên kết chữ dưới dòng chai, xác nhận khi giá tăng, thêm gói rồi mới bỏ chai, Hoàn tác trả đúng chai`, async ({ page, api }) => {
      mockPilotCart(api);
      api.get('/config/public', { ...publicConfig({ freeshipThreshold: 199_000 }), refillFirstEnabled: true });
      let current = cartOf([BOTTLE]);
      const order: string[] = [];
      api.get('/cart', () => current);
      api.get('/catalog/refill-pairs/mine', { 'p-bottle': OFFER });
      api.post('/cart/items', ({ call }) => {
        const body = call.body as { variationId: string; quantity: number };
        order.push(`add:${body.variationId}x${body.quantity}`);
        current = body.variationId === 'v-refill' ? cartOf([BOTTLE, REFILL_LINE]) : cartOf([REFILL_LINE, BOTTLE]);
        return current;
      });
      api.on('DELETE', '/cart/items/:id', ({ params }) => {
        order.push(`remove:${params.id}`);
        current = cartOf(current.items.filter((l) => l.id !== params.id));
        return current;
      });
      await page.setViewportSize(vp);
      await page.goto('/cart');

      await expect(link(page)).toHaveText('Đã có chai? Đổi sang Refill 10L · 650.000đ (+530.000đ) Rẻ hơn 45%/100ml', { timeout: 15_000 });
      await expect(link(page)).toHaveCount(1);
      expect(api.callsTo('GET', '/catalog/refill-pairs/mine')[0]?.query.get('ids')).toBe('p-bottle');
      const box = (await link(page).boundingBox())!;
      expect(box.height, 'vùng chạm liên kết').toBeGreaterThanOrEqual(44);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, `cart-link-${vp.width}`);

      await link(page).click();
      await expect(page.getByText('Đổi sang Refill?')).toBeVisible();
      await shot(page, `cart-confirm-${vp.width}`);
      expect(order).toEqual([]);
      await page.getByRole('button', { name: 'Đổi sang Refill', exact: true }).click();
      await expect(page.getByText('Đã đổi sang Refill')).toBeVisible();
      expect(order).toEqual(['add:v-refillx1', 'remove:ci-bottle']);
      await expect(page.getByRole('button', { name: REFILL_LINE.productName, exact: true })).toBeVisible();
      await shot(page, `cart-undo-${vp.width}`);

      order.length = 0;
      await page.getByText('Hoàn tác', { exact: true }).click();
      await expect.poll(() => order).toEqual(['add:v-bottlex2', 'remove:ci-refill']);
      await expect(page.getByRole('button', { name: BOTTLE.productName, exact: true })).toBeVisible();
    });
  }

  test('đổi làm giỏ tụt dưới mốc Miễn phí giao hàng: hộp xác nhận nói trước số còn thiếu', async ({ page, api }) => {
    mockPilotCart(api);
    api.get('/config/public', { ...publicConfig({ freeshipThreshold: 199_000 }), refillFirstEnabled: true });
    api.get('/cart', { ...cartOf([{ ...BOTTLE, quantity: 5, total: 300_000 }]), freeship: true });
    api.get('/catalog/refill-pairs/mine', { 'p-bottle': { ...OFFER, price: 150_000 } });
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto('/cart');
    await link(page).click({ timeout: 15_000 });
    await expect(page.getByText(/Giỏ sẽ thiếu 49\.000đ để Miễn phí giao hàng/)).toBeVisible();
    await shot(page, 'cart-confirm-freeship-360');
  });

  test('gói refill hết hàng: không mời đổi', async ({ page, api }) => {
    mockPilotCart(api);
    api.get('/config/public', { ...publicConfig(), refillFirstEnabled: true });
    api.get('/cart', cartOf([BOTTLE]));
    api.get('/catalog/refill-pairs/mine', { 'p-bottle': { ...OFFER, inStock: false } });
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: BOTTLE.productName, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/catalog/refill-pairs/mine').length).toBeGreaterThan(0);
    await expect(link(page)).toHaveCount(0);
  });
});

const bought = (n: number, over: Partial<PurchasedItem> = {}): PurchasedItem => ({
  ...PURCHASED,
  variationId: `var-q${n}`,
  productId: `prod-q${n}`,
  slug: `san-pham-q${n}`,
  productName: `Món quen ${n}`,
  variationName: '',
  thumbnail: THUMB,
  price: 40_000 + n * 10_000,
  ...over,
});

test.describe('Dải Mua lại món quen: chai khách đã có thành ô gói Refill', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.width}x${vp.height}: ô chai thành gói Refill, "+ Thêm" thêm gói refill, mở ô vẫn mua lại được chai cũ`, async ({ page, api }) => {
      mockBuyFlowSession(api, { purchased: { items: [bought(1, { productName: 'Nước rửa chén Fuwa3e 500ml' }), bought(2), bought(4)], nextCursor: null } });
      api.get('/config/public', { ...publicConfig({ aiAdvisorEnabled: true }), refillFirstEnabled: true });
      api.get('/catalog/refill-pairs/mine', { 'prod-q1': OFFER });
      await page.addInitScript(() => localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4a', kind: 'returning' })));
      await page.setViewportSize(vp);
      await page.goto('/');
      const strip = page.getByTestId('quick-reorder');
      await expect(strip).toBeVisible({ timeout: 20_000 });
      const first = strip.getByTestId('quick-reorder-card').first();
      await expect(first).toHaveAttribute('data-variation-id', 'v-refill');
      await expect(first).toContainText('650.000đ');
      expect(await noHorizontalScroll(page)).toBe(true);
      await first.scrollIntoViewIfNeeded();
      await shot(page, `rail-${vp.width}`);

      // tubu-w6-01 P1-a: ô đổi nói rõ món sẽ vào giỏ trước khi chạm; nhãn nằm trọn trong thẻ, nút từ 44px.
      const badge = first.getByText('Đổi sang túi Refill 10L');
      await expect(badge).toBeVisible();
      const cardBox = (await first.boundingBox())!;
      const badgeBox = (await badge.boundingBox())!;
      expect(badgeBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      const addRefill = first.getByTestId('quick-reorder-add');
      await expect(addRefill).toHaveText('+ Thêm Refill');
      await expect(addRefill).toHaveAttribute('aria-label', 'Thêm Refill 10L thay cho Nước rửa chén Fuwa3e 500ml vào giỏ, 650.000đ. Rẻ hơn 35% mỗi 100ml');
      const addBox = (await addRefill.boundingBox())!;
      expect(addBox.width).toBeGreaterThanOrEqual(44);
      expect(addBox.height).toBeGreaterThanOrEqual(44);
      await expect(strip.getByRole('button', { name: /^Thêm lại tất cả 3 món vào giỏ, tổng .*, gồm 1 túi Refill$/ })).toBeVisible();

      await first.getByTestId('quick-reorder-add').click();
      await expect.poll(() => api.callsTo('POST', '/cart/items').map((c) => (c.body as { variationId: string }).variationId)).toEqual(['v-refill']);
    });
  }
});

test.describe('Đổi rác: "Gửi lại như lần trước"', () => {
  const done = () =>
    wasteDetail({ id: 'wr-done', code: 'TR-DONE1', method: 'DROP_OFF', status: 'COMPLETED', pointsAwarded: 3000, completedAt: '2026-10-17T06:00:00.000Z', editable: false, cancellable: false });

  test('cờ tắt: màn Đổi rác giữ nút "Đổi rác ngay", không hỏi danh sách yêu cầu để dựng thẻ', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], requests: [done()] });
    await page.setViewportSize(VIEWPORTS[1]);
    await page.goto('/recycle');
    await expect(page.getByRole('button', { name: 'Đổi rác ngay' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('waste-repeat')).toHaveCount(0);
    await shot(page, 'recycle-flag-off-390');
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.width}x${vp.height}: 4 chạm từ màn Đổi rác tới yêu cầu đã tạo, điền sẵn loại rác, cách gửi và điểm nhận lần trước; đồng ý thể lệ phải tích lại`, async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-wx' }));
      mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-q1' })], requests: [done()] });
      api.get('/config/public', { ...publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: false } }), wasteRepeatRequestEnabled: true });
      const created = wasteDetail({ id: 'wr-new', code: 'TR-NEW01', method: 'DROP_OFF', status: 'OPEN' });
      api.post('/waste/requests', () => created);
      api.get('/waste/requests/:id', ({ params }) => (params.id === 'wr-new' ? created : done()));
      await page.setViewportSize(vp);
      await page.goto('/recycle');

      const card = page.getByTestId('waste-repeat');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText('Gửi lại như lần trước');
      await expect(card).toContainText('1 loại');
      await expect(page.getByRole('button', { name: 'Đổi rác ngay' })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await shot(page, `recycle-repeat-${vp.width}`);

      let taps = 0;
      await card.getByRole('button', { name: 'Gửi lại', exact: true }).click();
      taps++;
      await expect(page).toHaveURL(/\/recycle\/new$/);
      await expect(page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' }).getByRole('textbox', { name: 'Số lượng' }).first()).toHaveValue('3');
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
      taps++;
      await expect(page.getByRole('radio', { name: /Mang tới điểm nhận/ })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Tạp hoá Cô Ba').first()).toBeVisible();
      const create = page.getByRole('button', { name: 'Tạo yêu cầu' });
      await expect(create).toBeDisabled();
      await shot(page, `recycle-repeat-review-${vp.width}`);
      await page.getByText('Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này').click();
      taps++;
      await create.click();
      taps++;

      await expect(page.getByText('TR-NEW01').first()).toBeVisible();
      expect(taps).toBe(4);
      const [body] = api.callsTo('POST', '/waste/requests');
      expect(body?.body).toEqual({ method: 'DROP_OFF', lines: [{ itemId: 'wi-carton', declaredQty: 3 }], pointId: 'wp-q1', consent: true, consentVersion: '2026-10-17.1' });
    });
  }

  test('điểm nhận lần trước nay đã đóng: bỏ điểm cũ, nói ở bước cách gửi và để khách chọn lại', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-wx' }));
    mockWasteCustomer(api, { points: [wastePoint({ id: 'wp-other', name: 'Điểm Khác' })], requests: [done()] });
    api.get('/config/public', { ...publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: false } }), wasteRepeatRequestEnabled: true });
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto('/recycle');
    await page.getByTestId('waste-repeat').getByRole('button', { name: 'Gửi lại', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByTestId('waste-repeat-note')).toBeVisible();
    await shot(page, 'recycle-repeat-point-closed-360');
  });
});
