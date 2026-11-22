import type { Locator, Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { mockWorld, openState } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { ORDER_CODE_COD, placedOrderFor } from './support/checkout-mocks';
import { expectNoHorizontalOverflow } from './support/game-mini-mocks';
import { ORDER_ZALO_STATUS } from './support/order-zalo-mocks';

/**
 * tubu-w18-03: màn Đặt hàng thành công của web /thanh-toan khi mọi khối phụ cùng hiện (COD, điểm, Giao dự kiến, kết bạn Zalo, Đặt định kỳ,
 * mời bạn). Ở 375×812 trạng thái đơn, mã đơn và nút "Theo dõi đơn" nằm trọn trong màn đầu, không nút nào trùng tên, mọi chỗ chạm cao ≥ 44px,
 * không tràn ngang; từ md vẫn là màn máy tính. API mock toàn bộ.
 */

const CARD = { referralCode: 'LAN2026', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const SPLIT = [
  { code: 'TUBU-SPLIT-1', total: 149_000, fulfillerName: 'Tubu Tree', pointsEarned: 14 },
  { code: 'TUBU-SPLIT-2', total: 89_000, fulfillerName: 'Gian hàng Lan', pointsEarned: 8 },
  { code: 'TUBU-SPLIT-3', total: 59_000, fulfillerName: 'Gian hàng Minh', pointsEarned: 5 },
];

async function placeWithEverything(page: Page, api: MockApi, size: 375 | 1280, split = false) {
  await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
  api.get('/config/public', {
    ...publicConfig({ shippingEta: { minDays: 1, maxDays: 3 } } as never),
    orderZaloEnabled: true,
    tubuZaloPhone: '0984606774',
    referralViralEnabled: true,
  });
  api.get('/me/green-card', CARD);
  api.post('/events', { accepted: 1 });
  api.get('/config/order-zalo', ORDER_ZALO_STATUS);
  api.allowUnmocked('GET /checkout/shipping-estimate');
  api.post('/checkout/place-order', ({ call }) => ({
    ...placedOrderFor((call.body ?? {}) as Record<string, unknown>),
    orderZaloConsent: true,
    pointsEarned: 120,
    ...(split ? { code: SPLIT[0]!.code, splitOrders: SPLIT } : {}),
  }));
  await openState(page, 'web', size);
  const place = page.getByRole('button', { name: /Đặt hàng · / }).last();
  await expect(place).toBeEnabled({ timeout: 15_000 });
  await place.click();
  await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 15_000 });
}

/** Đáy vùng nhìn thấy: chiều cao màn trừ thanh cố định dưới đáy (nếu có). */
async function foldBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = window.innerHeight;
    let bottom = h;
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > window.innerWidth / 2 && r.bottom >= h - 1 && r.top > h / 2) bottom = Math.min(bottom, r.top);
    }
    return bottom;
  });
}

/** Nút và link đang hiện trong vùng: tên đọc được và khung. */
async function visibleControls(region: Locator) {
  return region.locator('a, button').evaluateAll((els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => ({
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        height: el.getBoundingClientRect().height,
      })),
  );
}

test.describe('tubu-w18-03 web: màn Đặt hàng thành công gọn ở 375×812', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt, một project là đủ');
  });

  test('đủ khối phụ: trạng thái, mã đơn và Theo dõi đơn nằm trong màn đầu; dữ kiện thanh toán còn nguyên; khối phụ nằm dưới nút', async ({ page, api }) => {
    await placeWithEverything(page, api, 375);
    const view = page.getByTestId('order-success-mobile');
    await expect(view).toBeVisible();
    await expect(view.getByTestId('order-invite-nudge')).toBeVisible({ timeout: 10_000 });
    await expect(view.getByRole('button', { name: /Đặt định kỳ/ })).toBeVisible();

    const fold = await foldBottom(page);
    const heading = (await view.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' }).boundingBox())!;
    const code = (await view.getByText(ORDER_CODE_COD, { exact: true }).boundingBox())!;
    const track = (await view.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(0);
    expect(code.y + code.height).toBeLessThanOrEqual(fold);
    expect(track.y + track.height, `Theo dõi đơn phải nằm trong màn đầu (đáy ${fold}px)`).toBeLessThanOrEqual(fold);

    // Dữ kiện của đơn còn đủ: tổng, nhắc tiền mặt COD, điểm, Giao dự kiến.
    await expect(view.getByText('Tổng thanh toán')).toBeVisible();
    await expect(view.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeVisible();
    await expect(view.getByText('+120 điểm, về khi đơn giao xong')).toBeVisible();
    await expect(view.getByText('Giao dự kiến')).toBeVisible();

    // Khối phụ (kết bạn Zalo, Đặt định kỳ, mời bạn) nằm dưới hai nút chính.
    const keep = (await view.getByRole('button', { name: 'Tiếp tục mua sắm' }).boundingBox())!;
    for (const extra of [view.getByRole('link', { name: /Zalo/ }), view.getByRole('button', { name: /Đặt định kỳ/ }), view.getByTestId('order-invite-nudge')]) {
      const box = (await extra.boundingBox())!;
      expect(box.y).toBeGreaterThan(keep.y + keep.height - 1);
    }

    const controls = await visibleControls(view);
    const names = controls.map((c) => c.name);
    expect(new Set(names).size, `nút trùng tên: ${JSON.stringify(names)}`).toBe(names.length);
    for (const c of controls) expect(c.height, `"${c.name}" cao ${c.height}px`).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });

  test('đơn tách 3 nơi giao: đủ 3 mã và tổng của cả lần đặt, Theo dõi đơn vẫn trong màn đầu, mỗi đơn mở được', async ({ page, api }) => {
    await placeWithEverything(page, api, 375, true);
    const view = page.getByTestId('order-success-mobile');
    for (const o of SPLIT) await expect(view.getByText(o.code, { exact: true }).first()).toBeVisible();
    await expect(view.getByText('Tổng 3 đơn')).toBeVisible();
    await expect(view.getByText('297.000đ').first()).toBeVisible();
    const track = (await view.getByRole('button', { name: 'Theo dõi đơn' }).boundingBox())!;
    const fold = await foldBottom(page);
    expect(track.y + track.height).toBeLessThanOrEqual(fold);
    for (const o of SPLIT) await expect(view.getByRole('button', { name: new RegExp(`Xem đơn ${o.code}`) })).toBeVisible();
    const controls = await visibleControls(view);
    for (const c of controls) expect(c.height, `"${c.name}" cao ${c.height}px`).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });

  test('1280: màn máy tính, không vẽ khối điện thoại; nút chính và dữ kiện đơn còn đủ', async ({ page, api }) => {
    await placeWithEverything(page, api, 1280);
    const desk = page.getByTestId('order-success-desktop');
    await expect(desk).toBeVisible();
    await expect(page.getByTestId('order-success-mobile')).toBeHidden();
    const track = desk.getByRole('link', { name: 'Theo dõi đơn' });
    await expect(track).toBeVisible();
    const box = (await track.boundingBox())!;
    expect(box.y + box.height, 'Theo dõi đơn trong màn đầu 1280×800').toBeLessThanOrEqual(800);
    await expect(desk.getByText(ORDER_CODE_COD, { exact: true })).toBeVisible();
    await expect(desk.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeVisible();
    await expect(desk.getByText('Điểm Xanh sẽ nhận: +120 điểm, về khi đơn giao xong')).toBeVisible();
    await expect(desk.getByText('sẽ về tay', { exact: false })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
