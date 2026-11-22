import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';

/**
 * tubu-w18-03: `/ctv` và `/dai-ly` dựng sẵn màn khách ở máy chủ. Từ md, link lùi "← Trang chủ" của khách không được chớp qua với người đã đăng
 * nhập trong lúc chưa hydrate: script ở <head> đặt `data-restoring` (máy còn cờ phiên) và CSS chỉ hiện link "← Tài khoản" cùng cao.
 * Spec chặn gói JS của Next để giữ đúng HTML máy chủ (khoảnh khắc trước hydrate); script nội tuyến ở <head> vẫn chạy.
 * Trang vẫn trả 200 với tiêu đề và canonical của trang đích.
 */

const PAGES = [
  { path: '/ctv', title: 'Cộng tác viên — Tubu Tree' },
  { path: '/dai-ly', title: /đại lý/i },
] as const;

async function openBeforeHydrate(page: Page, path: string, signedIn: boolean) {
  if (signedIn) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: không có cờ phiên
      }
    });
  }
  // Chỉ chặn JS: CSS (kể cả khi bundler để CSS trong chunks/) phải tải để lớp ẩn/hiện theo data-restoring có hiệu lực.
  await page.route((url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'), (route) => route.abort());
  return page.goto(path, { waitUntil: 'domcontentloaded' });
}

const backLink = (page: Page, name: string) => page.locator('a[data-back-link]').filter({ hasText: name });

test.describe('tubu-w18-03 web: link lùi /ctv, /dai-ly trước hydrate', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'Link lùi chỉ hiện từ md; một project máy tính là đủ');
  });

  for (const { path, title } of PAGES) {
    test(`${path}: máy còn cờ phiên thấy "← Tài khoản", không thấy "← Trang chủ"; khách vãng lai ngược lại; SSR 200 giữ tiêu đề, canonical`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      // Khách vãng lai trước (chưa có cờ phiên trong context), rồi cùng trang khi máy đã có cờ phiên.
      const res = await openBeforeHydrate(page, path, false);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${path}$`));
      await expect(page.locator('html')).not.toHaveAttribute('data-restoring', '');
      await expect(backLink(page, '← Trang chủ')).toBeVisible();
      await expect(backLink(page, '← Tài khoản')).toBeHidden();
      const guest = (await backLink(page, '← Trang chủ').boundingBox())!;
      expect(guest.height).toBeGreaterThanOrEqual(44);

      expect((await openBeforeHydrate(page, path, true))?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('data-restoring', '');
      await expect(backLink(page, '← Tài khoản')).toBeVisible();
      await expect(backLink(page, '← Trang chủ')).toBeHidden();
      const member = (await backLink(page, '← Tài khoản').boundingBox())!;
      expect(member.height).toBe(guest.height);
      expect(member.y).toBe(guest.y);
    });
  }
});
