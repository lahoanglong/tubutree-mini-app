// Nhóm H: quét bố cục + lỗi console trên các trang chính ở 390x844 và 1440x900 với ba loại khách (ghé, quay lại, mới chưa SĐT).
// Khách có nhiều mã giảm giá trong ví (new_nophone có 4 mã) làm lộ lỗi tràn ngang ở trang sản phẩm (U6-B01).
import {
  Recorder, finish, openWeb, nav, bodyText, badReqs, overflowX, sql, call, clearCart, variantId,
} from './_lib.mjs';

const rec = new Recorder('h-layout');
const WIDTHS = [390, 1440];
const PAGES = [
  '/', '/san-pham', '/san-pham?q=serum', '/san-pham/dau-tram-be-cobote', '/san-pham/serum-duong-am-visante', '/san-pham/nuoc-rua-chen-fuwa3e',
  '/s/uatctv', '/brand/fuwa3e', '/dang-nhap', '/gio-hang', '/thanh-toan', '/tai-khoan', '/tai-khoan/diem-xanh', '/tai-khoan/don-hang', '/tai-khoan/dia-chi',
  '/kho-qua', '/vuon-xanh', '/cong-dong', '/mua-chung', '/hoan-tien', '/gioi-thieu', '/cau-chuyen',
];

/** Phần tử không bị cắt bởi vùng cuộn ngang mà vẫn vượt khổ màn hình (thủ phạm gây tràn). */
const culprits = (page, vw) =>
  page.evaluate((limit) => {
    const clipped = (e) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > limit + 2 && e.getBoundingClientRect().width > 0 && !clipped(e))
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 70)} w=${Math.round(e.getBoundingClientRect().width)}`);
  }, vw);

for (const w of WIDTHS) {
  for (const [alias, label] of [['guest', 'khách ghé'], ['returning', 'khách quay lại (3 mã)'], ['new_nophone', 'khách mới không SĐT (4 mã)']]) {
    await rec.run(`U6-80-${alias}-${w}`, { role: label, journey: 'Quét bố cục', steps: `Mở ${PAGES.length} trang chính (khách quay lại thêm chi tiết đơn từng trạng thái và trang QR chuyển khoản), đo scrollWidth so với khổ máy ${w}px và đếm lỗi console/request (${w}px)`, expected: 'Không trang nào tràn ngang (scrollWidth ≤ khổ máy), không lỗi console ngoài nhiễu đã biết, không request 5xx/lỗi mạng' }, async (c) => {
      // Khách quay lại có đơn đủ trạng thái: quét thêm chi tiết đơn từng trạng thái và trang QR chuyển khoản của một đơn mới chưa trả.
      const extra = [];
      let bankCode = null;
      if (alias === 'returning') {
        for (const r of await sql(`SELECT DISTINCT ON (status) code, status FROM orders WHERE "userId" = 'uat_returning' AND status IN ('CONFIRMED','SHIPPING','DELIVERED','CANCELLED') ORDER BY status, "createdAt" DESC`)) extra.push(`/tai-khoan/don-hang/${r.code}`);
        await clearCart(alias);
        await call(alias, 'POST', '/cart/items', { variationId: await variantId('POLANG-LG-10'), quantity: 1 });
        const addr = (await sql(`SELECT id FROM addresses WHERE "userId" = 'uat_returning' ORDER BY "isDefault" DESC LIMIT 1`))[0];
        const pl = await call(alias, 'POST', '/checkout/place-order', { addressId: addr.id, paymentMethod: 'BANK_TRANSFER' });
        bankCode = pl.body?.code ?? pl.body?.orders?.[0]?.code ?? null;
        if (bankCode) extra.push(`/tai-khoan/don-hang/${bankCode}`, `/thanh-toan/chuyen-khoan/${bankCode}`);
        else c.note(`không dựng được đơn chuyển khoản mẫu: ${pl.status} ${JSON.stringify(pl.body).slice(0, 160)}`);
      }
      if (alias !== 'guest') {
        await clearCart(alias);
        await call(alias, 'POST', '/cart/items', { variationId: await variantId('COBOTE-TR-50'), quantity: 1 });
      }
      const s = await openWeb(alias, { width: w, path: '/' });
      const over = [];
      const errs = [];
      const bad5 = [];
      for (const p of [...PAGES, ...extra]) {
        if (alias === 'guest' && ['/gio-hang', '/thanh-toan', '/tai-khoan', '/tai-khoan/diem-xanh', '/tai-khoan/don-hang', '/tai-khoan/dia-chi', '/kho-qua', '/vuon-xanh', '/hoan-tien'].includes(p)) {
          // khách ghé: các trang riêng chỉ cần mời đăng nhập, vẫn đo bố cục
        }
        const r = await nav(s, p, { wait: 700 });
        const ox = await overflowX(s.page);
        if (ox.sw > ox.iw + 1) over.push({ page: p, sw: ox.sw, device: ox.iw, culprits: await culprits(s.page, ox.iw) });
        const ce = r.consoleErrs.filter((x) => !/brand\/owner\/me|Failed to load resource: the server responded with a status of 404/.test(x));
        if (ce.length || r.errs.length) errs.push({ page: p, console: ce.slice(0, 2), page_errors: r.errs.slice(0, 2).map((e) => String(e).slice(0, 160)) });
        const b5 = badReqs(r.reqs).filter((x) => / 5\d\d$| 0$/.test(x));
        if (b5.length) bad5.push({ page: p, reqs: b5 });
        if (p === '/san-pham/dau-tram-be-cobote' && ox.sw > ox.iw + 1) await c.shot(s.page, `pdp-tran-ngang`);
      }
      c.ev('trang tràn ngang', over);
      c.ev('lỗi console/trang', errs);
      c.ev('request 5xx', bad5);
      c.ok(`không trang nào tràn ngang (${PAGES.length + extra.length} trang)`, over.length === 0, over);
      c.ok('không lỗi console/trang ngoài nhiễu đã biết', errs.length === 0, errs);
      c.ok('không request 5xx/lỗi mạng', bad5.length === 0, bad5);
      if (alias !== 'guest') await clearCart(alias);
      if (bankCode) await call(alias, 'POST', `/orders/${bankCode}/cancel`, {});
      await s.close();
    });
  }
}

await finish(rec);
