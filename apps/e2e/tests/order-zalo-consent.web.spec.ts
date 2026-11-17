import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { ORDER_CODE_COD } from './support/checkout-mocks';
import { axeInside, mockOrderZalo, shot } from './support/order-zalo-mocks';

/**
 * Web /thanh-toan: ô "Nhận hành trình đơn hàng qua Zalo" sát trên Đặt hàng, lời mời kết bạn ở màn đặt thành công.
 * Project "Web Customer Mobile" đo ở 390px, "Web Customer" ở 1440px. Cờ tắt thì màn như trước. Mọi lời gọi /api/** từ trình duyệt đi qua mock.
 */
const sizeOf = (project: string) => (project === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });

const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng · / }).filter({ visible: true });
const zaloBox = (page: Page) => page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
const zaloRow = (page: Page) => page.locator('label').filter({ has: zaloBox(page) });

test.describe('Web: ô đồng ý hành trình đơn qua Zalo', () => {
  let width = 0;
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer' && testInfo.project.name !== 'Web Customer Mobile', 'Chỉ hai project web khách');
    const size = sizeOf(testInfo.project.name);
    width = size.width;
    await page.setViewportSize(size);
  });

  test('cờ tắt: không hỏi /config/order-zalo, không có ô, không có lời mời kết bạn sau khi đặt', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, false);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toHaveCount(0);
    expect(api.callsTo('GET', '/config/order-zalo')).toHaveLength(0);
    await shot(page, `web-${width}-checkout-before`);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).not.toHaveProperty('orderZaloConsent');
    await expect(page.getByText(ORDER_CODE_COD).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Mở Zalo Tubu Tree' })).toHaveCount(0);
  });

  test('cờ bật: ô chưa tick, vùng chạm ≥ 44px, không tràn, Đặt hàng vẫn trong khung; tick rồi đặt gửi orderZaloConsent: true và có liên kết kết bạn', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });

    const box = zaloBox(page);
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    const row = zaloRow(page);
    await expect(row).toContainText('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này.');
    await expect(row).toContainText('Số nhận: 090•••4567');
    const rect = (await row.boundingBox())!;
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(placeButton(page)).toBeInViewport();
    await row.scrollIntoViewIfNeeded();
    await shot(page, `web-${width}-checkout-after`);

    await row.click();
    await expect(box).toBeChecked();
    await expect(placeButton(page)).toBeInViewport();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ orderZaloConsent: true });

    await expect(page.getByText(`Kết bạn Zalo với Tubu Tree để nhận hành trình đơn ${ORDER_CODE_COD}.`).filter({ visible: true })).toBeVisible({ timeout: 15_000 });
    const friend = page.getByRole('link', { name: 'Mở Zalo Tubu Tree' }).filter({ visible: true });
    await expect(friend).toBeVisible();
    await expect(friend).toHaveAttribute('href', 'https://zalo.me/0899149229');
    await expect(friend).toHaveAttribute('target', '_blank');
    await expect(friend).toHaveAttribute('rel', /noopener/);
    expect((await friend.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await friend.scrollIntoViewIfNeeded();
    await shot(page, `web-${width}-success-after`);
  });

  test('cờ bật, không tick: đơn vẫn đặt được với orderZaloConsent: false, không có liên kết kết bạn', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/thanh-toan');
    await expect(placeButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(zaloBox(page)).toBeVisible();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeButton(page).click();
    expect((await placed).body).toMatchObject({ orderZaloConsent: false });
    await expect(page.getByText(ORDER_CODE_COD).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Mở Zalo Tubu Tree' })).toHaveCount(0);
  });

  test('axe: không vi phạm serious/critical trong ô Zalo', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrderZalo(api, true);
    await page.goto('/thanh-toan');
    await expect(zaloBox(page)).toBeVisible({ timeout: 20_000 });
    expect(await axeInside(page, zaloRow(page))).toEqual([]);
  });
});
