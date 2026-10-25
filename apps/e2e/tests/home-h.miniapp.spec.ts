import type { Locator, Page } from '@playwright/test';
import { test, expect, E2E_TOKENS, makeUser } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { BINH_SUA, mockDiscovery, mockHomeEngagement, toCard } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — gói H sau review: không nhảy bố cục ở Trang chủ, chấm đỏ Ưu đãi nhớ đã xem, Cộng đồng, vùng chạm chip.
 * API mock toàn bộ; không dùng waitForTimeout.
 */

const gateOf = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};

async function expectChipHitArea44(chip: Locator): Promise<void> {
  const box = (await chip.boundingBox())!;
  const hit = await chip.evaluate(
    (el, b) => {
      const x = b.x + b.width / 2;
      const at = (y: number) => document.elementFromPoint(x, y)?.closest('button') === el;
      return { above3: at(b.y - 3), below3: at(b.y + b.height + 3), inside: at(b.y + b.height / 2) };
    },
    { x: box.x, y: box.y, width: box.width, height: box.height },
  );
  expect(hit).toEqual({ above3: true, below3: true, inside: true });
}

async function blocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.homeBlock!),
  );
}

test.describe('Trang chủ — không nhảy bố cục', () => {
  test('lần đầu chưa biết loại khách: khung chờ trung tính ở chỗ thẻ thành viên, không dựng bố cục khách mới', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    const gate = gateOf();
    api.get('/me/purchased-items', async () => {
      await gate.promise;
      return PURCHASED_PAGE;
    });
    await page.goto('/');
    await expect(page.getByTestId('member-card-loading')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Bán chạy' })).toHaveCount(0);
    expect(await blocks(page)).not.toContain('bestSellers');
    gate.open();
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bán chạy' })).toHaveCount(0);
  });

  test('thẻ thành viên: khung chờ cao bằng thẻ thật; thanh tiến độ giữ chỗ nên /me/loyalty về không đẩy gì', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
    });
    const gate = gateOf();
    api.get('/me/loyalty', async () => {
      await gate.promise;
      return {
        tier: { id: 't1', name: 'Hạt Giống', multiplier: 1, perks: null }, pointsBalance: 1800, pointsConvertedBalance: 0, tierPoints: 1800,
        tiers: [{ id: 't1', name: 'Hạt Giống', minPoints: 0, multiplier: 1 }, { id: 't2', name: 'Mầm Xanh', minPoints: 3000, multiplier: 1.2 }],
        nextTier: { id: 't2', name: 'Mầm Xanh', minPoints: 3000, pointsToGo: 1200 },
      };
    });
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Thẻ thành viên' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const categories = page.getByRole('region', { name: 'Danh mục', exact: true });
    await expect(categories).toBeVisible({ timeout: 15_000 });
    const before = { card: (await card.boundingBox())!.height, below: (await categories.boundingBox())!.y };
    gate.open();
    await expect(card).toContainText('1.800', { timeout: 15_000 });
    const after = { card: (await card.boundingBox())!.height, below: (await categories.boundingBox())!.y };
    expect(Math.abs(after.card - before.card), `thẻ cao ${before.card}px → ${after.card}px`).toBeLessThanOrEqual(2);
    expect(Math.abs(after.below - before.below), `Danh mục dịch ${before.below}px → ${after.below}px`).toBeLessThanOrEqual(2);
  });

  test('khung chờ thẻ thành viên (lần đầu, chưa biết loại) cao bằng thẻ thật (≤ 4px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    const gate = gateOf();
    api.get('/me/purchased-items', async () => {
      await gate.promise;
      return PURCHASED_PAGE;
    });
    await page.goto('/');
    const skeleton = page.getByTestId('member-card-loading');
    await expect(skeleton).toBeVisible({ timeout: 15_000 });
    const skelH = (await skeleton.boundingBox())!.height;
    gate.open();
    const card = page.getByRole('region', { name: 'Thẻ thành viên' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('member-card-loading')).toHaveCount(0);
    const cardH = (await card.boundingBox())!.height;
    expect(Math.abs(skelH - cardH), `khung chờ ${skelH}px vs thẻ ${cardH}px`).toBeLessThanOrEqual(4);
  });
});

test.describe('Trang chủ — thẻ thành viên tên dài', () => {
  test('tên rất dài cắt "…" trên một dòng: thẻ cao bằng thẻ tên ngắn (≤ 2px) và không tràn ngang', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    api.get('/me/loyalty', {
      tier: { id: 't1', name: 'Hạt Giống', multiplier: 1, perks: null }, pointsBalance: 1800, pointsConvertedBalance: 0, tierPoints: 1800,
      tiers: [{ id: 't1', name: 'Hạt Giống', minPoints: 0, multiplier: 1 }, { id: 't2', name: 'Mầm Xanh', minPoints: 3000, multiplier: 1.2 }],
      nextTier: { id: 't2', name: 'Mầm Xanh', minPoints: 3000, pointsToGo: 1200 },
    });
    const heights: number[] = [];
    for (const name of ['An', 'Nguyễn Thị Phương Thảo Nguyên Vũ Khánh Linh Trần Gia Bảo']) {
      api.post('/auth/refresh', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.post('/auth/guest', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.post('/auth/zalo-mini-app', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.get('/me', { id: 'user-4b', fullName: name, email: null, avatarUrl: null, dob: null, onboarded: true, segments: [] });
      await page.goto('/');
      const card = page.getByRole('region', { name: 'Thẻ thành viên' });
      await expect(card).toContainText('1.800', { timeout: 15_000 });
      await expect(card).toContainText('Còn 1.200');
      await expect(card).toContainText(name);
      heights.push((await card.boundingBox())!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    expect(Math.abs(heights[1]! - heights[0]!), `thẻ tên ngắn ${heights[0]}px vs tên dài ${heights[1]}px`).toBeLessThanOrEqual(2);
  });
});

test.describe('Trang chủ — khôi phục phiên chậm', () => {
  test('khách cũ đã nhớ "returning", /auth/* chậm 3s: Danh mục không xê dịch từ lúc đầu tới sau đăng nhập (≤ 2px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true, shipping: true });
    const login = { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: 'Khách Khám Phá' }) };
    for (const path of ['/auth/guest', '/auth/zalo-mini-app', '/auth/refresh']) {
      api.post(path, async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return login;
      });
    }
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
      localStorage.setItem('tubu_home_todo_rows', JSON.stringify({ userId: 'user-4b', rows: 1 }));
    });
    await page.goto('/');
    const categories = page.getByRole('region', { name: 'Danh mục', exact: true });
    await expect(categories).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('member-card-loading')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Bán chạy', exact: true })).toHaveCount(0);
    const before = (await categories.boundingBox())!.y;
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('todo-strip-loading')).toHaveCount(0);
    const after = (await categories.boundingBox())!.y;
    expect(Math.abs(after - before), `Danh mục ${before}px → ${after}px`).toBeLessThanOrEqual(2);
  });
});

test.describe('Trang chủ — chấm đỏ Ưu đãi và Cộng đồng', () => {
  test('chưa điểm danh + mã sắp hết hạn: có chấm đỏ và khối Cộng đồng; mở Ưu đãi thì mã đã xem nhưng chưa điểm danh vẫn còn chấm', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api, { checkedIn: false, expiringInDays: 2 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Cộng đồng' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Ưu đãi/ }).click();
    await expect(page.getByRole('heading', { name: /Ưu đãi/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sắp hết hạn').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toBeVisible();
  });

  test('đã điểm danh + mã sắp hết hạn: mở Ưu đãi xong thì chấm đỏ tắt, tải lại vẫn tắt', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api, { checkedIn: true, expiringInDays: 2 });
    await page.goto('/');
    await expect(page.getByTestId('offers-dot')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Ưu đãi/ }).click();
    await expect(page.getByText('Sắp hết hạn').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Cộng đồng' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toHaveCount(0);
  });
});

test.describe('Trang chủ — vùng chạm 44px', () => {
  test('chip dải thương hiệu và tab gợi ý cao dưới 44px nhưng vùng chạm phủ đủ 44px', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true, forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    const journey = page.getByRole('region', { name: 'Hành trình nguyên liệu' });
    await expect(journey).toBeVisible({ timeout: 15_000 });
    const brandChip = journey.getByRole('region', { name: /Dải thương hiệu/ }).getByRole('button').first();
    await brandChip.scrollIntoViewIfNeeded();
    await expectChipHitArea44(brandChip);
    const tab = page.getByRole('region', { name: 'Nguồn gợi ý' }).getByRole('button', { name: 'Bán chạy', exact: true });
    await tab.scrollIntoViewIfNeeded();
    await expectChipHitArea44(tab);
  });
});

test.describe('Đổi rác tạm dừng nhưng còn yêu cầu đang mở', () => {
  test('Trang chủ và Ưu đãi giữ lối vào "Yêu cầu của tôi" nhờ endpoint đếm nhẹ, không gọi /waste/me', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    api.get('/waste/me/open-count', { count: 2 });
    await page.goto('/');
    await expect(page.getByText('Yêu cầu của tôi', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/offers');
    await expect(page.getByText('Yêu cầu của tôi', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/waste/me/open-count').length).toBeGreaterThan(0);
    expect(api.callsTo('GET', '/waste/me')).toHaveLength(0);
  });

  test('không còn yêu cầu nào: không có lối vào', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    api.get('/waste/me/open-count', { count: 0 });
    await page.goto('/');
    await expect.poll(() => api.callsTo('GET', '/waste/me/open-count').length).toBeGreaterThan(0);
    await expect(page.getByText('Yêu cầu của tôi', { exact: true })).toHaveCount(0);
  });
});

test.describe('Kệ Mua lại: nhãn Định kỳ đủ chữ, thẻ cao như nhau', () => {
  for (const width of [375, 320]) {
    test(`${width}px: "Định kỳ -17%" không bị cắt; tên ngắn và tên dài cho thẻ cao bằng nhau (≤ 1px)`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      const heights: number[] = [];
      for (const name of ['An', 'Nước Rửa Chén Sinh Học Tubu Hương Chanh Gừng Loại Đậm Đặc 500ml Chai Lớn']) {
        mockDiscovery(api, { returning: true });
        api.get('/config/public', { freeshipThreshold: 200000, subscribeDiscountPct: 0.17, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } } as never);
        api.get('/me/purchased-items', { items: [{ ...PURCHASED_PAGE.items[0]!, productName: name }], nextCursor: null });
        await page.goto('/');
        const card = page.getByRole('region', { name: 'Mua lại' });
        await expect(card).toBeVisible({ timeout: 15_000 });
        const subscribe = card.getByRole('button', { name: 'Định kỳ -17%' });
        await expect(subscribe).toBeVisible();
        const clipped = await subscribe.evaluate((el) => {
          const label = el.querySelector('.zaui-btn-container > span') as HTMLElement | null;
          return label ? label.scrollWidth > label.clientWidth : true;
        });
        expect(clipped, `nhãn Định kỳ bị cắt ở ${width}px`).toBe(false);
        heights.push((await card.boundingBox())!.height);
      }
      expect(Math.abs(heights[1]! - heights[0]!), `thẻ tên ngắn ${heights[0]}px vs tên dài ${heights[1]}px`).toBeLessThanOrEqual(1);
    });
  }
});
