import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { expect, test } from './support/mock-api';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { probe, screenReady } from './support/uiux-probe';

/**
 * W169: bản web của kiểm toán 375x812 và 320x568 (cùng sáu màn với Mini). PDP web dựng phía máy chủ từ API thật,
 * nên chỉ chạy khi có `W169_FAKE_API` (API giả cho SSR); năm màn còn lại chạy hoàn toàn bằng mock trình duyệt.
 * `W169_SHOTS` (thư mục) thì chụp ảnh.
 */
const SHOTS = process.env.W169_SHOTS;

const ALL_SCREENS = [
  { key: '/product/:slug', file: 'pdp' },
  { key: '/orders', file: 'orders' },
  { key: '/orders', file: 'orders-empty' },
  { key: '/order/:code', file: 'order-detail' },
  { key: '/bank-payment/:code', file: 'bank' },
  { key: '/profile', file: 'account' },
  { key: '/addresses', file: 'addresses' },
] as const;
// PDP web cần API giả cho SSR: bỏ hẳn khỏi danh sách khi thiếu cờ, để CI không có ca skipped.
const SCREENS = ALL_SCREENS.filter((s) => s.file !== 'pdp' || process.env.W169_FAKE_API);

const SIZES = [
  { name: '375', width: 375, height: 812 },
  { name: '320', width: 320, height: 568 },
] as const;

for (const size of SIZES) {
  for (const screen of SCREENS) {
    test(`web ${screen.file} ${size.name}: không tràn ngang, vùng chạm đủ 44px`, async ({ page, api }) => {
      const entry = tourEntries().find((e) => e.key === screen.key)!;
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: màn vẫn dựng
        }
      });
      mockTourWorld(api, tourUser(entry.role));
      entry.setup?.(api);
      if (screen.file === 'orders-empty') api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
      api.get('/auth/me', () => ({ id: tourUser(entry.role).id, ownsBrand: false }));
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(entry.web);
      await expect(screenReady(page, screen.file), `màn ${screen.file} chưa dựng xong`).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
      await page.waitForTimeout(800);

      const p = await probe(page);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `tubu-w169-web-${screen.file}-${size.name}.png`), scale: 'css' });
        await page.screenshot({ path: path.join(SHOTS, `tubu-w169-web-${screen.file}-${size.name}-full.png`), scale: 'css', fullPage: true });
        await page.evaluate(() => window.scrollTo(0, 260));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, `tubu-w169-web-${screen.file}-${size.name}-s1.png`), scale: 'css' });
        appendFileSync(path.join(SHOTS, 'probe-web.jsonl'), `${JSON.stringify({ screen: screen.file, size: size.name, ...p })}\n`);
      }
      expect(p.overflowX, `tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      expect(p.small, `vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.primaryGreen, 'tối đa một nút xanh đặc rộng trên một màn').toBeLessThanOrEqual(1);
    });
  }
}
