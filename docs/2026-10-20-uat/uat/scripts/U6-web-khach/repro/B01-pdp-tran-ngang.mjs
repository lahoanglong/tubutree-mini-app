// U6-B01: trang sản phẩm tràn ngang ở 390px khi khách có nhiều mã giảm giá dùng được.
// Chạy:  node repro/B01-pdp-tran-ngang.mjs   (lane 6 đang chạy). Kỳ vọng sau khi sửa: scrollWidth = 390 cho cả hai khách.
import { openWeb, nav, overflowX, finish, Recorder, sql } from '../_lib.mjs';
const rec = new Recorder('repro-B01');
await rec.run('U6-B01', { role: 'Khách có 3 và 4 mã trong ví', journey: 'Trang sản phẩm', steps: 'Mở /san-pham/dau-tram-be-cobote ở 390px bằng uat_returning (3 mã) và uat_new_nophone (4 mã)', expected: 'scrollWidth ≤ 390 (không tràn ngang)' }, async (c) => {
  for (const who of ['returning', 'new_nophone']) {
    const s = await openWeb(who, { width: 390, path: '/' });
    await nav(s, '/san-pham/dau-tram-be-cobote', { wait: 2000 });
    const ox = await overflowX(s.page);
    const coupons = (await s.page.locator('ul[aria-label="Mã giảm giá có thể dùng"] li').count());
    c.ev(`${who}`, { ...ox, chipMaGiamGia: coupons });
    c.ok(`${who}: scrollWidth ${ox.sw} ≤ khổ máy ${ox.iw} (có ${coupons} thẻ mã trên trang)`, ox.sw <= ox.iw + 1, ox);
    if (who === 'new_nophone') await c.shot(s.page, 'B01-pdp-tran-ngang-390');
    await s.close();
  }
});
await finish(rec);
