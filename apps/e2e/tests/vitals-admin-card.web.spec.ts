import { mkdirSync } from 'node:fs';
import { adminShellDefaults, expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Thẻ "Tốc độ trên máy khách" ở Quản trị > Vận hành (chỉ ADMIN) ở 360/390/768/1440: bảng p75 có số, không tràn ngang trang (bảng rộng cuộn trong
 * vùng cuộn của nó), nút 7/28 ngày cao ≥ 44px trên điện thoại (đo với cảm ứng bật) và đổi khoảng thời gian thì hỏi lại API đúng `days`.
 */
const SHOTS = '/tmp/review/tubu/shots/waves/tubu-w4-05-real-user-vitals-and-speed-budget';
const GROUPS = [
  { phone: true, sizes: [{ width: 360, height: 740 }, { width: 390, height: 844 }] },
  { phone: false, sizes: [{ width: 768, height: 1024 }, { width: 1440, height: 900 }] },
] as const;

const row = (platform: 'web' | 'miniapp', name: string, route: string, viewport: string, samples: number, p75: number, rating: string) => ({
  platform, name, route, viewport, samples, p75, good: 0, needsImprovement: 0, poor: 0, rating, enoughSamples: samples >= 50,
});
const SUMMARY = (days: 7 | 28) => ({
  days,
  since: '2026-11-11',
  minSamples: 50,
  rows: [
    row('web', 'LCP', '*', 's', 1200, 2100, 'good'),
    row('web', 'INP', '*', 's', 1200, 240, 'needs-improvement'),
    row('web', 'CLS', '*', 's', 1200, 0.04, 'good'),
    row('web', 'FCP', '*', 's', 1200, 1400, 'good'),
    row('web', 'TTFB', '*', 's', 1200, 650, 'good'),
    row('web', 'LCP', '/san-pham/[slug]', 's', 420, 3100, 'needs-improvement'),
    row('web', 'LCP', '/gio-hang', 'l', 12, 4300, 'poor'),
    row('miniapp', 'LCP', '*', 's', 800, 1900, 'good'),
    row('miniapp', 'READY', '*', 's', 800, 2600, 'good'),
  ],
});

function mockAdmin(api: MockApi) {
  const admin = { id: 'u-admin', fullName: 'Quản trị E2E', referralCode: 'ADM', phone: '0900000000', role: 'ADMIN', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', refreshToken: 'e2e-refresh', user: admin }));
  api.get('/me', admin);
  adminShellDefaults(api);
  // Phần sức khoẻ hệ thống báo lỗi tải: thẻ tốc độ là truy vấn riêng, vẫn phải hiện.
  api.get('/admin/ops/health', reply(503, { message: 'tạm lỗi' }));
  api.get('/admin/perf/vitals', ({ call }) => SUMMARY(call.query.get('days') === '28' ? 28 : 7));
  api.allowUnmocked('GET /admin/mss/order-events', 'GET /admin/customer-refunds', 'GET /admin/mss/catalog');
}

for (const group of GROUPS) {
  test.describe(group.phone ? 'điện thoại, cảm ứng bật' : 'máy tính bảng và máy tính', () => {
    if (group.phone) test.use({ hasTouch: true, isMobile: true });
    for (const size of group.sizes) {
      test(`${size.width}px: thẻ Tốc độ trên máy khách có bảng p75, không tràn ngang, nút đổi khoảng thời gian bấm được`, async ({ page, api }, testInfo) => {
        test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
        mockAdmin(api);
        await page.setViewportSize(size);
        await page.addInitScript(() => {
          try {
            localStorage.setItem('tubu_web_session', '1');
          } catch {
            // không có localStorage: thẻ không mở được, ca sẽ đỏ ở bước tìm thẻ
          }
        });
        await page.goto('/admin?tab=opsHealth');
        const card = page.getByRole('region', { name: 'Tốc độ trên máy khách', exact: true });
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card.getByRole('table')).toBeVisible();
        await expect(card).toContainText('Web · Mọi trang');
        await expect(card).toContainText('Mini App · Mọi trang');
        await expect(card).toContainText('chưa đủ mẫu');

        const m = await card.evaluate((el) => ({
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          cardOverflow: Math.max(0, el.scrollWidth - el.clientWidth),
          buttons: Array.from(el.querySelectorAll('[role="group"][aria-label="Khoảng thời gian"] button')).map((b) => {
            const r = b.getBoundingClientRect();
            return { text: b.textContent, w: Math.round(r.width), h: Math.round(r.height) };
          }),
        }));
        console.log(`VITALS_ADMIN ${size.width} pageOverflow=${m.pageOverflow} cardOverflow=${m.cardOverflow} buttons=${JSON.stringify(m.buttons)}`);
        mkdirSync(SHOTS, { recursive: true });
        await card.screenshot({ path: `${SHOTS}/admin-vitals-${size.width}.png` });
        expect(m.pageOverflow, 'trang tràn ngang').toBe(0);
        expect(m.cardOverflow, 'thẻ tràn ngang (bảng phải cuộn trong vùng cuộn)').toBe(0);
        expect(m.buttons).toHaveLength(2);
        for (const b of m.buttons) {
          expect(b.h, `nút ${b.text} cao`).toBeGreaterThanOrEqual(group.phone ? 44 : 32);
          expect(b.w, `nút ${b.text} rộng`).toBeGreaterThanOrEqual(44);
        }

        await card.getByRole('button', { name: '28 ngày' }).click();
        await expect(card.getByRole('button', { name: '28 ngày' })).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => api.callsTo('GET', '/admin/perf/vitals').some((c) => c.query.get('days') === '28')).toBe(true);
      });
    }
  });
}
