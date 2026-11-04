// C7: giao diện thật của lane 6 — CTV, gian hàng, đại lý, chủ nhãn — ở Mini 375, web 375, web 1280. Chụp ảnh, đọc chữ, so Mini với web 375.
// Chạy sau c1..c6 (và c8): node c7-ui.mjs [lọc-id] (từ gốc worktree uat-1104). Ảnh + chữ vào shots/L6-ctv-dai-ly-nhan/.
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, check, done, sql, sleep } from './common.mjs';

const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);
fs.mkdirSync(SHOTS, { recursive: true });

const FILTER = process.argv[2] ?? '';
const VP = { mini375: { w: 375, h: 812 }, web375: { w: 375, h: 812 }, web1280: { w: 1280, h: 800 } };
const BRAND_ID = '75ae0443eea88aa90f3c2bec9bc3ece1';
const BAD_COPY = /Vui lòng|chúng tôi|\.\.\.|…/i;

async function visit(surface, persona, route, name, { wait = 2500, act } = {}) {
  const vp = VP[surface];
  const s = surface === 'mini375'
    ? await open(6, persona, { path: route, viewport: { width: vp.w, height: 1900, isMobile: true } })
    : await openWeb(6, persona, { path: route, viewport: { width: vp.w, height: vp.h, isMobile: surface === 'web375' } });
  try {
    await s.page.waitForTimeout(wait);
    if (act) await act(s.page);
    const shot = path.join(SHOTS, `${surface}-${name}.png`);
    await s.page.screenshot({ path: shot, fullPage: true });
    const info = await s.page.evaluate(() => ({
      text: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      url: location.pathname + location.search,
    }));
    fs.writeFileSync(path.join(SHOTS, `${surface}-${name}.txt`), info.text);
    return { ...info, shot, errors: [...(s.errors ?? []), ...(s.consoleErrors ?? [])] };
  } finally {
    await s.close();
  }
}
const T = (title, persona, step, expect) => ({ title, persona, size: 'Mini 375 + web 375 + web 1280', journey: title, step, expect });
const external = (links) => links.filter((h) => /^https?:\/\//i.test(h) && !/localhost|127\.0\.0\.1/.test(h));
const WEB_FOOTER = new Set(['Hotline: 0984 606 774', 'Điều khoản', 'Bảo mật', 'Đổi trả', 'Vận chuyển', 'Facebook', 'TikTok', 'tubutree@gmail.com']);
const lines = (t) => t.split('\n').map((x) => x.trim()).filter((x) => x.length > 1);
/** Phần nội dung của web: bỏ đầu trang (thanh tìm kiếm, menu) đến dòng "← Tài khoản", bỏ chân trang. */
const webContent = (t) => {
  let l = lines(t);
  const back = l.findIndex((x) => /^← /.test(x));
  if (back >= 0) l = l.slice(back + 1);
  const foot = l.findIndex((x) => /^Sống xanh An Lành/.test(x));
  if (foot >= 0) l = l.slice(0, foot);
  return l.filter((x) => !WEB_FOOTER.has(x));
};
const norm = (x) => x.replace(/[“”]/g, '"').replace(/tồn \d+/g, 'tồn N');
const miniContent = (t) => lines(t);

await call('admin', 'PATCH', `/admin/brands/${BRAND_ID}`, { isPublished: true });
await sleep(300);

const R = (mini, web) => ({ mini375: mini, web375: web, web1280: web });
const plan = [
  { id: 'U01', key: 'CTV', persona: 'ctv', routes: R('/affiliate', '/ctv'), name: 'ctv-trang-chu', title: 'CTV đã duyệt: trang Cộng tác viên', must: [/Có thể chuyển vào Ví/, /Thưởng mốc doanh số tháng/, /Bảng 5 bậc CTV/, /CTV Bạc/] },
  { id: 'U02', key: 'SF-OWNER', persona: 'ctv', routes: R('/storefront', '/ctv/gian-hang'), name: 'ctv-gian-hang', title: 'CTV có gian hàng đã duyệt: màn Gian hàng của tôi', must: [/Đang hiển thị/, /\/s\/uatctv/, /Thống kê 30 ngày/, /Sản phẩm nổi bật/] },
  { id: 'U03', key: 'SF-PENDING', persona: 'ctv_pending', routes: R('/storefront', '/ctv/gian-hang'), name: 'ctvcho-gian-hang', title: 'CTV gian hàng chờ duyệt: báo chờ duyệt, chưa chia sẻ được', must: [/Chờ duyệt/, /Tubu đang duyệt/, /Chia sẻ sau/] },
  { id: 'U04', key: 'SF-PUB', persona: 'new', routes: R('/s/uatctv', '/s/uatctv'), name: 'cong-khai-da-duyet', title: 'Khách xem gian hàng đã duyệt', must: [/Góc Xanh Của Phạm CTV/] },
  { id: 'U05', key: 'SF-PUBPEND', persona: 'new', routes: R('/s/uatctvpending', '/s/uatctvpending'), name: 'cong-khai-cho-duyet', title: 'Khách xem gian hàng chờ duyệt: không thấy (không tìm thấy)', must: [/Không tìm thấy/, /không tồn tại hoặc đã ngừng hoạt động/], mustNot: [/Nhà Sạch Của Võ Thị/], allowErrors: 2 },
  { id: 'U06', key: 'DEALER', persona: 'dealer', routes: R('/dealer', '/dai-ly'), name: 'dai-ly', title: 'Đại lý: Kênh đại lý, bảng giá -30%, hạn mức, công nợ', must: [/Kênh đại lý/, /Đại lý Cấp 2/, /Hạn mức: 20\.000\.000đ/, /-30%/, /Bảng giá/, /Công nợ/] },
  { id: 'U07', key: 'DEALER-NEW', persona: 'brand', routes: R('/dealer', '/dai-ly'), name: 'khach-thuong-vao-dai-ly', title: 'Khách thường vào Kênh đại lý: thấy hồ sơ đăng ký, không thấy bảng giá sỉ', must: [], mustNot: [/-30%/, /Bảng giá/] },
  { id: 'U08', key: 'DEALER-PENDING', persona: 'new', routes: R('/dealer', '/dai-ly'), name: 'khach-nop-ho-so-dai-ly', title: 'Khách đã nộp hồ sơ đại lý: hồ sơ đang được duyệt, không thấy giá sỉ', must: [/Hồ sơ đang được duyệt/], mustNot: [/-30%/, /Bảng giá/] },
  { id: 'U09', key: 'BRAND-OWNER', persona: 'brand', routes: R('/brand-owner', '/chu-thuong-hieu'), name: 'chu-nhan', title: 'Chủ nhãn: Quản lý thương hiệu', must: [/Quản lý thương hiệu/, /Fuwa3e/, /Hồ sơ & khuyến mãi/, /Doanh thu/] },
  { id: 'U10', key: 'BRAND-PUB', persona: 'new', routes: R('/brand/fuwa3e', '/brand/fuwa3e'), name: 'nhan-cong-khai', title: 'Khách xem trang nhãn Fuwa3e', must: [/Fuwa3e/, /Theo dõi/, /Sản phẩm/], mustNot: [/hoa hồng/i] },
  { id: 'U11', key: 'CTV-NEW', persona: 'new', routes: R('/affiliate', '/ctv'), name: 'khach-thuong-vao-ctv', title: 'Khách thường vào trang CTV: màn đăng ký + điều khoản thuế, không thấy ví hoa hồng', must: [/Trở thành CTV Tubu/, /Điều khoản hoa hồng & thuế/, /Đăng ký miễn phí ngay/], mustNot: [/Có thể chuyển vào Ví/] },
  { id: 'U12', key: 'BRAND-NEW', persona: 'new', routes: R('/brand-owner', '/chu-thuong-hieu'), name: 'khach-thuong-vao-chu-nhan', title: 'Khách thường vào màn chủ nhãn: không thấy dữ liệu nhãn', must: [], mustNot: [/Doanh thu/, /Lưu thông tin/] },
];

const seen = {};
for (const p of plan) {
  if (FILTER && !p.key.includes(FILTER)) continue;
  const res = {};
  for (const surface of ['mini375', 'web375', 'web1280']) {
    try {
      res[surface] = await visit(surface, p.persona, p.routes[surface], p.name);
    } catch (e) {
      res[surface] = { text: '', links: [], overflowX: 0, errors: [`LỖI MỞ: ${String(e.message).slice(0, 160)}`], url: '' };
    }
  }
  seen[p.key] = res;
  const probs = [];
  for (const surface of Object.keys(res)) {
    const r = res[surface];
    if (r.overflowX > 0) probs.push(`${surface} tràn ngang ${r.overflowX}px`);
    if (r.errors.length > (p.allowErrors ?? 0)) probs.push(`${surface} lỗi JS/console: ${r.errors[0]?.slice(0, 120)}`);
    for (const m of p.must) if (!m.test(r.text)) probs.push(`${surface} thiếu ${m}`);
    for (const m of p.mustNot ?? []) if (m.test(r.text)) probs.push(`${surface} có chữ không được có ${m}`);
    const bad = r.text.match(BAD_COPY);
    if (bad) probs.push(`${surface} chữ cấm "${bad[0]}"`);
  }
  if (external(res.mini375.links).length) probs.push(`Mini có link ngoài: ${external(res.mini375.links)}`);
  const mini = new Set(miniContent(res.mini375.text).map(norm));
  const web = new Set(webContent(res.web375.text).map(norm));
  const onlyMini = [...mini].filter((x) => !web.has(x));
  const onlyWeb = [...web].filter((x) => !mini.has(x));
  const w1280 = new Set(webContent(res.web1280.text).map(norm));
  const lost1280 = [...web].filter((x) => !w1280.has(x));
  if (onlyMini.length + onlyWeb.length > 0) probs.push(`lệch Mini/web375: chỉ Mini=${JSON.stringify(onlyMini.slice(0, 4))} chỉ web=${JSON.stringify(onlyWeb.slice(0, 4))}`);
  if (lost1280.length) probs.push(`web 1280 mất so với web 375: ${JSON.stringify(lost1280.slice(0, 4))}`);
  const shots = Object.keys(res).map((s) => `shots/L6-ctv-dai-ly-nhan/${s}-${p.name}.png`).join(', ');
  check(`L6-${p.id}`, T(p.title, p.persona, `mở ${p.routes.mini375} (Mini) và ${p.routes.web375} (web) ở ba khổ`, 'đúng nội dung theo vai trò; không tràn ngang, không lỗi JS; Mini không link ngoài; không chữ "Vui lòng/chúng tôi/…"; chữ Mini = web 375; web 1280 đủ nội dung của web 375'), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 700) : `ba khổ đủ ý; Mini = web 375 (${mini.size} dòng); ${shots}`, shots);
}

// ---------- số liệu trang CTV so SQL ----------
if (!FILTER || 'CTV'.includes(FILTER)) {
  const U = 'uat_ctv';
  const [a] = await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status::text='APPROVED'`, U);
  const [pn] = await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status::text IN ('PENDING','LOCKED')`, U);
  const [mo] = await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status::text<>'REJECTED' AND ("createdAt" + interval '7 hours') >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`, U);
  const [rv] = await sql(`SELECT COALESCE(SUM("commissionableTotal"),0)::int s FROM commissions WHERE "affiliateUserId"=$1 AND status::text IN ('APPROVED','PAID') AND ("approvedAt" + interval '7 hours') >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`, U);
  const [wl] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id=$1`, U);
  const fmt = (n) => `${n.toLocaleString('vi-VN')}đ`;
  const probs = [];
  for (const surface of ['mini375', 'web375', 'web1280']) {
    const t = seen.CTV?.[surface]?.text ?? '';
    const want = [[`${fmt(a.s)}`, 'Có thể chuyển'], [`Đang chờ: ${fmt(pn.s)}`, 'Đang chờ'], [`Số dư Ví: ${fmt(wl.w)}`, 'Số dư Ví'], [`Đã chốt: ${fmt(rv.s)}`, 'Đã chốt'], [`${fmt(mo.s)}\nTạm tính tháng này`, 'Tạm tính tháng']];
    for (const [needle, label] of want) if (!t.includes(needle)) probs.push(`${surface} không có "${needle.replace('\n', ' / ')}" (${label})`);
  }
  check('L6-U13', T('Số trên trang CTV khớp SQL (có thể chuyển, đang chờ, Ví, doanh số đã chốt tháng, tạm tính tháng)', 'ctv', 'đọc trang /affiliate và /ctv, so với SQL commissions + users.walletBalance', `APPROVED ${a.s}; PENDING+LOCKED ${pn.s}; Ví ${wl.w}; nền đã chốt tháng ${rv.s}; tạm tính tháng (trừ REJECTED) ${mo.s}`), probs.length === 0 && !!seen.CTV, probs.length ? probs.join(' | ') : `khớp ở ba khổ: ${a.s}/${pn.s}/${wl.w}/${rv.s}/${mo.s}`, 'SQL');
}

await call('admin', 'PATCH', `/admin/brands/${BRAND_ID}`, { isPublished: false });
await done();
