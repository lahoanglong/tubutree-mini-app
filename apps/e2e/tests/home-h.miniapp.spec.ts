import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
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
