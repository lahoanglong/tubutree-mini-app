import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { collectPageErrors, mockRetention, retentionState, type RetentionState } from './support/retention-daily';

/**
 * W46 (PO 27/11 22:25 A3), Mini App: ô tìm ở đầu Trang chủ ghi "Tìm sản phẩm" trên MỘT dòng ở 360px và 375px mà không lấn vùng viên thuốc
 * Zalo (96px bên phải), và thanh đáy mỗi tab tối đa một dấu (số đơn thắng chấm nhắc; chấm Ưu đãi 8px như chấm Cá nhân).
 * API mock toàn bộ. Đặt W46_SHOTS_DIR để chụp ảnh.
 */
const SHOTS = process.env.W46_SHOTS_DIR;
const CAPSULE_INSET_END = 96;

const nav = (page: Page) => page.getByRole('navigation');
const search = (page: Page) => page.getByRole('button', { name: 'Tìm sản phẩm', exact: true });

async function setup(page: Page, api: MockApi, width: number, over: Partial<RetentionState>): Promise<string[]> {
  mockSession(api, makeUser({ id: 'u-retention', fullName: 'Nguyễn Văn An' }));
  mockRetention(api, retentionState(over));
  api.get('/flash-sales/upcoming', []);
  const crashed = collectPageErrors(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('home-header')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => api.callsTo('GET', '/me/summary').length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(500);
  return crashed;
}

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (target) await target.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
  else await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

// 365px: khổ giữa 360 và 375 (logo đã ẩn từ 374px trở xuống, chữ không bị cắt).
for (const width of [360, 365, 375] as const) {
  test.describe(`Mini App ${width}px: đầu Trang chủ và thanh đáy (W46)`, () => {
    test('ô tìm "Tìm sản phẩm" một dòng, không cắt; chuông và giỏ nằm trái vùng viên thuốc Zalo; không tràn ngang', async ({ page, api }) => {
      const crashed = await setup(page, api, width, {});
      const header = page.getByTestId('home-header');
      const text = search(page).locator('span').last();
      await expect(text).toHaveText('Tìm sản phẩm');
      const fit = await text.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height, lineHeight: parseFloat(cs.lineHeight), fontSize: cs.fontSize, whiteSpace: cs.whiteSpace };
      });
      const line = `HOME_SEARCH_MINI${width} scroll=${fit.scroll} client=${fit.client} h=${fit.height} lh=${fit.lineHeight} font=${fit.fontSize}`;
      console.log(line);
      expect(fit.scroll, line).toBeLessThanOrEqual(fit.client);
      expect(fit.height, `${line}: một dòng`).toBeLessThanOrEqual(fit.lineHeight + 1);
      expect(fit.fontSize).toBe('13px');
      expect(fit.whiteSpace).toBe('nowrap');

      const hb = (await header.boundingBox())!;
      expect(Math.round(hb.height)).toBe(56);
      const sb = (await search(page).boundingBox())!;
      expect(sb.height).toBeGreaterThanOrEqual(44);
      const cart = (await header.getByRole('button', { name: /^Giỏ hàng/ }).boundingBox())!;
      const bell = (await header.getByRole('button', { name: /^Thông báo/ }).boundingBox())!;
      expect(cart.x + cart.width, 'giỏ nằm trái vùng viên thuốc Zalo').toBeLessThanOrEqual(width - CAPSULE_INSET_END + 0.5);
      expect(Math.round(cart.x - (bell.x + bell.width)), 'chuông và giỏ cách 4px').toBe(4);
      for (const b of [cart, bell]) expect(b.y + b.height / 2).toBeCloseTo(hb.y + hb.height / 2, 0);

      const logo = header.getByAltText('Tubu Tree');
      const lb = (await logo.boundingBox())!;
      if (width < 375) {
        // Khổ hẹp: dấu logo nhường chỗ cho ô tìm, h1 vẫn có tên "Tubu Tree" cho trình đọc màn hình.
        expect(lb.width).toBeLessThanOrEqual(1);
        await expect(page.getByRole('heading', { level: 1, name: 'Tubu Tree' })).toHaveCount(1);
      } else {
        expect(Math.round(lb.width)).toBe(20);
        expect(Math.round(lb.height)).toBe(30);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await shot(page, `mini${width}-home-header`, header);
      if (width !== 365) await shot(page, `mini${width}-home`);
      expect(crashed).toEqual([]);
    });

    if (width === 365) return;

    test('thanh đáy: Cá nhân có 2 đơn đang xử lý và tin chưa đọc chỉ hiện số đơn (một dấu); Ưu đãi chưa điểm danh có chấm 8px', async ({ page, api }) => {
      const crashed = await setup(page, api, width, { dailyEnabled: false, checkedInToday: false, unread: 5, activeOrders: 2 });
      const profileTab = nav(page).getByRole('button', { name: /^Cá nhân/ });
      const offersTab = nav(page).getByRole('button', { name: /^Ưu đãi/ });
      await expect(profileTab).toHaveAccessibleName('Cá nhân, 2 đơn đang xử lý');
      await expect(profileTab.getByTestId('profile-dot')).toHaveCount(0);
      await expect(profileTab).toContainText('2');
      await expect(offersTab).toHaveAccessibleName('Ưu đãi, có việc cần làm');
      const dot = offersTab.getByTestId('offers-dot');
      await expect(dot).toHaveClass('tubu-remind-dot');
      const db = (await dot.boundingBox())!;
      console.log(`OFFERS_DOT_MINI${width} ${db.width}x${db.height}`);
      expect(Math.abs(db.width - 8)).toBeLessThan(0.5);
      expect(Math.abs(db.height - 8)).toBeLessThan(0.5);
      // Mỗi tab có tối đa một dấu: chấm nhắc hoặc huy hiệu số.
      const marks = await nav(page)
        .getByRole('button')
        .evaluateAll((tabs) =>
          tabs.map((t) => {
            // Ô biểu tượng của tab: ngoài SVG, mỗi <span> con là một dấu (huy hiệu số hoặc chấm nhắc).
            const icon = t.querySelector(':scope > span[aria-hidden]');
            return icon ? Array.from(icon.children).filter((c) => c.tagName === 'SPAN').length : 0;
          }),
        );
      expect(marks[4], 'tab Cá nhân có đúng một dấu (số đơn)').toBe(1);
      console.log(`NAV_MARKS_MINI${width} ${JSON.stringify(marks)}`);
      for (const n of marks) expect(n).toBeLessThanOrEqual(1);
      await shot(page, `mini${width}-bottom-nav`, nav(page));
      expect(crashed).toEqual([]);
    });

    test('cờ nhiệm vụ bật, có tin chưa đọc nhưng đang có đơn: không chấm Cá nhân, chỉ số đơn', async ({ page, api }) => {
      const crashed = await setup(page, api, width, { dailyEnabled: true, checkedInToday: true, unread: 5, activeOrders: 2 });
      const profileTab = nav(page).getByRole('button', { name: /^Cá nhân/ });
      await expect(profileTab).toHaveAccessibleName('Cá nhân, 2 đơn đang xử lý');
      await expect(page.getByTestId('profile-dot')).toHaveCount(0);
      expect(crashed).toEqual([]);
    });
  });
}
