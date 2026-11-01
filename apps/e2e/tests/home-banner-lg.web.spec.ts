import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { campaignBanner, mockCampaigns } from './support/campaign-mocks';
import { serverWithoutCampaigns } from './support/server-initial';

/**
 * Web, Trang chủ: khách có cookie phiên, máy chưa nhớ loại khách (HTML dựng sẵn "chưa biết") và nhớ "lần trước có banner". Trong lúc phiên chưa về và
 * banner chưa về, khung giữ chỗ banner phải đứng đúng chỗ của banner thật: từ lg là cột 8 cạnh thẻ thành viên (HubLayout), dưới lg ngay dưới thẻ thành
 * viên; chỉ có MỘT khung ở mỗi khổ; banner về không làm trang nhảy.
 *
 * Danh sách chiến dịch phải đến từ trình duyệt (mock). API thật trả mảng (kể cả rỗng) thì server đã đưa nó vào HTML và trình duyệt không hỏi lại, nên spec chặn
 * tài liệu `/` và gỡ danh sách đó khỏi dữ liệu RSC (support/server-initial.ts): điều kiện dữ liệu chắc chắn có, không phụ thuộc API đang chạy trả gì, và
 * spec không bao giờ tự bỏ qua. Dịch chuyển lúc hydrate vì gợi ý banner chỉ đọc được ở máy khách (HTML server chưa biết) nằm ngoài phạm vi: số đo là
 * phần tăng của CLS từ lúc khung giữ chỗ hiện tới khi banner về.
 */

const me = () => ({
  id: 'u1', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123',
  onboarded: true, segments: [], pointsBalance: 120, pointsConvertedBalance: 0, walletBalance: 50000,
});

/** Mở Trang chủ như khách có phiên cũ trên máy chưa nhớ loại khách (phiên về chậm, banner giữ tới khi `release`). */
async function openHome(page: Page, api: MockApi, baseURL: string): Promise<() => void> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.post('/auth/refresh', async () => {
    await new Promise((r) => setTimeout(r, 900));
    return { accessToken: 'e2e-token', user: me() };
  });
  api.get('/me', () => me());
  const item = { variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' };
  api.get('/me/purchased-items', async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { items: [item], nextCursor: null };
  });
  api.get('/config/public', {
    freeshipThreshold: 350_000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, cashbackHoldDays: 30,
    waste: { enabled: false, dropoff: false, mailin: false, pickup: false },
    newCustomer: { welcomeVoucher: { amount: 25_000, minOrder: 150_000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
    loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
  });
  api.get('/me/new-customer-offer', { isNewCustomer: true, welcomeVoucher: { code: 'WELCOME-U1', type: 'AMOUNT', value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' } });
  api.allowUnmocked('POST /events', 'GET /products/for-you', 'GET /me/wishlist/ids', 'GET /flash-sales/upcoming', 'GET /flash-sales/active', 'GET /orders/active-count', 'GET /me/orders/active', 'GET /products', 'GET /categories', 'GET /brands', 'GET /me/subscriptions', 'GET /orders', 'GET /home', 'GET /home/me');
  mockCampaigns(api, { home: [campaignBanner('thu', { title: 'Giữa Thu' })], hold });
  // Cookie phiên + gợi ý "chưa biết loại khách": middleware chọn bản dựng sẵn cho khách có phiên, HTML đầu đã mang khung chờ.
  await page.context().addCookies([
    { name: 'tubu_web_session', value: '1', url: baseURL },
    { name: 'tubu_home_hint', value: 'unknown', url: baseURL },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
      localStorage.setItem('tubu_home_banner', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có gợi ý banner
    }
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; startTime: number; sources?: { node?: Node; previousRect: DOMRect; currentRect: DOMRect }[] }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const where = (e.sources ?? []).map((x) => {
          const el = x.node instanceof Element ? x.node : x.node?.parentElement;
          return `${el?.closest('[data-home-block]')?.getAttribute('data-home-block') ?? el?.nodeName} x${Math.round(x.previousRect.x)}->${Math.round(x.currentRect.x)} y${Math.round(x.previousRect.y)}->${Math.round(x.currentRect.y)}`;
        });
        w.__shifts.push(`${e.value.toFixed(4)} @${Math.round(e.startTime)}ms ${where.join(' | ')}`);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const server = await serverWithoutCampaigns(page);
  // Câu trả lời đang bị giữ nên mock chưa ghi lời gọi: nhìn thẳng yêu cầu mạng của trình duyệt.
  const campaignRequest = page.waitForRequest((r) => r.url().includes('/campaigns') && r.url().includes('HOME_TOP'), { timeout: 40_000 });
  campaignRequest.catch(() => undefined);
  // Yêu cầu khôi phục phiên chỉ đi khi mã máy khách đã chạy: từ đó gợi ý banner (chỉ có ở máy khách) đã đọc xong.
  const hydrated = page.waitForRequest((r) => r.url().includes('/auth/refresh'), { timeout: 30_000 });
  hydrated.catch(() => undefined);
  await page.goto('/');
  await hydrated;
  expect(server.found(), 'HTML của "/" phải mang khoá campaigns trong dữ liệu RSC (dạng nhúng đổi thì sửa support/server-initial.ts)').toBeGreaterThan(0);
  // Server không còn danh sách chiến dịch nên trình duyệt tự hỏi; mock giữ câu trả lời tới khi `release`.
  await campaignRequest;
  return release;
}

const cls = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    return { value: w.__cls, detail: w.__shifts.join(' | ') };
  });

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test.describe('Web Trang chủ, phiên chưa về, máy nhớ lần trước có banner', () => {
  test('từ lg: khung giữ chỗ banner ở cột 8 cạnh thẻ thành viên, banner thật về đúng chỗ đó và trang không nhảy thêm (CLS tăng < 0,01)', async ({ page, api, baseURL }) => {
    test.skip(test.info().project.name !== 'Web Customer', 'chỉ đo ở khổ máy tính');
    await page.setViewportSize({ width: 1280, height: 800 });
    const release = await openHome(page, api, baseURL!);
    // Khung chờ chung còn đó (tối đa 4,5 s, hoặc tới khi dữ liệu về): khung giữ chỗ banner phải thấy được NGAY trong lúc đó, không đợi hết chờ.
    await expect(page.getByTestId('home-settling')).toBeVisible({ timeout: 15_000 });
    const placeholder = page.getByTestId('home-banner-loading');
    await expect(placeholder).toBeVisible({ timeout: 2_000 });
    await expect(placeholder).toHaveCount(1);
    const hold = (await placeholder.boundingBox())!;
    const hub = await box(page, '[data-testid="hub-layout"]');
    const member = await box(page, '[data-home-block="member"]');
    // Cột 8 trên lưới 12 cột: rộng hơn 60% lưới, sát mép trái lưới, cùng hàng với thẻ thành viên và nằm bên trái nó.
    expect(Math.abs(hold.x - hub.x)).toBeLessThanOrEqual(1);
    expect(hold.width).toBeGreaterThan(hub.width * 0.6);
    expect(hold.x + hold.width).toBeLessThanOrEqual(member.x);
    expect(Math.abs(hold.y - member.y)).toBeLessThanOrEqual(1);
    await page.waitForTimeout(300);
    const before = (await cls(page)).value;

    release();
    const banner = page.getByRole('region', { name: 'Chương trình nổi bật' });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('home-banner-loading')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const real = (await banner.boundingBox())!;
    expect(Math.abs(real.x - hold.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(real.y - hold.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(real.height - hold.height)).toBeLessThanOrEqual(2);
    const after = await cls(page);
    expect(after.value - before, `CLS +${(after.value - before).toFixed(4)}: ${after.detail}`).toBeLessThan(0.01);
  });

  test('dưới lg (điện thoại): chỉ MỘT khung giữ chỗ banner, ngay dưới thẻ thành viên; banner về không nhảy thêm', async ({ page, api, baseURL }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    await page.setViewportSize({ width: 375, height: 812 });
    const release = await openHome(page, api, baseURL!);
    await expect(page.getByTestId('home-settling')).toBeVisible({ timeout: 15_000 });
    const placeholder = page.getByTestId('home-banner-loading');
    await expect(placeholder).toBeVisible({ timeout: 2_000 });
    await expect(placeholder).toHaveCount(1);
    const hold = (await placeholder.boundingBox())!;
    const member = await box(page, '[data-home-block="member"]');
    expect(hold.y).toBeGreaterThanOrEqual(member.y + member.height);
    expect(hold.y - (member.y + member.height)).toBeLessThanOrEqual(24);
    await page.waitForTimeout(300);
    const before = (await cls(page)).value;

    release();
    const banner = page.getByRole('region', { name: 'Chương trình nổi bật' });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('home-banner-loading')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const real = (await banner.boundingBox())!;
    expect(Math.abs(real.y - hold.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(real.height - hold.height)).toBeLessThanOrEqual(2);
    const after = await cls(page);
    expect(after.value - before, `CLS +${(after.value - before).toFixed(4)}: ${after.detail}`).toBeLessThan(0.01);
  });
});
