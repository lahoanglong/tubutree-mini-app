import { test } from './support/mock-api';
import { expect } from '@playwright/test';
import { assertSeededOnCi } from './support/a11y-db';
import { observeCls, readClsTotal } from './support/cls-observer';
import { solidPng } from './support/noise-png';
import { seedTourPublicData } from './support/tour-db';
import { mockTourWorld, tourUser } from './support/tour-world';
import { MAIN, SHOTS, WEB_SIZES_AUDIT, WEB_SIZES_GUARD, auditEntries, measuresCls, record, recordFailure, shootJpeg, shotPath } from './support/w182-audit';
import { probeW182 } from './support/w182-probe';

/**
 * W182: nghiệm thu cuối web ở 320/375/768/1024/1280/1440px (guard CI: 320/375/768/1280). Cùng danh sách màn và cùng dữ liệu với bản Mini App
 * (w182-acceptance.miniapp.spec.ts). Dữ liệu dựng phía máy chủ (SSR) lấy từ DB e2e đã seed. Khổ chạm (<= 768px) kiểm vùng chạm 44px;
 * mọi khổ kiểm tràn ngang, chữ đè nhau và nút nổi đè nội dung. Có W182_SHOTS thì chỉ ghi nhật ký + ảnh để lập bảng kiểm toán.
 */
const SIZES = SHOTS ? WEB_SIZES_AUDIT : WEB_SIZES_GUARD;

// Guard lọc theo danh sách MAIN: một màn đổi tên trong route-map.json sẽ lặng lẽ rơi khỏi guard nếu không kiểm số lượng.
if (!SHOTS) {
  test('w182 guard phủ đủ các màn chính của web', () => {
    expect(auditEntries().map((e) => e.key).sort()).toEqual([...MAIN].sort());
  });
}

// Ba worker cùng seed một cơ sở dữ liệu có thể đụng deadlock Postgres (40P01); seed là idempotent nên thử lại vài lần.
test.beforeAll(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      assertSeededOnCi(await seedTourPublicData());
      return;
    } catch (e) {
      if (attempt >= 4 || !/40P01|deadlock/i.test(String(e))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
});

const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

for (const size of SIZES) {
  for (const entry of auditEntries()) {
    test(`w182 web ${entry.key} ${size.width}px: không tràn ngang, chữ không đè`, async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
          localStorage.setItem('tubu_garden_hint_seen', '1');
        } catch {
          // không có localStorage: màn vẫn dựng
        }
      });
      // client-api.ts ghi cờ phiên cả vào localStorage lẫn cookie `tubu_web_session`; middleware dùng cookie để chuyển "/" sang bản dựng sẵn khung chờ (khoi-phuc).
      // Chỉ localStorage mà thiếu cookie không xảy ra trên máy thật (trừ khi cookie bị xoá riêng), nên đo Trang chủ với đủ cả hai như một máy mới đã đăng nhập.
      if (entry.key === '/') await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
      mockTourWorld(api, tourUser(entry.role));
      entry.setup?.(api);
      // Các màn này gọi vài đường mà bản tham quan không mock; 404 là trạng thái đã đo ở bước kiểm toán, không phải lỗi của guard hình học.
      api.allowUnmocked('GET /auth/me', 'GET /waste/requests', 'POST /cart/coupon');
      await page.route(isServedImage, (route) => route.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
      if (measuresCls(entry.key)) await observeCls(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(entry.web);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
      await page.waitForTimeout(900);

      // CLS đọc TRƯỚC bộ dò: bộ dò cuộn từng điều khiển vào tầm nhìn, làm lưới gợi ý vô tận tải thêm trang và dịch chân trang, không phải dịch của người dùng.
      const cls = measuresCls(entry.key) ? await readClsTotal(page) : undefined;
      let p;
      try {
        p = await probeW182(page, { touch: size.width <= 768, capsule: false });
      } catch (e) {
        recordFailure('web', entry, size, String(e));
        throw e;
      }
      if (SHOTS) {
        await shootJpeg(page, shotPath('web', entry.key, size, ''), true);
        record('web', entry, size, p, cls);
        return;
      }
      expect(p.overflowX, `tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      if (size.width <= 768) expect(p.small, `vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, 'chữ đè nhau').toEqual([]);
      expect(p.floating.filter((f) => f.overlaps.length > 0), 'nút nổi đè nội dung').toEqual([]);
      expect(p.ellipsizedCta, 'nhãn nút bị cắt thành …').toEqual([]);
      // CLS của web đã có bộ giữ riêng (home-cls.web.spec: trần 0,1 khi máy mới, 0,02 khi đã nhớ hoặc tổng quan về nhanh); ở đây chỉ chặn PDP ở mức "tốt" của Core Web Vitals.
      if (cls && entry.key === '/product/:slug') expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(0.1);
    });
  }
}
