import { expect, test, mockSession } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockTourWorld, tourUser } from './support/tour-world';
import { installVisualMode, settle } from './support/visual';
import { MAIN, SHOTS, MINI_SIZES_AUDIT, MINI_SIZES_GUARD, auditEntries, measuresCls, record, recordFailure, shootJpeg, shotPath } from './support/w182-audit';
import { probeW182 } from './support/w182-probe';

/**
 * W182: nghiệm thu cuối Mini App ở 320/360/375/393px. Mỗi màn khách trong route-map.json được mở với dữ liệu đủ nội dung (cùng mock với tham quan),
 * đo bằng `probeW182` và (khi có W182_SHOTS) chụp ảnh. Khi có W182_SHOTS chỉ ghi nhật ký để lập bảng kiểm toán; không có thì là guard CI
 * cho các màn chính: không tràn ngang, mọi nút/liên kết >= 44px, không hai đoạn chữ đè nhau, không nút nổi đè nội dung.
 * `--safe-top` được ép 47px để mô phỏng iPhone có tai thỏ: capsule Zalo nằm trong dải đó, nội dung không được chui vào.
 */
const SIZES = SHOTS ? MINI_SIZES_AUDIT : MINI_SIZES_GUARD;

// Guard lọc theo danh sách MAIN: một màn đổi tên trong route-map.json sẽ lặng lẽ rơi khỏi guard nếu không kiểm số lượng.
if (!SHOTS) {
  test('w182 guard phủ đủ các màn chính của Mini App', () => {
    expect(auditEntries().map((e) => e.key).sort()).toEqual([...MAIN].sort());
  });
}

for (const size of SIZES) {
  for (const entry of auditEntries()) {
    test(`w182 ${entry.key} ${size.width}px: không tràn ngang, vùng chạm đủ 44px, chữ không đè`, async ({ page, api }) => {
      const user = tourUser(entry.role);
      mockSession(api, user);
      mockTourWorld(api, user);
      entry.setup?.(api);
      // Các màn này gọi vài đường mà bản tham quan không mock; 404 là trạng thái đã đo ở bước kiểm toán, không phải lỗi của guard hình học.
      api.allowUnmocked('GET /auth/me', 'GET /waste/requests', 'POST /cart/coupon');
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
      expect(p.ellipsizedCta, 'nhãn nút bị cắt thành …').toEqual([]);
      // Số tiền/điểm/số lượng phải đều (tabular-nums) theo TỪNG phần tử; đặt ở body bị cấm vì kế thừa vào ô giảm giá (coupon-discount-no-tabular.spec).
      expect(p.notTabular, 'số thiếu tabular-nums').toEqual([]);
      if (entry.key === '/') {
        // Header dính của Trang chủ không được che khối kế tiếp ở đầu trang (`top` đo từ mép nội dung của `.page`, đã đệm `--safe-top`): ép safe-top 47px ở trên
        // mới lộ lỗi cộng đôi vùng an toàn. Hàng chip Gợi ý khi đã dính phải khít dưới header, không hở một khe để thẻ sản phẩm trôi lộ ra.
        const geo = await page.evaluate(() => {
          const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'));
          const header = blocks.find((b) => b.dataset.homeBlock === 'search');
          if (!header) return null;
          const headerBottom = header.getBoundingClientRect().bottom;
          const next = blocks.find((b) => b !== header && b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().top >= header.getBoundingClientRect().top);
          const nextTop = next ? next.getBoundingClientRect().top : null;
          const scroller = document.querySelector<HTMLElement>('.zaui-page');
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
          const chips = document.querySelector<HTMLElement>('[role="region"][aria-label="Lọc gợi ý theo danh mục"]');
          const hb = header.getBoundingClientRect().bottom;
          return { headerBottom, nextTop, chipsTop: chips ? chips.getBoundingClientRect().top : null, stuckHeaderBottom: hb };
        });
        expect(geo, 'Trang chủ có khối search').not.toBeNull();
        if (geo && geo.nextTop !== null) expect(geo.nextTop, 'header dính không che khối kế tiếp').toBeGreaterThanOrEqual(geo.headerBottom - 0.5);
        if (geo && geo.chipsTop !== null && geo.chipsTop < geo.stuckHeaderBottom + 120) expect(Math.abs(geo.chipsTop - geo.stuckHeaderBottom), 'chip Gợi ý khít dưới header').toBeLessThanOrEqual(1);
      }
      if (cls) expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(0.02);
    });
  }
}
