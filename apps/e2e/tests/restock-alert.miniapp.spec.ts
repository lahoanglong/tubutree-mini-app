import type { Page } from '@playwright/test';
import { NOTIFY_PREFS_TEXT_VERSION } from '../../../packages/app-core/src/api/account';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App 360px (wave tubu-notify-cap-restock): PDP mọi phân loại hết hàng có nút chính "Báo tôi khi có hàng" thay nút xám khi cờ
 * catalog.restock_alert_enabled bật, bấm lại để huỷ; cờ tắt giữ nút xám như PROD. Cài đặt có hai công tắc tách "Nhắc Vườn Xanh" và
 * "Tương tác bài viết", mỗi lần đổi gửi kèm nguồn và phiên bản câu chữ. API mock toàn bộ.
 * RESTOCK_SHOTS=<thư mục> thì chụp ảnh 360px để so trước/sau.
 */
const VP = { width: 360, height: 740 } as const;
const SHOTS = process.env.RESTOCK_SHOTS;

const OUT_VARIATIONS = [
  { id: 'var-2l', sku: 'NRC-2L', name: '2L', attributes: {}, retailPrice: 150_000, salePrice: null, stock: 0 },
  { id: 'var-1l', sku: 'NRC-1L', name: '1L', attributes: {}, retailPrice: 85_000, salePrice: null, stock: 0 },
];

/** 1L còn hàng (rẻ nhất, được chọn sẵn), 2L hết hàng. */
const MIXED_VARIATIONS = [{ ...OUT_VARIATIONS[0]! }, { ...OUT_VARIATIONS[1]!, stock: 9 }];

function mockOutOfStockPdp(api: MockApi, enabled: boolean, variations: readonly object[] = OUT_VARIATIONS): { subscribed: Set<string> } {
  const state = { subscribed: new Set<string>() };
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations });
  api.get('/config/public', { freeshipThreshold: 200_000, returnWindowDays: 7, subscribeDiscountPct: 0.12 });
  api.get('/products/:slug/reviews/can-review', { canReview: false, reason: 'NOT_PURCHASED', rewardAvailable: false, purchaseCount: 0, reviewableOrders: [], myReviews: [] });
  api.get('/restock-alerts', () => ({ enabled, variationIds: enabled ? [...state.subscribed] : [] }));
  api.post('/me/restock-alerts', ({ call }) => {
    const { variationId } = call.body as { variationId: string };
    state.subscribed.add(variationId);
    return { variationId, subscribed: true };
  });
  api.delete('/me/restock-alerts/:variationId', ({ params }) => {
    const variationId = params.variationId ?? '';
    state.subscribed.delete(variationId);
    return { variationId, subscribed: false };
  });
  return state;
}

async function openPdp(page: Page): Promise<void> {
  await page.setViewportSize(VP);
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

const stickyBar = (page: Page) => page.getByTestId('sticky-bar');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('Mini App 360px: Báo tôi khi có hàng', () => {
  test('cờ tắt: nút xám "Tạm hết hàng" như trước, không có nút báo hàng về', async ({ page, api }) => {
    mockOutOfStockPdp(api, false);
    await openPdp(page);
    const grey = stickyBar(page).getByRole('button', { name: 'Tạm hết hàng', exact: true });
    await expect(grey).toBeVisible();
    await expect(grey).toBeDisabled();
    await expect(stickyBar(page).getByRole('button', { name: 'Báo tôi khi có hàng' })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-360-pdp-out-flag-off.png`, animations: 'disabled' });
  });

  test('cờ bật: một nút chính thay nút xám, bấm đăng ký rồi bấm lại huỷ', async ({ page, api }) => {
    const state = mockOutOfStockPdp(api, true);
    await openPdp(page);

    const notifyMe = stickyBar(page).getByRole('button', { name: 'Báo tôi khi có hàng' });
    await expect(notifyMe).toBeVisible({ timeout: 15_000 });
    await expect(notifyMe).toBeEnabled();
    await expect(notifyMe).toHaveAttribute('aria-pressed', 'false');
    await expect(stickyBar(page).getByRole('button', { name: 'Tạm hết hàng', exact: true })).toHaveCount(0);
    await expect(stickyBar(page).getByRole('button', { name: /Mua ngay/ })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    const box = await notifyMe.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-360-pdp-out-flag-on.png`, animations: 'disabled' });

    const sub = api.waitForCall('POST', '/me/restock-alerts');
    await notifyMe.click();
    const subscribedId = ((await sub).body as { variationId: string }).variationId;
    expect(OUT_VARIATIONS.map((v) => v.id)).toContain(subscribedId);
    expect(state.subscribed.has(subscribedId)).toBe(true);

    const cancel = stickyBar(page).getByRole('button', { name: 'Đã đăng ký báo hàng · Huỷ' });
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Có hàng Tubu sẽ báo bạn ở mục Thông báo.')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-360-pdp-out-subscribed.png`, animations: 'disabled' });

    const unsub = api.waitForCall('DELETE', '/me/restock-alerts/:variationId');
    await cancel.click();
    expect((await unsub).path).toBe(`/me/restock-alerts/${subscribedId}`);
    await expect(stickyBar(page).getByRole('button', { name: 'Báo tôi khi có hàng' })).toBeVisible();
    expect(state.subscribed.size).toBe(0);
  });
});

test.describe('Mini App 360px: chọn phân loại hết hàng khi cờ báo hàng về bật', () => {
  test('cờ bật: chip 2L hết hàng bấm được, chọn nó thì nút chính thành "Báo tôi khi có hàng" và đăng ký đúng 2L', async ({ page, api }) => {
    const state = mockOutOfStockPdp(api, true, MIXED_VARIATIONS);
    await openPdp(page);
    const chip = page.getByRole('button', { name: /^2L/ });
    await expect(chip).toHaveAttribute('aria-disabled', 'false', { timeout: 15_000 });
    await expect(stickyBar(page).getByRole('button', { name: /Mua ngay/ })).toBeVisible();
    await chip.click();
    const notifyMe = stickyBar(page).getByRole('button', { name: 'Báo tôi khi có hàng' });
    await expect(notifyMe).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-360-pdp-mixed-out-chip.png`, animations: 'disabled' });
    const sub = api.waitForCall('POST', '/me/restock-alerts');
    await notifyMe.click();
    expect((await sub).body).toEqual({ variationId: 'var-2l' });
    expect([...state.subscribed]).toEqual(['var-2l']);
    await page.getByRole('button', { name: /^1L/ }).click();
    await expect(stickyBar(page).getByRole('button', { name: /Mua ngay/ })).toBeVisible();
  });

  test('cờ tắt: chip 2L hết hàng vẫn khoá như trước', async ({ page, api }) => {
    mockOutOfStockPdp(api, false, MIXED_VARIATIONS);
    await openPdp(page);
    await expect(page.getByRole('button', { name: /^2L/ })).toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
  });
});

test.describe('Mini App 360px: Cài đặt thông báo tách công tắc', () => {
  test('hai công tắc "Nhắc Vườn Xanh" và "Tương tác bài viết"; tắt Tương tác bài viết chỉ gửi công tắc đó kèm nguồn và phiên bản câu chữ', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'user-notify', fullName: 'Nguyễn Văn A' }));
    api.get('/me/notifications/prefs', { notifyPromo: true, notifyGarden: true, notifySocial: true });
    api.patch('/me/notifications/prefs', ({ call }) => ({ notifyPromo: true, notifyGarden: true, notifySocial: true, ...(call.body as object) }));
    await page.setViewportSize(VP);
    await page.goto('/settings');

    const garden = page.getByRole('switch', { name: 'Nhắc Vườn Xanh' });
    const social = page.getByRole('switch', { name: 'Tương tác bài viết' });
    await expect(garden).toBeVisible({ timeout: 15_000 });
    await expect(social).toBeVisible();
    await expect(page.getByText('Nhắc nhở Vườn Xanh & tương tác bài viết')).toHaveCount(0);
    await expect(social).toHaveAttribute('aria-checked', 'true');
    expect(await noHorizontalScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-360-settings-switches.png`, animations: 'disabled' });

    const saved = api.waitForCall('PATCH', '/me/notifications/prefs');
    await social.click();
    expect((await saved).body).toEqual({ notifySocial: false, source: 'settings', textVersion: NOTIFY_PREFS_TEXT_VERSION });
    await expect(social).toHaveAttribute('aria-checked', 'false');
    await expect(garden).toHaveAttribute('aria-checked', 'true');
  });
});
