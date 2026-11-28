import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './support/mock-api';

/**
 * tubu-w49-02: `/dai-ly` trong WebView của Zalo chỉ hiện màn "Mở trên trình duyệt ngoài" (w33-01: Mini App không mở kênh đại lý có đăng ký và
 * thanh toán bên trong Zalo). Trang dựng sẵn (ISR) giống nhau cho mọi người, nên ca "trước hydrate" chặn gói JS của Next để giữ đúng HTML máy chủ:
 * chỉ script nội tuyến chạy, và CSS theo <html data-zalo-webview> phải đã giấu trang thật, hiện màn chặn (không chớp nội dung thật).
 */

const ZALO_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/12345 ZaloTheme/light ZaloLanguage/vi';
const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const TITLE = 'Mở trên trình duyệt ngoài';
const WIDTHS = [360, 375] as const;

/** Ảnh chụp làm bằng chứng: E2E_EVIDENCE_DIR nếu có (đưa vào báo cáo wave), không thì thư mục kết quả của Playwright. */
async function shot(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.E2E_EVIDENCE_DIR;
  await page.screenshot({ path: dir ? `${dir}/${name}.png` : testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function noHorizontalOverflow(page: Page, label: string) {
  const o = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"]');
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, offenders };
  });
  expect(o.scrollWidth, `${label}: ${o.offenders.join(' | ')}`).toBeLessThanOrEqual(o.clientWidth);
  expect(o.offenders, label).toEqual([]);
}

test.describe('tubu-w49-02 web: /dai-ly trong WebView Zalo', () => {
  test.beforeEach(async ({ api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'màn chặn là khổ điện thoại; một project điện thoại là đủ');
    api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
    api.allowUnmocked('GET /me', 'POST /auth/refresh');
  });

  for (const width of WIDTHS) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 812 }, userAgent: ZALO_UA });

      test('trước hydrate (chỉ HTML máy chủ + script nội tuyến): có data-zalo-webview, màn chặn hiện, trang đại lý thật bị giấu', async ({ page }, testInfo) => {
        await page.route((url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'), (route) => route.abort());
        const res = await page.goto('/dai-ly', { waitUntil: 'commit' });
        expect(res?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('data-zalo-webview', '');
        await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sao chép liên kết' })).toBeVisible();
        await expect(page.locator('main[data-dealer-theme]')).toBeHidden();
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await noHorizontalOverflow(page, `pre-hydrate ${width}`);
        await shot(page, testInfo, `dai-ly-zalo-pre-hydrate-${width}`);
      });

      test('sau hydrate: trang đại lý thật bị gỡ khỏi DOM, chỉ còn màn chặn; Sao chép liên kết chép đúng link và báo thật', async ({ page, context }, testInfo) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/dai-ly');
        await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.locator('main[data-dealer-theme]')).toHaveCount(0);
        await expect(page.getByText('Đăng ký đại lý')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
        const link = (await page.locator('[data-zalo-webview-gate] code').textContent())!;
        expect(link).toMatch(/\/dai-ly$/);
        await noHorizontalOverflow(page, `post-hydrate ${width}`);
        await shot(page, testInfo, `dai-ly-zalo-gate-${width}`);

        const btn = page.getByRole('button', { name: 'Sao chép liên kết' });
        const box = (await btn.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        await btn.click();
        await expect(page.getByRole('status')).toContainText('Đã sao chép liên kết');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
        await shot(page, testInfo, `dai-ly-zalo-gate-copied-${width}`);
      });
    });
  }

  test.describe('trình duyệt thường (đối chứng)', () => {
    test.use({ viewport: { width: 375, height: 812 }, userAgent: SAFARI_UA });

    test('Safari: không có màn chặn, trang đại lý hiện như cũ, không có data-zalo-webview', async ({ page }, testInfo) => {
      await page.goto('/dai-ly');
      await expect(page.locator('main[data-dealer-theme]')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: TITLE })).toHaveCount(0);
      await expect(page.locator('[data-zalo-webview-gate]')).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-zalo-webview', '');
      await noHorizontalOverflow(page, 'safari 375');
      await shot(page, testInfo, 'dai-ly-safari-375');
    });

    test('Safari trước hydrate: trang thật hiện ngay, màn chặn giấu', async ({ page }) => {
      await page.route((url) => url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js'), (route) => route.abort());
      await page.goto('/dai-ly', { waitUntil: 'commit' });
      await expect(page.locator('main[data-dealer-theme]')).toBeVisible();
      await expect(page.locator('[data-zalo-webview-gate]')).toBeHidden();
    });
  });
});
