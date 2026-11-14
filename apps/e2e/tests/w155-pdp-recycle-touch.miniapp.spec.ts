import type { Page } from '@playwright/test';
import { expect, test, mockSession } from './support/mock-api';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { MIN_TAP } from './support/touch-probe';

/**
 * W155: ba điều khiển dưới 44px của Mini App ở 360 / 390px, dữ liệu mock đủ nội dung như visual-tour:
 *  - PDP, nút Chia sẻ: hàng tên thương hiệu + Tim + Chia sẻ co nút còn 39px bề ngang ở 360px (thiếu flex-shrink: 0).
 *  - PDP, dòng "Nhận … Điểm Xanh": 20px dôi lên trên bị chữ giá vẽ đè, vùng chạm thật chỉ còn ~24px (thiếu position: relative).
 *  - Đổi rác, ô gõ Số lượng: cao 36px ở cỡ sm, ô nhập không có vùng chạm giãn như nút (đáy hộp 44px).
 */
const WIDTHS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

async function open(page: Page, api: Parameters<Parameters<typeof test>[2]>[0]['api'], key: string): Promise<void> {
  const entry = tourEntries().find((e) => e.key === key)!;
  const user = tourUser(entry.role);
  mockSession(api, user);
  mockTourWorld(api, user);
  entry.setup?.(api);
  await page.goto(entry.miniapp);
}

for (const vp of WIDTHS) {
  test.describe(`Mini App ${vp.width}px: vùng chạm PDP và ô Số lượng Đổi rác`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(vp);
    });

    test('PDP: nút Chia sẻ rộng ≥ 44px', async ({ page, api }) => {
      await open(page, api, '/product/:slug');
      const share = page.getByRole('button', { name: 'Chia sẻ', exact: true });
      await expect(share).toBeVisible({ timeout: 15_000 });
      const box = (await share.boundingBox())!;
      expect.soft(box.width, `Chia sẻ ${vp.width}px: rộng ${box.width}px`).toBeGreaterThanOrEqual(MIN_TAP);
      expect.soft(box.height, `Chia sẻ ${vp.width}px: cao ${box.height}px`).toBeGreaterThanOrEqual(MIN_TAP);
    });

    test('PDP: cả chiều cao 44px của dòng Điểm Xanh nhận cú chạm (chữ giá không đè lên)', async ({ page, api }) => {
      await open(page, api, '/product/:slug');
      const row = page.locator('.tubu-points-earn');
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.scrollIntoViewIfNeeded();
      const miss = await row.evaluate((el, min) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const bad: string[] = [];
        // Dò đều từ mép trên tới mép dưới, mỗi mốc phải rơi vào chính nút (hoặc con của nó).
        for (let dy = 2; dy < Math.min(r.height, min); dy += 6) {
          const hit = document.elementFromPoint(cx, r.top + dy);
          if (!hit || !el.contains(hit)) bad.push(`dy=${dy} → ${hit?.tagName ?? 'null'} ${(hit?.textContent ?? '').slice(0, 14)}`);
        }
        return { bad, height: r.height };
      }, MIN_TAP);
      expect.soft(miss.height, `Điểm Xanh ${vp.width}px: nút cao ${miss.height}px`).toBeGreaterThanOrEqual(MIN_TAP);
      expect.soft(miss.bad, `Điểm Xanh ${vp.width}px: phần nút bị phần tử khác che`).toEqual([]);
    });

    test('Đổi rác (tạo yêu cầu): ô gõ Số lượng cao ≥ 44px', async ({ page, api }) => {
      await open(page, api, '/recycle/new');
      const inputs = page.getByRole('textbox', { name: 'Số lượng' });
      await expect(inputs.first()).toBeVisible({ timeout: 15_000 });
      const count = await inputs.count();
      expect(count, 'có ít nhất một ô Số lượng để đo').toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = (await inputs.nth(i).boundingBox())!;
        expect.soft(box.height, `Số lượng #${i} ${vp.width}px: cao ${box.height}px`).toBeGreaterThanOrEqual(MIN_TAP);
      }
    });
  });
}
