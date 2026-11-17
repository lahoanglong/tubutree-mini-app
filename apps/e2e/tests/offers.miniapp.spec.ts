import type { Locator, Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { CATALOG, checkInStatus, mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockNoSession } from './support/flash-slot-mocks';
import { COLLECTABLE, mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';
import { hubPanel, hubTab, hubTabs, mockGardenStub, mockLoyaltyPreview, mockRewardsCatalog, pathAndSearch } from './support/offers-mocks';

/**
 * Zalo Mini App E2E — Ưu đãi (/offers): MỘT trang, ba tab đổi tại chỗ bằng ?tab= (replace). Săn mã (mặc định): Banner, Giờ vàng hôm nay, Nhận mã,
 * dải Điểm Xanh, dải điểm danh mỏng (điểm danh làm ở Vườn Xanh), Tiện ích. Mã của tôi: cả ví. Đổi quà: Kho quà tại chỗ + dải sang Điểm Xanh và Đổi rác.
 * Phần công khai (Giờ vàng, Nhận mã, Kho quà) khách chưa đăng nhập xem được, "Lưu mã" mở đăng nhập và KHÔNG gọi /coupons/claim. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;
const DAY = 86_400_000;

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

const regionTop = async (page: Page, name: string, exact = true) => (await page.getByRole('region', { name, exact }).boundingBox())!.y;

const STRIP_TODO = 'Hôm nay bạn chưa điểm danh';
const STRIP_DONE = 'Hôm nay bạn đã điểm danh';
const anyStrip = (page: Page) => page.getByRole('region', { name: /^Hôm nay bạn (chưa|đã) điểm danh$/ });

/** Khách chưa đăng nhập bấm `button` thì app phải gọi đăng nhập (guest/Zalo); chạm lúc phiên còn đang khôi phục bị bỏ qua nên bấm lại tới khi app đã ở trạng thái khách. */
async function expectLoginAttempt(api: MockApi, button: Locator): Promise<void> {
  const authCalls = () => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length;
  await expect.poll(authCalls, { timeout: 10_000 }).toBeGreaterThan(0);
  const before = authCalls();
  await expect(async () => {
    await button.click();
    expect(authCalls()).toBeGreaterThan(before);
  }).toPass({ timeout: 10_000 });
}

test.describe('Ưu đãi — khách chưa đăng nhập', () => {
  test('tab Săn mã: thấy Giờ vàng và Nhận mã; bấm Lưu mã mở đăng nhập, không gọi claim', async ({ page, api }) => {
    mockNoSession(api);
    mockFlash(api);
    mockCollectable(api);
    await page.goto('/offers');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible({ timeout: 15_000 });
    const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
    await expect(collect).toBeVisible();
    const save = collect.getByRole('button', { name: 'Lưu mã' });
    await expect(save).toHaveCount(3);
    // Phần cần tài khoản không dựng cho khách: một thẻ mời "Đăng nhập" thay dải Điểm Xanh + điểm danh. Mã của tôi, Đổi quà, thẻ điểm danh đầy đủ không còn trên tab này.
    await expect(page.getByRole('region', { name: 'Điểm Xanh của bạn' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Điểm Xanh và điểm danh', exact: true }).getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Đổi quà', exact: true })).toHaveCount(0);
    await expect(anyStrip(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Điểm danh mỗi ngày' })).toHaveCount(0);
    await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true');

    await expectLoginAttempt(api, save.first());
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });

  test('tab Mã của tôi: chỉ thẻ mời "Đăng nhập" (không Giờ vàng, Nhận mã), bấm thì gọi đăng nhập, không gọi API ví', async ({ page, api }) => {
    mockNoSession(api);
    mockFlash(api);
    mockCollectable(api);
    await page.goto('/offers?tab=wallet');
    const invite = page.getByRole('region', { name: 'Mã của tôi', exact: true });
    const login = invite.getByRole('button', { name: 'Đăng nhập', exact: true });
    await expect(login).toBeVisible({ timeout: 15_000 });
    await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toHaveCount(0);
    await expectLoginAttempt(api, login);
    expect(api.callsTo('GET', '/me/coupons')).toHaveLength(0);
  });

  test('tab Đổi quà: khách vẫn xem Kho quà, không có dải Điểm Xanh/Đổi rác (cần tài khoản)', async ({ page, api }) => {
    mockNoSession(api);
    mockLoyaltyPreview(api);
    await page.goto('/offers?tab=rewards');
    await expect(hubTab(page, 'Đổi quà')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(hubPanel(page, 'Đổi quà').getByText('Miễn phí vận chuyển').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Điểm Xanh của bạn' })).toHaveCount(0);
    await expect(page.getByText('Hạng và lịch sử điểm')).toHaveCount(0);
    await expect(page.getByText('Đổi rác lấy quà')).toHaveCount(0);
  });

  test('kho mã rỗng: không có khối Nhận mã', async ({ page, api }) => {
    mockNoSession(api);
    mockFlash(api);
    mockCollectable(api, []);
    await page.goto('/offers');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/coupons/collectable').length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('offers-collect-loading')).toHaveCount(0);
  });
});

test.describe('Ưu đãi — khách đã đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockFlash(api);
    mockCollectable(api);
    mockWallet(api);
    mockRewardsCatalog(api);
  });

  test.describe('thanh tab và đổi tab', () => {
    test('ba tab đúng thứ tự, mặc định Săn mã ở /offers; tab và tabpanel khớp tên; mỗi tab cao ≥ 44px', async ({ page }) => {
      await page.goto('/offers');
      await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect(hubTabs(page).getByRole('tab')).toHaveText(['Săn mã', 'Mã của tôi', 'Đổi quà']);
      await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'false');
      await expect(hubTab(page, 'Đổi quà')).toHaveAttribute('aria-selected', 'false');
      await expect(hubPanel(page, 'Săn mã')).toBeVisible();
      for (const name of ['Săn mã', 'Mã của tôi', 'Đổi quà']) {
        const box = (await hubTab(page, name).boundingBox())!;
        expect(box.height, `tab ${name} cao ${box.height}px`).toBeGreaterThanOrEqual(44);
      }
    });

    test('bấm tab: URL đổi đúng ?tab=, KHÔNG thêm mục lịch sử; Back rời trang Ưu đãi chứ không tua từng tab', async ({ page }) => {
      // Mở Trang chủ rồi mở Ưu đãi bằng tải trang (mục lịch sử thật): Back phải về Trang chủ dù đã bấm cả ba tab.
      await page.goto('/');
      await expect(page.getByRole('button', { name: /^Ưu đãi/ })).toBeVisible({ timeout: 15_000 });
      await page.goto('/offers');
      await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      const length = await page.evaluate(() => window.history.length);

      await hubTab(page, 'Mã của tôi').click();
      await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=wallet');
      await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
      await expect(hubPanel(page, 'Mã của tôi')).toBeVisible();

      await hubTab(page, 'Đổi quà').click();
      await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=rewards');
      await expect(hubTab(page, 'Đổi quà')).toHaveAttribute('aria-selected', 'true');
      await expect(hubPanel(page, 'Đổi quà')).toBeVisible();

      // Tab mặc định không kèm tham số để link chia sẻ gọn.
      await hubTab(page, 'Săn mã').click();
      await expect.poll(() => pathAndSearch(page)).toBe('/offers');
      await expect(hubPanel(page, 'Săn mã')).toBeVisible();

      expect(await page.evaluate(() => window.history.length), 'đổi tab đã thêm mục lịch sử').toBe(length);
      await page.goBack();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    });

    test('link cũ ?section=coupons mở thẳng tab Mã của tôi (cả ví, giữ nguyên URL)', async ({ page }) => {
      await page.goto('/offers?section=coupons');
      await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect(hubPanel(page, 'Mã của tôi')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true }).getByRole('group')).toHaveCount(2, { timeout: 15_000 });
      await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
      expect(pathAndSearch(page)).toBe('/offers?section=coupons');
    });

    test('?tab= lạ về Săn mã', async ({ page }) => {
      await page.goto('/offers?tab=claim');
      await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible();
    });

    for (const [path, tab] of [['/offers', 'Săn mã'], ['/offers?tab=wallet', 'Mã của tôi'], ['/offers?tab=rewards', 'Đổi quà']] as const) {
      test(`${path}: là tab gốc của thanh đáy nên không có nút "Quay lại"`, async ({ page }) => {
        await page.goto(path);
        await expect(hubTab(page, tab)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
        await expect(hubPanel(page, tab)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Quay lại' })).toHaveCount(0);
      });
    }
  });

  test.describe('tab Săn mã', () => {
    test('thứ tự khối: Giờ vàng, Nhận mã, Điểm Xanh, dải điểm danh, Tiện ích; không còn Mã của tôi, Kho quà, thẻ điểm danh đầy đủ', async ({ page }) => {
      await page.goto('/offers');
      await expect(page.getByRole('region', { name: STRIP_TODO, exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible();
      const ys = [
        await regionTop(page, 'Giờ vàng hôm nay'),
        await regionTop(page, 'Nhận mã'),
        await regionTop(page, 'Điểm Xanh của bạn'),
        await regionTop(page, STRIP_TODO),
        await regionTop(page, 'Tiện ích'),
      ];
      ys.forEach((y, i) => {
        if (i > 0) expect(y, `khối ${i} không nằm dưới khối ${i - 1}: ${ys.join(' < ')}`).toBeGreaterThan(ys[i - 1]!);
      });
      await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Đổi quà', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Điểm danh mỗi ngày' })).toHaveCount(0);
      await expect(page.getByTestId('daily-check-in')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Điểm danh', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Quà của tôi' })).toHaveCount(0);
      await expect(page.getByText('Đổi rác lấy quà')).toHaveCount(0);
    });

    for (const checkedIn of [false, true]) {
      test(`dải điểm danh mỏng khi ${checkedIn ? 'đã điểm danh' : 'chưa điểm danh'}: chữ phụ "Mở tab Vườn Xanh", một hàng cao ≤ 96px, không có nút điểm danh`, async ({ page, api }) => {
        mockHomeEngagement(api, { checkedIn });
        await page.goto('/offers');
        const strip = page.getByRole('region', { name: checkedIn ? STRIP_DONE : STRIP_TODO, exact: true });
        await expect(strip).toBeVisible({ timeout: 15_000 });
        await expect(anyStrip(page)).toHaveCount(1);
        await expect(strip.getByText('Mở tab Vườn Xanh')).toBeVisible();
        await expect(strip.getByRole('button')).toHaveCount(1);
        const h = Math.round((await strip.boundingBox())!.height);
        expect(h, `dải điểm danh cao ${h}px`).toBeLessThanOrEqual(96);
        const row = (await strip.getByRole('button').boundingBox())!;
        expect(row.height, `hàng chạm cao ${row.height}px`).toBeGreaterThanOrEqual(44);
        await expect(page.getByRole('button', { name: 'Điểm danh', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Luật điểm danh' })).toHaveCount(0);
        expect(api.callsTo('POST', '/me/daily-check-in')).toHaveLength(0);
      });
    }

    test('dải điểm danh cao như nhau ở hai trạng thái (đổi trạng thái không làm khối nào lệch chiều cao)', async ({ page, api }) => {
      const heights: number[] = [];
      for (const checkedIn of [false, true]) {
        mockHomeEngagement(api, { checkedIn });
        await page.goto('/offers');
        const strip = page.getByRole('region', { name: checkedIn ? STRIP_DONE : STRIP_TODO, exact: true });
        await expect(strip).toBeVisible({ timeout: 15_000 });
        heights.push((await strip.boundingBox())!.height);
      }
      expect(heights[1]!, `chưa ${heights[0]}px, đã ${heights[1]}px`).toBeCloseTo(heights[0]!, 0);
    });

    for (const checkedIn of [false, true]) {
      test(`dải điểm danh ${checkedIn ? 'đã điểm danh' : 'chưa điểm danh'} về muộn: không vẽ khung chờ hay lỗi lúc chờ, các khối phía trên (Giờ vàng, Nhận mã, Điểm Xanh) đứng nguyên`, async ({ page, api }) => {
        let release!: () => void;
        let asked = false;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        mockHomeEngagement(api, { checkedIn });
        api.get('/me/daily-check-in', async () => {
          asked = true;
          await hold;
          return checkInStatus(checkedIn);
        });
        await page.goto('/offers');
        await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('region', { name: 'Điểm Xanh của bạn' })).toBeVisible();
        await expect(page.getByTestId('offers-collect-loading')).toHaveCount(0);
        // Lời gọi đã tới máy chủ mock nhưng đang bị giữ (mock chỉ ghi nhật ký sau khi trả lời).
        await expect.poll(() => asked, { timeout: 10_000 }).toBe(true);
        // Dải chưa có dữ liệu thì không vẽ gì: không khung chờ, không thông báo lỗi.
        await expect(anyStrip(page)).toHaveCount(0);
        await expect(page.getByText('Mở tab Vườn Xanh')).toHaveCount(0);
        const flashY = await regionTop(page, 'Giờ vàng hôm nay');
        const collectY = await regionTop(page, 'Nhận mã');
        const pointsY = await regionTop(page, 'Điểm Xanh của bạn');
        release();
        await expect(page.getByRole('region', { name: checkedIn ? STRIP_DONE : STRIP_TODO, exact: true })).toBeVisible({ timeout: 15_000 });
        expect(await regionTop(page, 'Giờ vàng hôm nay'), 'Giờ vàng bị đẩy khi dải về').toBeCloseTo(flashY, 0);
        expect(await regionTop(page, 'Nhận mã'), 'Nhận mã bị đẩy khi dải về').toBeCloseTo(collectY, 0);
        expect(await regionTop(page, 'Điểm Xanh của bạn'), 'Điểm Xanh bị đẩy khi dải về').toBeCloseTo(pointsY, 0);
      });
    }

    test('bấm dải điểm danh mở tab Vườn Xanh (/game), không gọi POST điểm danh', async ({ page, api }) => {
      mockGardenStub(api);
      await page.goto('/offers');
      const strip = page.getByRole('region', { name: STRIP_TODO, exact: true });
      await expect(strip).toBeVisible({ timeout: 15_000 });
      await strip.getByRole('button').click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/game');
      expect(api.callsTo('POST', '/me/daily-check-in')).toHaveLength(0);
    });

    test('320px: dải điểm danh, thanh tab và cả trang không tràn ngang', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 812 });
      await page.goto('/offers');
      const strip = page.getByRole('region', { name: STRIP_TODO, exact: true });
      await expect(strip).toBeVisible({ timeout: 15_000 });
      for (const [name, box] of [
        ['dải điểm danh', (await strip.getByRole('button').boundingBox())!],
        ['thanh tab', (await hubTabs(page).boundingBox())!],
      ] as const) {
        expect(box.x, name).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, name).toBeLessThanOrEqual(320.5);
      }
      expect(await strip.getByRole('button').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'chữ dải điểm danh tràn khỏi hàng').toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('mã đã có trong ví không chiếm chỗ ở Nhận mã; Lưu mã gọi POST /coupons/claim đúng mã', async ({ page, api }) => {
      api.post('/coupons/claim', ({ call }) => {
        const code = (call.body as { code: string }).code;
        const c = COLLECTABLE.find((x) => x.code === code)!;
        return { code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount, endAt: c.endAt, newCustomerOnly: false, alreadyClaimed: false };
      });
      await page.goto('/offers');
      const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
      await expect(collect).toBeVisible({ timeout: 15_000 });
      // KM30K đã nằm trong ví (voucher-mocks) nên chỉ còn hai mã nhận được.
      const save = collect.getByRole('button', { name: 'Lưu mã' });
      await expect(save).toHaveCount(2);
      await save.first().click();
      await expect.poll(() => api.callsTo('POST', '/coupons/claim').length).toBe(1);
      expect(api.callsTo('POST', '/coupons/claim')[0]!.body).toEqual({ code: 'FS99' });
    });

    test('"Tất cả (n)" của Nhận mã mở cả kho ngay tại chỗ (URL không đổi), "Thu gọn" về như cũ; không còn "Tất cả (n)" của Mã của tôi ở tab này', async ({ page }) => {
      await page.goto('/offers');
      const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
      await expect(collect).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /^Tất cả \(\d+\) Mã của tôi$/ })).toHaveCount(0);
      await page.getByRole('button', { name: /^Tất cả \(\d+\) Mã giảm giá$/ }).click();
      // Kho mở cả: thêm mã đã lưu ("Dùng ngay") và chip lọc; vẫn ở /offers, Giờ vàng vẫn trên trang.
      await expect(collect.getByRole('button', { name: 'Dùng ngay' })).toHaveCount(1);
      await expect(collect.getByRole('button', { name: 'Tất cả', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(pathAndSearch(page)).toBe('/offers');
      await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible();
      await collect.getByRole('button', { name: 'Thu gọn' }).click();
      await expect(collect.getByRole('button', { name: 'Dùng ngay' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Tất cả \(\d+\) Mã giảm giá$/ })).toBeVisible();
    });
  });

  test.describe('tab Mã của tôi', () => {
    test('ví 8 mã: xếp CẢ 8 phiếu (không cắt ở 3), mỗi phiếu có "Dùng ngay", không còn nút "Tất cả (n)"; hàng "Mã đã dùng, hết hạn" nằm cuối', async ({ page, api }) => {
      mockWallet(
        api,
        Array.from({ length: 8 }, (_, i) => ({ code: `MA${i}`, title: null, type: 'AMOUNT' as const, value: 10_000 * (i + 1), minOrder: 100_000, maxDiscount: null, endAt: new Date(Date.now() + (i + 3) * DAY).toISOString() })),
      );
      await page.goto('/offers?tab=wallet');
      const mine = page.getByRole('region', { name: 'Mã của tôi', exact: true });
      await expect(mine.getByRole('group')).toHaveCount(8, { timeout: 15_000 });
      await expect(mine.getByRole('button', { name: 'Dùng ngay' })).toHaveCount(8);
      await expect(page.getByRole('button', { name: /^Tất cả/ })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
      const last = (await mine.getByRole('group').last().boundingBox())!;
      const history = (await mine.getByText('Mã đã dùng, hết hạn').boundingBox())!;
      expect(history.y, 'hàng lịch sử phải nằm dưới phiếu cuối').toBeGreaterThan(last.y + last.height - 1);
    });

    test('hàng "Mã đã dùng, hết hạn" mở lịch sử ngay tại chỗ (URL không đổi, vẫn tab Mã của tôi)', async ({ page, api }) => {
      mockCouponHistory(api);
      await page.goto('/offers?tab=wallet');
      const mine = page.getByRole('region', { name: 'Mã của tôi', exact: true });
      await expect(mine.getByRole('group')).toHaveCount(2, { timeout: 15_000 });
      await page.getByRole('button', { name: 'Mã đã dùng, hết hạn' }).click();
      await expect(page.getByRole('button', { name: 'Mã đã dùng, hết hạn' })).toHaveAttribute('aria-expanded', 'true');
      await expect(mine.getByRole('group')).toHaveCount(4);
      expect(pathAndSearch(page)).toBe('/offers?tab=wallet');
      await expect(hubTab(page, 'Mã của tôi')).toHaveAttribute('aria-selected', 'true');
    });

    test('ví trống: trạng thái rỗng, nút "Nhận thêm mã" về tab Săn mã (URL /offers), hàng lịch sử vẫn có', async ({ page, api }) => {
      mockWallet(api, []);
      await page.goto('/offers?tab=wallet');
      await expect(page.getByText('Chưa có mã giảm giá khả dụng')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Mã đã dùng, hết hạn')).toBeVisible();
      await page.getByRole('button', { name: 'Nhận thêm mã' }).click();
      await expect.poll(() => pathAndSearch(page)).toBe('/offers');
      await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('tab Đổi quà', () => {
    test('nạp Kho quà tại chỗ (có hàng "Quà của tôi") kèm dải Điểm Xanh (hạng, lịch sử điểm); không còn Giờ vàng, Nhận mã, dải điểm danh', async ({ page }) => {
      await page.goto('/offers?tab=rewards');
      const panel = hubPanel(page, 'Đổi quà');
      await expect(panel.getByRole('button', { name: 'Quà của tôi' })).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByText('Miễn phí vận chuyển').first()).toBeVisible();
      const points = page.getByRole('region', { name: 'Điểm Xanh của bạn', exact: true });
      await expect(points.getByText('Hạng và lịch sử điểm')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toHaveCount(0);
      await expect(anyStrip(page)).toHaveCount(0);
      // Chương trình Đổi rác tắt (mặc định mock) và khách không còn yêu cầu mở: không có hàng Đổi rác.
      await expect(page.getByText('Đổi rác lấy quà')).toHaveCount(0);
      // Kho quà nằm trên dải Điểm Xanh.
      const kho = (await panel.getByRole('button', { name: 'Quà của tôi' }).boundingBox())!;
      const pts = (await points.boundingBox())!;
      expect(pts.y, 'dải Điểm Xanh phải nằm dưới Kho quà').toBeGreaterThan(kho.y);
    });

    test('hàng "Hạng và lịch sử điểm" mở trang Điểm Xanh (/loyalty), "Quay lại" lùi về tab Đổi quà', async ({ page, api }) => {
      api.get('/waste/requests', []);
      api.get('/me/points/transactions', []);
      api.allowUnmocked('GET /me/loyalty/member-card', 'POST /events');
      await page.goto('/offers?tab=rewards');
      await page.getByRole('region', { name: 'Điểm Xanh của bạn', exact: true }).getByText('Hạng và lịch sử điểm').click({ timeout: 15_000 });
      await expect.poll(() => new URL(page.url()).pathname).toBe('/loyalty');
      await page.getByRole('button', { name: 'Quay lại' }).click();
      await expect.poll(() => pathAndSearch(page)).toBe('/offers?tab=rewards');
    });

    test('chương trình Đổi rác bật: có hàng "Đổi rác lấy quà" ngay dưới hàng Điểm Xanh', async ({ page, api }) => {
      api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: false, pickup: false } }));
      await page.goto('/offers?tab=rewards');
      const points = page.getByRole('region', { name: 'Điểm Xanh của bạn', exact: true });
      const recycle = points.getByText('Đổi rác lấy quà');
      await expect(recycle).toBeVisible({ timeout: 15_000 });
      const a = (await points.getByText('Hạng và lịch sử điểm').boundingBox())!;
      const b = (await recycle.boundingBox())!;
      expect(b.y).toBeGreaterThan(a.y);
    });
  });

  for (const [path, tab] of [['/offers', 'Săn mã'], ['/offers?tab=wallet', 'Mã của tôi'], ['/offers?tab=rewards', 'Đổi quà']] as const) {
    test(`320px, tab ${tab}: cả trang và thanh tab không tràn ngang`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 812 });
      await page.goto(path);
      await expect(hubTab(page, tab)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect(hubPanel(page, tab)).toBeVisible();
      await expect(hubPanel(page, tab).locator('[role="group"], [role="region"], section, button').first()).toBeVisible({ timeout: 15_000 });
      const tabs = (await hubTabs(page).boundingBox())!;
      expect(tabs.x).toBeGreaterThanOrEqual(0);
      expect(tabs.x + tabs.width).toBeLessThanOrEqual(320.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'trang tràn ngang').toBe(true);
    });
  }
});
