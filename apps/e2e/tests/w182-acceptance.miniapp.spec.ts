import { expect, test, mockSession } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockTourWorld, tourUser } from './support/tour-world';
import { installVisualMode, settle } from './support/visual';
import { SHOTS, MINI_SIZES_AUDIT, MINI_SIZES_GUARD, auditEntries, measuresCls, record, recordFailure, shootJpeg, shotPath } from './support/w182-audit';
import { probeW182 } from './support/w182-probe';

/**
 * W182: nghiệm thu cuối Mini App ở 320/360/375/393px. Mỗi màn khách trong route-map.json được mở với dữ liệu đủ nội dung (cùng mock với tham quan),
 * đo bằng `probeW182` và (khi có W182_SHOTS) chụp ảnh. Khi có W182_SHOTS chỉ ghi nhật ký để lập bảng kiểm toán; không có thì là guard CI
 * cho các màn chính: không tràn ngang, mọi nút/liên kết >= 44px, không hai đoạn chữ đè nhau, không nút nổi đè nội dung.
 * `--safe-top` được ép 47px để mô phỏng iPhone có tai thỏ: capsule Zalo nằm trong dải đó, nội dung không được chui vào.
 */
const SIZES = SHOTS ? MINI_SIZES_AUDIT : MINI_SIZES_GUARD;

for (const size of SIZES) {
  for (const entry of auditEntries()) {
    test(`w182 ${entry.key} ${size.width}px: không tràn ngang, vùng chạm đủ 44px, chữ không đè`, async ({ page, api }) => {
      const user = tourUser(entry.role);
      mockSession(api, user);
      mockTourWorld(api, user);
      entry.setup?.(api);
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('tubu_garden_hint_seen', '1');
        } catch {
          // không có localStorage: màn vẫn dựng
        }
        const add = () => {
          const el = document.createElement('style');
          el.textContent = ':root{--safe-top:47px !important}';
          (document.head ?? document.documentElement).appendChild(el);
        };
        if (document.head) add();
        else document.addEventListener('DOMContentLoaded', add, { once: true });
      });
      await installVisualMode(page);
      if (measuresCls(entry.key)) await observeCls(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(entry.miniapp);
      await expect
        .poll(() => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length + api.callsTo('POST', '/auth/refresh').length, { timeout: 8000 })
        .toBeGreaterThan(0)
        .catch(() => {});
      await settle(page);
      await page.waitForTimeout(600);
      // Màn tự cuộn xuống cuối (chat) hay giữ vị trí cuộn: đo ở đầu trang để nội dung trôi dưới nút Quay lại cố định không bị tính là đè.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll<HTMLElement>('.zaui-page').forEach((el) => {
          el.scrollTop = 0;
        });
      });
      await page.waitForTimeout(200);

      let p;
      try {
        p = await probeW182(page, { touch: true, capsule: true });
      } catch (e) {
        recordFailure('miniapp', entry, size, String(e));
        throw e;
      }
      const cls = measuresCls(entry.key) ? await readClsTotal(page) : undefined;
      if (SHOTS) {
        await shootJpeg(page, shotPath('miniapp', entry.key, size, '-s0'), false);
        for (let i = 1; i <= 2; i += 1) {
          const moved = await page.evaluate((step) => {
            const el = (document.querySelector('.zaui-page') as HTMLElement | null) ?? document.scrollingElement!;
            const before = el.scrollTop;
            el.scrollTop = before + step;
            return el.scrollTop > before;
          }, size.height - 120);
          if (!moved) break;
          await page.waitForTimeout(250);
          await shootJpeg(page, shotPath('miniapp', entry.key, size, `-s${i}`), false);
        }
        record('miniapp', entry, size, p, cls);
        return;
      }
      expect(p.overflowX, `tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      expect(p.small, `vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.textOverlap, 'chữ đè nhau').toEqual([]);
      expect(p.floating.filter((f) => f.overlaps.length > 0), 'nút nổi đè nội dung').toEqual([]);
      if (cls) expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(0.02);
    });
  }
}
