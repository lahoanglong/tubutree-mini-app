import type { Page } from '@playwright/test';
import { test, expect, E2E_TOKENS, makeUser } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { expectChipHitArea44 } from './support/hit-area';
import { BRAND_BAR } from './support/home-brands';
import { hubTab, mockRewardsCatalog } from './support/offers-mocks';

/**
 * Zalo Mini App E2E — gói H sau review: không nhảy bố cục ở Trang chủ, chấm đỏ Ưu đãi nhớ đã xem, vùng chạm chip.
 * API mock toàn bộ; không dùng waitForTimeout.
 */

const gateOf = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};

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
    // Khối chỉ khách mới có là "Quà khách mới" (welcome); "Bán chạy nhất" giờ có ở cả hai bố cục (Q18) nên không còn là dấu hiệu.
    expect(await blocks(page)).not.toContain('welcome');
    gate.open();
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toBeVisible();
    expect(await blocks(page)).not.toContain('welcome');
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
  test('lời chào dùng tên gọi (từ cuối); tên gọi một từ rất dài vẫn cắt "…" trên một dòng: thẻ cao bằng thẻ tên ngắn (≤ 2px) và không tràn ngang', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    api.get('/me/loyalty', {
      tier: { id: 't1', name: 'Hạt Giống', multiplier: 1, perks: null }, pointsBalance: 1800, pointsConvertedBalance: 0, tierPoints: 1800,
      tiers: [{ id: 't1', name: 'Hạt Giống', minPoints: 0, multiplier: 1 }, { id: 't2', name: 'Mầm Xanh', minPoints: 3000, multiplier: 1.2 }],
      nextTier: { id: 't2', name: 'Mầm Xanh', minPoints: 3000, pointsToGo: 1200 },
    });
    const heights: number[] = [];
    const names = ['An', 'Nguyễn Thị Phương Thảo Nguyên Vũ Khánh Linh Trần Gia Bảo', `Trần ${'Anh'.repeat(20)}`];
    for (const name of names) {
      api.post('/auth/refresh', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.post('/auth/guest', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.post('/auth/zalo-mini-app', { ...E2E_TOKENS, user: makeUser({ id: 'user-4b', fullName: name }) });
      api.get('/me', { id: 'user-4b', fullName: name, email: null, avatarUrl: null, dob: null, onboarded: true, segments: [] });
      await page.goto('/');
      const card = page.getByRole('region', { name: 'Thẻ thành viên' });
      await expect(card).toContainText('1.800', { timeout: 15_000 });
      const given = name.split(' ').pop()!;
      await expect(card).toContainText(`Chào ${given}`);
      if (name.includes(' ')) await expect(card).not.toContainText('Trần');
      heights.push((await card.boundingBox())!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    for (const [i, h] of heights.entries()) expect(Math.abs(h - heights[0]!), `thẻ tên ngắn ${heights[0]}px vs tên ${names[i]} ${h}px`).toBeLessThanOrEqual(2);
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
    await expect(page.getByRole('region', { name: 'Việc cần làm' })).toHaveCount(0);
    const before = (await categories.boundingBox())!.y;
    // Mock có đơn đang giao: dải ngữ cảnh (một khối 64px) đổi từ khung chờ sang "Việc cần làm", không phải thẻ thành viên.
    await expect(page.getByRole('region', { name: 'Việc cần làm' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('member-card-loading')).toHaveCount(0);
    const after = (await categories.boundingBox())!.y;
    expect(Math.abs(after - before), `Danh mục ${before}px → ${after}px`).toBeLessThanOrEqual(2);
  });
});

test.describe('Trang chủ — chấm đỏ Ưu đãi', () => {
  test('chưa điểm danh + mã sắp hết hạn: có chấm đỏ; mở tab Mã của tôi thì mã đã xem nhưng chưa điểm danh vẫn còn chấm', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api, { checkedIn: false, expiringInDays: 2 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy nhất', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Ưu đãi/ }).click();
    await expect(page.getByRole('heading', { name: /Ưu đãi/ }).first()).toBeVisible({ timeout: 15_000 });
    // Mã nằm ở tab Mã của tôi, không ở tab Săn mã (mặc định).
    await expect(page.getByRole('group', { name: /Giảm 10%/ })).toHaveCount(0);
    await hubTab(page, 'Mã của tôi').click();
    await expect(page.getByRole('group', { name: /Giảm 10%/ }).getByText('Còn 2 ngày')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toBeVisible();
  });

  test('đã điểm danh + mã sắp hết hạn: chấm đỏ chỉ tắt khi khách mở tab Mã của tôi (thấy cả ví), tải lại vẫn tắt', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api, { checkedIn: true, expiringInDays: 2 });
    await page.goto('/');
    await expect(page.getByTestId('offers-dot')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Ưu đãi/ }).click();
    // Ở tab Săn mã khách chưa thấy ví nên mã chưa được ghi "đã xem": chấm còn nguyên.
    await expect(hubTab(page, 'Săn mã')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toBeVisible();
    await hubTab(page, 'Mã của tôi').click();
    await expect(page.getByRole('group', { name: /Giảm 10%/ }).getByText('Còn 2 ngày')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offers-dot')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy nhất', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Ưu đãi/ })).toBeVisible();
    await expect(page.getByTestId('offers-dot')).toHaveCount(0);
  });
});

test.describe('Trang chủ — vùng chạm 44px', () => {
  test('chip Thương hiệu dưới Danh mục có vùng chạm 44px quanh tâm (chip nhìn cao 36px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    await page.goto('/');
    const chips = page.getByRole('region', { name: BRAND_BAR, exact: true });
    await expect(chips).toBeAttached({ timeout: 15_000 });
    const chip = chips.getByRole('button').first();
    await chip.scrollIntoViewIfNeeded();
    await expectChipHitArea44(chip);
  });
});

test.describe('Đổi rác tạm dừng nhưng còn yêu cầu đang mở', () => {
  test('Trang chủ và Ưu đãi giữ lối vào "Yêu cầu của tôi" nhờ endpoint đếm nhẹ, không gọi /waste/me', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    api.get('/waste/me/open-count', { count: 2 });
    mockRewardsCatalog(api);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Yêu cầu của tôi/ }).first()).toBeVisible({ timeout: 15_000 });
    // Lối vào Đổi rác của Ưu đãi nằm ở tab Đổi quà.
    await page.goto('/offers?tab=rewards');
    await expect(page.getByText('Yêu cầu của tôi', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/waste/me/open-count').length).toBeGreaterThan(0);
    expect(api.callsTo('GET', '/waste/me')).toHaveLength(0);
  });

  test('không còn yêu cầu nào: không có lối vào', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    api.get('/waste/me/open-count', { count: 0 });
    const openCount = page.waitForResponse((r) => r.url().includes('/waste/me/open-count'));
    await page.goto('/');
    await openCount;
    await expect(page.getByTestId('shortcut-grid')).toBeVisible({ timeout: 15_000 });
    // Ô Đổi rác giữ nhãn thường (không đổi sang "Yêu cầu"). Hộp "Thêm lối tắt" chỉ gồm lối tắt chưa lên lưới (không lặp Giờ vàng, không có Đơn hàng):
    // ở đó cũng không được có lối vào Yêu cầu.
    await expect(page.getByTestId('shortcut-grid').locator('[data-pillar="recycle"] [data-shortcut-label]')).toHaveText('Đổi rác');
    await page.getByRole('button', { name: 'Thêm lối tắt' }).click();
    const dialog = page.getByRole('dialog', { name: 'Thêm lối tắt' });
    await expect(dialog.getByRole('button', { name: /Kiếm tiền/ })).toBeVisible();
    await expect(dialog.getByText(/Đơn hàng|Giờ vàng/)).toHaveCount(0);
    await expect(page.getByText(/Yêu cầu của tôi/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Yêu cầu của tôi/ })).toHaveCount(0);
  });
});

test.describe('Kệ Mua lại ở Trang chủ: một dòng chỉ có Mua lại, không mời Định kỳ (lối đặt định kỳ nằm ở tab Đơn hàng), thẻ cao như nhau', () => {
  for (const width of [375, 320]) {
    test(`${width}px: không có nút Định kỳ dù cờ bật và hàng không chỉ bán lẻ (RebuyLine không mời), vẫn có Mua lại; tên ngắn và tên dài cho thẻ cao bằng nhau (≤ 1px)`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      const heights: number[] = [];
      for (const name of ['An', 'Nước Rửa Chén Sinh Học Tubu Hương Chanh Gừng Loại Đậm Đặc 500ml Chai Lớn']) {
        mockDiscovery(api, { returning: true });
        api.get('/config/public', { freeshipThreshold: 200000, subscribeDiscountPct: 0.17, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } } as never);
        api.get('/me/purchased-items', { items: [{ ...PURCHASED_PAGE.items[0]!, productName: name }], nextCursor: null });
        await page.goto('/');
        const card = page.getByRole('region', { name: 'Mua lại' });
        await expect(card).toBeVisible({ timeout: 15_000 });
        await expect(card.getByRole('button', { name: /định kỳ/i })).toHaveCount(0);
        await expect(card.getByRole('button', { name: 'Mua lại' }).first()).toBeVisible();
        heights.push((await card.boundingBox())!.height);
      }
      expect(Math.abs(heights[1]! - heights[0]!), `thẻ tên ngắn ${heights[0]}px vs tên dài ${heights[1]}px`).toBeLessThanOrEqual(1);
    });
  }
});
