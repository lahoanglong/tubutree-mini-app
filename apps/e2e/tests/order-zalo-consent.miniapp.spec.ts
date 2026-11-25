import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { ORDER_CODE_COD } from './support/checkout-mocks';
import { axeInside, mockOrderZalo, shot } from './support/order-zalo-mocks';

/**
 * Mini App 360px: ô "Nhận hành trình đơn hàng qua Zalo" ngay trên dòng điều khoản, lời mời kết bạn ở màn đặt thành công.
 * Cờ tắt thì màn như trước (không request, không phần tử mới). API mock toàn bộ.
 */
test.use({ viewport: { width: 360, height: 780 } });

const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng · / });
const zaloBox = (page: Page) => page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });

test.describe('Mini 360: ô đồng ý hành trình đơn qua Zalo', () => {
  test('cờ tắt: không hỏi /config/order-zalo, không có ô, không có lời mời kết bạn sau khi đặt', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, false);
    await page.goto('/checkout');
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(zaloBox(page)).toHaveCount(0);
    expect(api.callsTo('GET', '/config/order-zalo')).toHaveLength(0);
    await shot(page, 'mini-360-checkout-before');

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).not.toHaveProperty('orderZaloConsent');
    await expect(page.getByText(ORDER_CODE_COD).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Mở Zalo Tubu Tree' })).toHaveCount(0);
  });

  test('cờ bật: ô chưa tick, vùng chạm ≥ 44px, không tràn, Đặt hàng vẫn trong khung; tick rồi đặt gửi orderZaloConsent: true và có lời mời kết bạn', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/checkout');
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });

    const box = zaloBox(page);
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('aria-checked', 'false');
    await expect(box).toContainText('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này.');
    await expect(box).toContainText('Số nhận: 090•••4567');
    const rect = (await box.boundingBox())!;
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.y + rect.height).toBeLessThanOrEqual((await page.getByTestId('order-consent').boundingBox())!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expect(placeButton(page)).toBeInViewport();
    await box.scrollIntoViewIfNeeded();
    await shot(page, 'mini-360-checkout-after');

    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect(placeButton(page)).toBeInViewport();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ orderZaloConsent: true });

    await expect(page.getByText(`Nhận Bill & theo dõi đơn ${ORDER_CODE_COD} miễn phí qua Zalo Tubu Tree`)).toBeVisible({ timeout: 15_000 });
    const friend = page.getByRole('button', { name: 'Mở Zalo Tubu Tree' });
    await expect(friend).toBeVisible();
    expect((await friend.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await friend.scrollIntoViewIfNeeded();
    await shot(page, 'mini-360-success-after');
  });

  test('cờ bật, không tick: đơn vẫn đặt được với orderZaloConsent: false, không có lời mời kết bạn', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/checkout');
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(zaloBox(page)).toBeVisible();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ orderZaloConsent: false });
    await expect(page.getByText(ORDER_CODE_COD).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Mở Zalo Tubu Tree' })).toHaveCount(0);
  });

  test('axe: không vi phạm serious/critical trong ô Zalo', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/checkout');
    await expect(zaloBox(page)).toBeVisible({ timeout: 15_000 });
    expect(await axeInside(page, zaloBox(page))).toEqual([]);
  });
});
