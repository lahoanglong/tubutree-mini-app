import type { Locator, Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';
import { mockWorld, type CheckoutState } from './support/checkout-states';
import { runAxe } from './support/axe';

/**
 * Thân hộp mã giảm giá ở /thanh-toan khi ví đang tải, tải lỗi và trống phải giống nhau ở mọi khổ: dưới md là bảng trượt, từ md là panel
 * tại chỗ (`#coupon-panel`), cả hai cùng tiêu đề "Mã giảm giá của bạn", khung chờ, "Thử lại" và lời mời nhập mã như VoucherSheet của Mini App.
 * Ở 320x568, 375x812, 768x1024 và 1440x900: không tràn ngang, nút cao tối thiểu 44px, chữ đạt tương phản AA. API mock toàn bộ.
 */
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;
type Size = (typeof SIZES)[number];

const TITLE = 'Mã giảm giá của bạn';
const EMPTY_TITLE = 'Bạn chưa có mã giảm giá trong ví';
const EMPTY_BODY = 'Nhập mã giảm giá ở trên để áp dụng.';

interface Wallet {
  gate: Promise<void>;
  fail: boolean;
}

function stateFor(kind: 'loading' | 'error' | 'empty', wallet: Wallet): CheckoutState {
  return {
    key: `coupon-panel-${kind}`,
    name: `Ví mã: ${kind}`,
    ready: () => undefined,
    routes: (api: MockApi) => {
      if (kind === 'empty') return;
      api.get('/me/coupons', async () => {
        await wallet.gate;
        return wallet.fail ? reply(500, { statusCode: 500, message: 'Máy chủ đang bận' }) : [];
      });
    },
  };
}

async function openPanel(page: Page, api: MockApi, kind: 'loading' | 'error' | 'empty', wallet: Wallet, size: Size): Promise<Locator> {
  await mockWorld(api, page, 'web', stateFor(kind, wallet), Promise.resolve());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/thanh-toan');
  const row = page.locator('[data-testid="coupon-row"]:visible').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const panel = page.locator('#coupon-panel:visible').first();
  await expect(panel).toBeVisible();
  return panel;
}

async function expectBodyFits(page: Page, panel: Locator, size: Size): Promise<void> {
  await expect(panel.getByText(TITLE, { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `trang tràn ngang ${overflow}px ở ${size.width}px`).toBeLessThanOrEqual(0);
  const box = (await panel.boundingBox())!;
  expect(box.x, 'panel lấn ra trái').toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, 'panel lấn ra phải').toBeLessThanOrEqual(size.width + 0.5);
  for (const button of await panel.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const b = (await button.boundingBox())!;
    const name = (await button.textContent())?.trim() || (await button.getAttribute('aria-label'));
    expect(b.height, `nút "${name}" cao ${b.height}px`).toBeGreaterThanOrEqual(43.5);
    expect(b.width, `nút "${name}" rộng ${b.width}px`).toBeGreaterThanOrEqual(43.5);
  }
}

async function contrastInPanel(page: Page): Promise<string[]> {
  const found = await runAxe(page);
  const bad: string[] = [];
  for (const v of found.filter((f) => f.id === 'color-contrast'))
    for (const n of v.nodes) {
      const selector = n.target[0]!;
      if (await page.evaluate((s) => !!document.querySelector(s)?.closest('#coupon-panel'), selector)) bad.push(selector);
    }
  return bad;
}

for (const size of SIZES) {
  test.describe(`Thanh toán web: thân hộp mã giảm giá ở ${size.width}x${size.height}`, () => {
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'tự đặt khổ từng ca, chỉ chạy ở một project');
    });

    test('ví đang tải: tiêu đề mục và khung chờ, chưa nói "chưa có mã"', async ({ page, api }) => {
      let release!: () => void;
      const wallet: Wallet = { gate: new Promise<void>((r) => (release = r)), fail: false };
      try {
        const panel = await openPanel(page, api, 'loading', wallet, size);
        await expect(panel.getByRole('status', { name: 'Đang tải danh sách mã' })).toBeVisible();
        await expect(panel.getByText(EMPTY_TITLE)).toHaveCount(0);
        await expectBodyFits(page, panel, size);
        expect(await contrastInPanel(page)).toEqual([]);
      } finally {
        release();
      }
    });

    test('ví lỗi: lý do và "Thử lại" tải lại được, rồi ra trạng thái trống', async ({ page, api }) => {
      const wallet: Wallet = { gate: Promise.resolve(), fail: true };
      const panel = await openPanel(page, api, 'error', wallet, size);
      const retry = panel.getByRole('button', { name: 'Thử lại' });
      await expect(retry).toBeVisible({ timeout: 20_000 });
      await expect(panel.getByText(/Không thể tải danh sách mã giảm giá/)).toBeVisible();
      await expect(panel.getByText(EMPTY_TITLE)).toHaveCount(0);
      await expectBodyFits(page, panel, size);
      expect(await contrastInPanel(page)).toEqual([]);
      wallet.fail = false;
      await retry.click();
      await expect(panel.getByText(EMPTY_TITLE)).toBeVisible({ timeout: 20_000 });
      await expect(retry).toHaveCount(0);
    });

    test('ví chưa có mã: lời mời nhập mã dưới tiêu đề mục, không danh sách rỗng', async ({ page, api }) => {
      const panel = await openPanel(page, api, 'empty', { gate: Promise.resolve(), fail: false }, size);
      await expect(panel.getByText(EMPTY_TITLE)).toBeVisible({ timeout: 20_000 });
      await expect(panel.getByText(EMPTY_BODY)).toBeVisible();
      await expect(panel.locator('ul')).toHaveCount(0);
      await expectBodyFits(page, panel, size);
      expect(await contrastInPanel(page)).toEqual([]);
    });
  });
}
