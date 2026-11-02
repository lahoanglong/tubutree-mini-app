import type { Locator, Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { firstProduct, type PdpProduct } from './support/pdp-product';

/**
 * Sheet của web từ md (768px) là hộp thoại giữa màn rộng tối đa 480px, không tay nắm; dưới md vẫn dính đáy rộng hết khung (web 375 giống Mini).
 * Hai sheet web: `mini/bottom-sheet` (Ưu đãi ở PDP) và `ui/sheet` (dòng "Nhận Điểm Xanh" ở PDP). Tiêu đề cả hai là tiêu đề khối Inter 16/700.
 * Phần server của Next gọi API thật nên spec lấy sản phẩm có sẵn trong DB e2e và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock.
 * Cần API thật: chạy ở CI (web-gate.sh), không chạy ở Mini. `K7_SHOTS_DIR` (+ `K7_LABEL`) bật chụp ảnh trước/sau cho báo cáo gói.
 */
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };
const DIALOG_W = 480;

async function mockPdp(page: Page, api: MockApi, p: PdpProduct): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 4.6, count: 27, videoCount: 0, distribution: {}, items: [] });
  api.get(`/products/${p.slug}/reviews/can-review`, { canReview: false });
  api.get('/me/wishlist/ids', []);
  api.get('/affiliate/me', { isAffiliate: false });
  api.get('/me/coupons', [
    { code: 'GIAM20', type: 'AMOUNT', value: 20000, minOrder: 100000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
    { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: 100000, maxDiscount: 30000, endAt: '2027-01-01T00:00:00.000Z' },
  ]);
}

const openOffers = (page: Page) => page.getByRole('button', { name: /Ưu đãi/ }).first();
const openPoints = (page: Page) => page.getByTestId('pdp-points-earn');
const dialogOf = (page: Page) => page.locator('[role="dialog"][aria-modal="true"]').last();

/** Chờ hiệu ứng mở xong rồi mới đo: hộp đang scale/fade thì bề rộng và tâm chưa phải số cuối. */
async function settled(dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.K7_SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${process.env.K7_LABEL ?? 'run'}__${name}.png` });
}

/** Tiêu đề khối: cùng họ chữ với thân trang (Inter), 700, 16px; không phải Fraunces 18px. */
async function expectBlockTitle(page: Page, dialog: Locator): Promise<void> {
  const bodyFamily = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  const title = dialog.getByRole('heading', { level: 2 });
  const css = await title.evaluate((el) => {
    const s = getComputedStyle(el);
    return { family: s.fontFamily, weight: s.fontWeight, size: s.fontSize };
  });
  expect(css.family).toBe(bodyFamily);
  expect(css.family).toMatch(/Inter/);
  expect(css.weight).toBe('700');
  expect(css.size).toBe('16px');
  // Tiêu đề và nút Đóng (44px) cùng một hàng: tâm lệch quá vài px thì nhìn như tiêu đề rơi khỏi hàng.
  const [t, x] = [(await title.boundingBox())!, (await dialog.getByRole('button', { name: 'Đóng' }).boundingBox())!];
  expect(Math.abs(t.y + t.height / 2 - (x.y + x.height / 2))).toBeLessThanOrEqual(2);
}

async function expectCenteredDialog(dialog: Locator, viewport: { width: number; height: number }): Promise<void> {
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(DIALOG_W);
  expect(box.height).toBeLessThanOrEqual(viewport.height * 0.85 + 1);
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  // Bo đủ bốn góc: bản bottom sheet chỉ bo hai góc trên.
  const radii = await dialog.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius].map((v) => parseFloat(v));
  });
  for (const r of radii) expect(r).toBeGreaterThan(0);
}

test.describe('Web khách: sheet từ md là hộp thoại giữa màn', () => {
  test('1280: sheet Ưu đãi (mini/bottom-sheet) giữa màn, rộng tối đa 480, không tay nắm, tiêu đề Inter 700 16px, đóng bằng Esc và bấm nền', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    await mockPdp(page, api, p!);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/san-pham/${p!.slug}`);

    await expect(openOffers(page)).toBeVisible();
    await openOffers(page).click();
    const dialog = dialogOf(page);
    await settled(dialog);
    await shot(page, 'web1280-offers-sheet');

    await expectCenteredDialog(dialog, DESKTOP);
    await expect(dialog.locator('.mini-sheet-handler')).toBeHidden();
    await expectBlockTitle(page, dialog);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await openOffers(page).click();
    await settled(dialogOf(page));
    await page.locator('[data-sheet-backdrop]').click({ position: { x: 8, y: 8 } });
    await expect(dialogOf(page)).toBeHidden();
  });

  test('1280: sheet ui/sheet (Điểm Xanh ở PDP) cùng dạng hộp thoại, nội dung ngắn thì hộp ôm nội dung, hàng thanh kéo ẩn', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    await mockPdp(page, api, p!);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/san-pham/${p!.slug}`);

    await expect(openPoints(page)).toBeVisible();
    await openPoints(page).click();
    const dialog = dialogOf(page);
    await settled(dialog);
    await shot(page, 'web1280-ui-sheet');

    await expectCenteredDialog(dialog, DESKTOP);
    await expect(dialog.locator('[data-sheet-handle]')).toBeHidden();
    await expectBlockTitle(page, dialog);
    expect((await dialog.boundingBox())!.height).toBeLessThan(DESKTOP.height * 0.5);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('375: cả hai sheet vẫn dính đáy, rộng hết khung, có tay nắm; tiêu đề Inter 700 16px', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    await mockPdp(page, api, p!);
    await page.setViewportSize(PHONE);
    await page.goto(`/san-pham/${p!.slug}`);

    await expect(openOffers(page)).toBeVisible();
    await openOffers(page).click();
    let dialog = dialogOf(page);
    await settled(dialog);
    await shot(page, 'web375-offers-sheet');
    let box = (await dialog.boundingBox())!;
    expect(Math.abs(box.width - PHONE.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - PHONE.height)).toBeLessThanOrEqual(1);
    await expect(dialog.locator('.mini-sheet-handler')).toBeVisible();
    await expectBlockTitle(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await openPoints(page).click();
    dialog = dialogOf(page);
    await settled(dialog);
    await shot(page, 'web375-ui-sheet');
    box = (await dialog.boundingBox())!;
    expect(Math.abs(box.width - PHONE.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - PHONE.height)).toBeLessThanOrEqual(1);
    await expect(dialog.locator('[data-sheet-handle]')).toBeVisible();
    await expectBlockTitle(page, dialog);
  });
});
