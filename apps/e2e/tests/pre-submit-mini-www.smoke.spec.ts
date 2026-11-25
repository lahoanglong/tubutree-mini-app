import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockPilotProduct } from './support/pilot-mocks';
import { builtWww, miniPath } from './support/pre-submit';

/**
 * Khói bản build Mini `www` trước khi gửi duyệt Zalo (tubu-w36-02), chỉ chạy bằng playwright.mini-www.config.ts: Trang chủ dựng được từ entry đã
 * minify; mở Giỏ trống và Cá nhân thì nạp chunk lười `repurchase-due-card` (w36-01) và thẻ hiện; mọi tệp JS xin về đều có trong `www/assets` và trả
 * 200; không lỗi trang. Luồng chuyển khoản sang QR trên bản build chạy ở pre-submit-checkout.miniapp.spec.ts và pre-submit-bank-qr.miniapp.spec.ts
 * (cùng config).
 */
test.use({ viewport: { width: 375, height: 812 } });

const ASSETS = path.resolve(__dirname, '../../miniapp/www/assets');
const CHUNK = (name: string) => new RegExp(`^${name}\\.[A-Za-z0-9_-]{7}\\.module\\.js$`);
const ACCOUNT_UNMOCKED = ['GET /me/wallet', 'GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /me/coupons', 'GET /me/loyalty', 'GET /brand/owner/me', 'GET /chat/summary'];
const ITEM = {
  key: 'o-ps1:v-refill',
  days: 31,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'refill-fuwa3e-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: null,
  price: 89_000,
  listPrice: 99_000,
};

/** Mọi tệp JS trang xin dưới `…/assets/`: tên tệp và mã HTTP. */
function trackScripts(page: Page): { name: string; status: number }[] {
  const scripts: { name: string; status: number }[] = [];
  page.on('response', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.includes('/assets/') && p.endsWith('.js')) scripts.push({ name: path.posix.basename(p), status: r.status() });
  });
  return scripts;
}

function expectScriptsFromBuild(scripts: { name: string; status: number }[]): void {
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) {
    expect(s.status, s.name).toBe(200);
    expect(fs.existsSync(path.join(ASSETS, s.name)), `${s.name} có trong www/assets`).toBe(true);
  }
}

function signedIn(api: MockApi, id: string): void {
  mockSession(api, makeUser({ id, fullName: 'Nguyễn Văn An' }));
  api.get('/me/summary', { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 1, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 });
  api.allowUnmocked(...ACCOUNT_UNMOCKED);
  api.get('/me/repurchase-due', { item: ITEM });
}

const card = (page: Page) => page.getByRole('region', { name: 'Gợi ý mua lại' });

test.describe('Trước gửi duyệt: khói bản build Mini (www)', () => {
  test.beforeEach(() => {
    test.skip(!builtWww, 'Chỉ chạy bằng playwright.mini-www.config.ts trên apps/miniapp/www');
  });

  test('Trang chủ dựng được từ entry đã minify, thanh điều hướng có, mọi JS từ bản build, không lỗi trang', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const scripts = trackScripts(page);
    mockPilotProduct(api);
    api.allowUnmocked('GET /home', 'GET /home/me', 'GET /flash-sales/upcoming', 'POST /events');
    await page.goto(miniPath('/'));
    await expect(page.getByRole('region', { name: 'Danh mục' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: 'Trang chủ' })).toBeVisible();
    expect(scripts.some((s) => CHUNK('index').test(s.name)), 'entry index.<băm>.module.js').toBe(true);
    expect(scripts.some((s) => CHUNK('repurchase-due-card').test(s.name)), 'Trang chủ không nạp thẻ Mua lại').toBe(false);
    expectScriptsFromBuild(scripts);
    expect(errors).toEqual([]);
  });

  for (const [route, surface] of [
    ['/cart', 'Giỏ trống'],
    ['/profile', 'Cá nhân'],
  ] as const) {
    test(`${surface} (${route}): nạp chunk lười repurchase-due-card, thẻ Mua lại hiện gọn 375px, không lỗi trang`, async ({ page, api }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const scripts = trackScripts(page);
      signedIn(api, `u-ps-${route.slice(1)}`);
      await page.goto(miniPath(route));
      if (route === '/cart') await expect(page.getByText('Giỏ còn trống đấy')).toBeVisible({ timeout: 20_000 });
      await expect(card(page)).toBeVisible({ timeout: 20_000 });
      await expect(card(page)).toContainText('Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L');
      expect(scripts.filter((s) => CHUNK('repurchase-due-card').test(s.name))).toHaveLength(1);
      expectScriptsFromBuild(scripts);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      expect(errors).toEqual([]);
    });
  }
});
