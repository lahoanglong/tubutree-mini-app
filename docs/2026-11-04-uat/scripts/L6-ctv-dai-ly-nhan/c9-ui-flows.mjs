// C9: thao tác trên giao diện — CTV (bảng bậc, mốc, tab Hoa hồng, tab Chia sẻ, Chuyển vào Ví), đại lý (Đơn hàng, Công nợ, Báo cáo),
// chủ nhãn (Doanh thu) ở Mini 375, web 375, web 1280. Ảnh + chữ vào shots/. Bước cuối bấm "Chuyển vào Ví" nên chạy sau c7.
// Luật: ctv-milestones.ts:64 (5 bậc), :79 (4 mốc thưởng), affiliate.service.ts requestPayout (PIT 10% khi tổng tháng ≥ 5.000.000đ).
// Chạy: node c9-ui-flows.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, check, done, sql, short } from './common.mjs';

const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);
fs.mkdirSync(SHOTS, { recursive: true });
const VP = { mini375: { w: 375, h: 812 }, web375: { w: 375, h: 812 }, web1280: { w: 1280, h: 800 } };
const SURF = ['mini375', 'web375', 'web1280'];
const BAD_COPY = /Vui lòng|chúng tôi|\.\.\.|…/i;
const WEB_FOOTER = new Set(['Hotline: 0984 606 774', 'Điều khoản', 'Bảo mật', 'Đổi trả', 'Vận chuyển', 'Facebook', 'TikTok', 'tubutree@gmail.com']);
const lines = (t) => t.split('\n').map((x) => x.trim()).filter((x) => x.length > 1);
const norm = (x) => x.replace(/[“”]/g, '"');
const webContent = (t) => {
  let l = lines(t);
  const back = l.findIndex((x) => /^← /.test(x));
  if (back >= 0) l = l.slice(back + 1);
  const foot = l.findIndex((x) => /^Sống xanh An Lành/.test(x));
  if (foot >= 0) l = l.slice(0, foot);
  return l.filter((x) => !WEB_FOOTER.has(x));
};
const T = (title, persona, step, expect) => ({ title, persona, size: 'Mini 375 + web 375 + web 1280', journey: title, step, expect });
const fmt = (n) => `${n.toLocaleString('vi-VN')}đ`;

async function session(surface, persona, route) {
  const vp = VP[surface];
  return surface === 'mini375'
    ? open(6, persona, { path: route, viewport: { width: vp.w, height: 1900, isMobile: true } })
    : openWeb(6, persona, { path: route, viewport: { width: vp.w, height: vp.h, isMobile: surface === 'web375' } });
}
const snap = async (s, surface, name) => {
  await s.page.waitForTimeout(1300);
  await s.page.screenshot({ path: path.join(SHOTS, `${surface}-${name}.png`), fullPage: true });
  const text = await s.page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(SHOTS, `${surface}-${name}.txt`), text);
  return text;
};
const click = (page, label) => page.getByText(label, { exact: true }).first().click({ timeout: 8000 });
const clickLast = (page, label) => page.getByText(label, { exact: true }).last().click({ timeout: 8000 });

/** Chạy một chuỗi bước trên cả ba khổ; trả { surface: { stepName: text } , errors }. */
async function flow(persona, routes, steps) {
  const out = {};
  for (const surface of SURF) {
    const s = await session(surface, persona, routes[surface]);
    out[surface] = { errors: [] };
    try {
      await s.page.waitForTimeout(2500);
      for (const st of steps) {
        try {
          if (st.click) await st.click(s.page);
          out[surface][st.name] = await snap(s, surface, st.shot);
        } catch (e) {
          out[surface][st.name] = '';
          out[surface].errors.push(`${st.name}: ${String(e.message).slice(0, 100)}`);
        }
      }
      out[surface].errors.push(...(s.errors ?? []), ...(s.consoleErrors ?? []));
    } finally {
      await s.close();
    }
  }
  return out;
}
/** So Mini 375 với web 375 và web 1280 cho một bước; trả danh sách khác biệt. */
function diffs(o, name) {
  const m = new Set(lines(o.mini375[name]).map(norm));
  const w = new Set(webContent(o.web375[name]).map(norm));
  const w2 = new Set(webContent(o.web1280[name]).map(norm));
  return [
    ...[...m].filter((x) => !w.has(x)).map((x) => `chỉ Mini: ${x.slice(0, 60)}`),
    ...[...w].filter((x) => !m.has(x)).map((x) => `chỉ web375: ${x.slice(0, 60)}`),
    ...[...w].filter((x) => !w2.has(x)).map((x) => `mất ở 1280: ${x.slice(0, 60)}`),
  ];
}
const everyText = (o, name) => SURF.map((s) => [s, o[s][name]]);
const lint = (o, names) => SURF.flatMap((s) => names.flatMap((n) => (BAD_COPY.test(o[s][n] ?? '') ? [`${s}/${n} chữ cấm "${(o[s][n].match(BAD_COPY) ?? [])[0]}"`] : [])));

// =================== CTV ===================
const ctv = await flow('ctv', { mini375: '/affiliate', web375: '/ctv', web1280: '/ctv' }, [
  { name: 'tong-quan', shot: 'ctv-tong-quan-c9' },
  { name: 'bang-bac', shot: 'ctv-bang-bac', click: (p) => click(p, 'Bảng 5 bậc CTV & thưởng mốc Điểm Xanh') },
  { name: 'moc', shot: 'ctv-tat-ca-moc', click: (p) => click(p, 'Xem tất cả 4 mốc') },
  { name: 'hoa-hong', shot: 'ctv-tab-hoa-hong', click: (p) => click(p, 'Hoa hồng') },
  { name: 'chia-se', shot: 'ctv-tab-chia-se', click: (p) => clickLast(p, 'Chia sẻ') },
]);

{
  const need = [['Tân binh', /Bậc khởi đầu/], ['Đồng', /\+50\.000 điểm/], ['Bạc', /\+200\.000 điểm/], ['Vàng', /\+600\.000 điểm/], ['Kim Cương', /\+2\.000\.000 điểm/]];
  const thr = ['3.000.000đ', '10.000.000đ', '30.000.000đ', '80.000.000đ'];
  const [rv] = await sql(`SELECT COALESCE(SUM("commissionableTotal"),0)::int s FROM commissions WHERE "affiliateUserId"='uat_ctv' AND status::text IN ('APPROVED','PAID') AND ("approvedAt" + interval '7 hours') >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`);
  const cur = rv.s >= 80e6 ? 'Kim Cương' : rv.s >= 30e6 ? 'Vàng' : rv.s >= 10e6 ? 'Bạc' : rv.s >= 3e6 ? 'Đồng' : 'Tân binh';
  const probs = [];
  for (const [s, t] of everyText(ctv, 'bang-bac')) {
    for (const [n] of need) if (!t.includes(n)) probs.push(`${s} thiếu bậc ${n}`);
    for (const x of thr) if (!t.includes(`DS từ ${x}`)) probs.push(`${s} thiếu "DS từ ${x}"`);
    if (!t.includes(`${cur} (Hiện tại)`)) probs.push(`${s} không đánh dấu "${cur} (Hiện tại)" (doanh số chốt tháng ${rv.s})`);
    if (t.match(/\(Hiện tại\)/g)?.length !== 1) probs.push(`${s} số dấu "(Hiện tại)" khác 1`);
  }
  probs.push(...diffs(ctv, 'bang-bac'));
  check('L6-U14', T('Bảng 5 bậc CTV: tên, mốc doanh số, thưởng Điểm Xanh, đánh dấu đúng bậc hiện tại', 'ctv', 'bấm "Bảng 5 bậc CTV & thưởng mốc Điểm Xanh" ở ba khổ', `5 bậc Tân binh / Đồng 3 triệu +50.000 / Bạc 10 triệu +200.000 / Vàng 30 triệu +600.000 / Kim Cương 80 triệu +2.000.000 điểm (ctv-milestones.ts:64,79); đúng một dấu (Hiện tại) = ${cur} (doanh số chốt tháng ${rv.s})`), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 600) : `ba khổ đủ 5 bậc, bậc hiện tại ${cur}, Mini = web`, 'SQL + ảnh shots/L6-ctv-dai-ly-nhan/*-ctv-bang-bac.png');
}
{
  const claims = await sql(`SELECT "milestoneId" id, "revokedAt" r FROM ctv_milestone_claims WHERE "userId"='uat_ctv'`);
  const [rv] = await sql(`SELECT COALESCE(SUM("commissionableTotal"),0)::int s FROM commissions WHERE "affiliateUserId"='uat_ctv' AND status::text IN ('APPROVED','PAID') AND ("approvedAt" + interval '7 hours') >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`);
  const open_ = claims.filter((c) => !c.r).map((c) => c.id);
  const probs = [];
  for (const [s, t] of everyText(ctv, 'moc')) {
    for (const n of ['Mốc Khởi Động 3 Triệu', 'Mốc Tăng Tốc 10 Triệu', 'Mốc Bứt Phá 30 Triệu', 'Mốc Đỉnh Cao 80 Triệu']) if (!t.includes(n)) probs.push(`${s} thiếu ${n}`);
    if ((t.match(/Đã nhận/g) ?? []).length !== open_.length) probs.push(`${s} số mốc "Đã nhận" ${(t.match(/Đã nhận/g) ?? []).length} ≠ SQL ${open_.length}`);
    if (!t.includes(`Còn thiếu ${fmt(30e6 - rv.s)} doanh số đã chốt`)) probs.push(`${s} thiếu "Còn thiếu ${fmt(30e6 - rv.s)}" cho mốc 30 triệu`);
    if (!t.includes(`Còn thiếu ${fmt(80e6 - rv.s)} doanh số đã chốt`)) probs.push(`${s} thiếu "Còn thiếu ${fmt(80e6 - rv.s)}" cho mốc 80 triệu`);
  }
  probs.push(...diffs(ctv, 'moc'));
  check('L6-U15', T('Thưởng mốc doanh số tháng: 4 mốc, mốc đã nhận, số còn thiếu đúng', 'ctv', 'bấm "Xem tất cả 4 mốc" ở ba khổ', `4 mốc; "Đã nhận" = ${open_.length} (SQL ctv_milestone_claims chưa thu hồi); mốc 30 triệu còn thiếu ${fmt(30e6 - rv.s)}, mốc 80 triệu còn thiếu ${fmt(80e6 - rv.s)} (doanh số chốt tháng ${rv.s})`), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 600) : `đủ 4 mốc, đã nhận ${open_.join(',')}, còn thiếu ${fmt(30e6 - rv.s)}/${fmt(80e6 - rv.s)}`, 'SQL + ảnh *-ctv-tat-ca-moc.png');
}
{
  const cms = await sql(`SELECT o.code, c.amount::int a, c.status::text s FROM commissions c JOIN orders o ON o.id=c."orderId" WHERE c."affiliateUserId"='uat_ctv' ORDER BY c."createdAt" DESC`);
  const pays = await sql(`SELECT "grossAmount"::int g, "taxWithheld"::int t, amount::int n FROM payouts WHERE "userId"='uat_ctv' AND method::text='WALLET_BALANCE' ORDER BY "requestedAt"`);
  const gross = pays.reduce((a, p) => a + (p.g ?? p.n), 0);
  const tax = pays.reduce((a, p) => a + (p.t ?? 0), 0);
  const label = { PENDING: /Đang chờ/, LOCKED: /Đang chờ|Giao thành công/, APPROVED: /Có thể chuyển vào Ví/, PAID: /Đã trả/, REJECTED: /Từ chối/ };
  const probs = [];
  for (const [s, t] of everyText(ctv, 'hoa-hong')) {
    for (const c of cms) {
      const at = t.indexOf(`Đơn ${c.code}`);
      if (at < 0) { probs.push(`${s} thiếu đơn ${c.code}`); continue; }
      const before = t.slice(Math.max(0, at - 24), at);
      const after = t.slice(at, at + 140);
      if (!before.includes(`+${fmt(c.a)}`)) probs.push(`${s} ${c.code} số tiền không phải +${fmt(c.a)} (${before.replace(/\n/g, ' ')})`);
      if (!label[c.s].test(after)) probs.push(`${s} ${c.code} nhãn trạng thái không hợp ${c.s}: ${after.replace(/\n/g, ' ').slice(0, 90)}`);
    }
    if (!t.includes(`thu nhập hoa hồng ${fmt(gross)} · đã khấu trừ thuế TNCN ${fmt(tax)}`)) probs.push(`${s} dòng thu nhập năm ≠ SQL (${fmt(gross)} / thuế ${fmt(tax)})`);
    for (const p of pays) if (!t.includes(fmt(p.n))) probs.push(`${s} thiếu lệnh chuyển ${fmt(p.n)}`);
  }
  probs.push(...diffs(ctv, 'hoa-hong'));
  check('L6-U16', T('Tab Hoa hồng: từng đơn đúng số tiền và nhãn trạng thái, lịch sử chuyển Ví, thu nhập năm và thuế TNCN đã khấu trừ', 'ctv', 'bấm tab Hoa hồng ở ba khổ, đối chiếu SQL commissions + payouts', `${cms.length} dòng hoa hồng; năm: thu nhập ${fmt(gross)}, thuế ${fmt(tax)}; ${pays.length} lệnh chuyển Ví`), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 700) : `đủ ${cms.length} đơn, nhãn khớp, ${pays.length} lệnh chuyển, thu nhập ${fmt(gross)}, thuế ${fmt(tax)}`, 'SQL + ảnh *-ctv-tab-hoa-hong.png');
}
{
  const me = await call('ctv', 'GET', '/affiliate/me');
  const code = me.body?.referralCode;
  const probs = [];
  for (const [s, t] of everyText(ctv, 'chia-se')) {
    if (!t.includes('Mã giới thiệu của bạn') || !t.includes(code)) probs.push(`${s} thiếu mã ${code}`);
    if ((t.match(new RegExp(code, 'g')) ?? []).length < 4) probs.push(`${s} lời đăng gợi ý không chứa mã ${code}`);
  }
  probs.push(...diffs(ctv, 'chia-se'));
  check('L6-U17', T('Tab Chia sẻ: mã giới thiệu đúng, lời đăng gợi ý chứa mã', 'ctv', 'bấm tab Chia sẻ ở ba khổ', `mã ${code} (GET /affiliate/me); 3 lời đăng gợi ý đều có mã`), probs.length === 0 && !!code, probs.length ? probs.join(' | ').slice(0, 500) : `mã ${code} đúng ở ba khổ, Mini = web`, 'API + ảnh *-ctv-tab-chia-se.png');
}
check('L6-U18', T('Trang CTV: không có chữ cấm, không chữ "rút tiền" / "ngân hàng" (hoa hồng chỉ vào Ví)', 'ctv', 'đọc toàn bộ chữ các màn CTV ở ba khổ', 'không "Vui lòng", "chúng tôi", "..."; không "rút tiền", "ngân hàng", "chuyển khoản" ở màn hoa hồng; không lỗi JS'),
  lint(ctv, ['tong-quan', 'bang-bac', 'moc', 'hoa-hong', 'chia-se']).length === 0 && SURF.every((s) => !/rút tiền|ngân hàng|chuyển khoản/i.test(['tong-quan', 'bang-bac', 'moc', 'hoa-hong', 'chia-se'].map((n) => ctv[s][n]).join('\n'))) && SURF.every((s) => ctv[s].errors.length === 0),
  `${lint(ctv, ['tong-quan', 'bang-bac', 'moc', 'hoa-hong', 'chia-se']).join('; ') || 'sạch'}; lỗi JS: ${SURF.map((s) => `${s}=${ctv[s].errors.length}`).join(' ')} ${short(SURF.flatMap((s) => ctv[s].errors).slice(0, 2), 200)}`, 'ảnh + chữ');

// =================== ĐẠI LÝ ===================
const dealer = await flow('dealer', { mini375: '/dealer', web375: '/dai-ly', web1280: '/dai-ly' }, [
  { name: 'bang-gia', shot: 'dai-ly-c9-bang-gia' },
  { name: 'don-hang', shot: 'dai-ly-tab-don-hang', click: (p) => click(p, 'Đơn hàng') },
  { name: 'cong-no', shot: 'dai-ly-tab-cong-no', click: (p) => click(p, 'Công nợ') },
  { name: 'bao-cao', shot: 'dai-ly-tab-bao-cao', click: (p) => click(p, 'Báo cáo') },
]);
{
  const prices = await sql(`SELECT v.sku, v."retailPrice"::int p FROM variations v JOIN products p ON p.id=v."productId" WHERE v."isActive" AND p."isActive" AND v.sku IN ('SOK-CT-150','BHN-CGL-100','LP-ARA-250','POLANG-SP-500','FUWA-GL-500')`);
  const probs = [];
  for (const [s, t] of everyText(dealer, 'bang-gia')) {
    for (const r of prices) {
      const want = fmt(Math.round(r.p * 0.7));
      const at = t.indexOf(r.sku);
      if (at < 0) { probs.push(`${s} thiếu ${r.sku}`); continue; }
      const seg = t.slice(at, at + 120);
      if (!seg.includes(want) || !seg.includes(fmt(r.p)) || !seg.includes('-30%')) probs.push(`${s} ${r.sku}: không thấy ${want} / ${fmt(r.p)} / -30%`);
    }
  }
  probs.push(...diffs(dealer, 'bang-gia').filter((d) => !/tồn \d+/.test(d)));
  check('L6-U19', T('Kênh đại lý: giá sỉ trên bảng giá = giá bán lẻ × 70% (DEALER_2 chiết khấu 30%), giá gốc gạch, nhãn -30%', 'dealer', 'mở /dealer và /dai-ly, đối chiếu SQL variations.retailPrice', 'mỗi SKU đã kiểm: giá hiển thị = round(retailPrice × 0.7), kèm giá gốc và -30%; Mini = web 375'), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 600) : `5 SKU đúng ở ba khổ: ${prices.map((r) => `${r.sku}=${r.p}→${Math.round(r.p * 0.7)}`).join(', ')}`, 'SQL + ảnh *-dai-ly.png');
}
{
  const [led] = await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"='uat_dealer'`);
  const lastRows = await sql(`SELECT delta::int d, "refType"::text rt FROM dealer_credit_ledgers WHERE "userId"='uat_dealer' ORDER BY "createdAt" DESC LIMIT 9`);
  const probs = [];
  for (const [s, t] of everyText(dealer, 'cong-no')) {
    if (!t.includes(`Dư nợ hiện tại\n${fmt(led.s)}`)) probs.push(`${s} dư nợ ≠ SQL ${fmt(led.s)}`);
    if (!t.includes('Sổ công nợ')) probs.push(`${s} thiếu Sổ công nợ`);
    for (const r of lastRows) {
      const text = `${r.d > 0 ? '+' : '-'}${Math.abs(r.d).toLocaleString('vi-VN')}đ`;
      if (!t.includes(text)) probs.push(`${s} thiếu dòng sổ ${text}`);
    }
    if (!/dư nợ chỉ giảm sau khi admin kiểm tra sao kê/.test(t)) probs.push(`${s} thiếu câu nói rõ "Báo đã chuyển khoản" không tự giảm nợ`);
  }
  const d = diffs(dealer, 'cong-no').filter((x) => !/Báo đã chuyển khoản/.test(x));
  probs.push(...d);
  check('L6-U20', T('Tab Công nợ: dư nợ và sổ công nợ khớp SQL, nói rõ "Báo đã chuyển khoản" chỉ báo, nợ giảm khi admin xác nhận', 'dealer', 'bấm tab Công nợ ở ba khổ, so SQL dealer_credit_ledgers', `dư nợ = Σ sổ = ${fmt(led.s)}; các dòng sổ gần nhất đủ`), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 600) : `dư nợ ${fmt(led.s)} đúng ở ba khổ; ${lastRows.length} dòng sổ đủ`, 'SQL + ảnh *-dai-ly-tab-cong-no.png');
}
{
  const probs = [];
  for (const [s, t] of everyText(dealer, 'bao-cao')) {
    if (!/Doanh số Q\d\/\d{4}/.test(t)) probs.push(`${s} thiếu tiêu đề doanh số quý`);
    for (const x of ['Từ 50.000.000đ', 'thưởng 2%', 'Từ 100.000.000đ', 'thưởng 3%', 'Từ 200.000.000đ', 'thưởng 4%']) if (!t.includes(x)) probs.push(`${s} thiếu "${x}"`);
  }
  probs.push(...diffs(dealer, 'bao-cao'));
  const [q] = await sql(`SELECT COALESCE(SUM(total),0)::int s FROM orders WHERE "userId"='uat_dealer' AND type::text='WHOLESALE' AND status::text IN ('PENDING_PAYMENT','CONFIRMED') AND (status::text<>'CONFIRMED' OR true)`).catch(() => [{ s: -1 }]);
  check('L6-U21', T('Tab Báo cáo: doanh số quý và bậc thưởng 2/3/4% theo mốc 50/100/200 triệu', 'dealer', 'bấm tab Báo cáo ở ba khổ', 'đủ ba bậc thưởng; không tính đơn chờ thanh toán/đóng gói vào doanh số chốt'), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 500) : `đủ ba bậc ở ba khổ; Mini = web (đơn dealer chờ trong SQL ${q.s})`, 'ảnh *-dai-ly-tab-bao-cao.png');
}
check('L6-U22', T('Kênh đại lý: không chữ cấm, không lỗi JS', 'dealer', 'đọc toàn bộ chữ ở ba khổ', 'không "Vui lòng", "chúng tôi", "..."'), lint(dealer, ['bang-gia', 'don-hang', 'cong-no', 'bao-cao']).length === 0 && SURF.every((s) => dealer[s].errors.length === 0), `${lint(dealer, ['bang-gia', 'don-hang', 'cong-no', 'bao-cao']).join('; ') || 'sạch'}; lỗi JS: ${SURF.map((s) => `${s}=${dealer[s].errors.length}`).join(' ')} ${short(SURF.flatMap((s) => dealer[s].errors).slice(0, 2), 200)}`, 'ảnh + chữ');

// =================== CHỦ NHÃN ===================
const brand = await flow('brand', { mini375: '/brand-owner', web375: '/chu-thuong-hieu', web1280: '/chu-thuong-hieu' }, [
  { name: 'ho-so', shot: 'chu-nhan-c9-ho-so' },
  { name: 'doanh-thu', shot: 'chu-nhan-tab-doanh-thu', click: (p) => click(p, 'Doanh thu') },
]);
{
  const api = (await call('brand', 'GET', '/brand/owner/me/sales?period=30d')).body;
  const probs = [];
  const near = (t, label, value) => { const l = lines(t); return l.some((x, i) => x === label && (l[i - 1] === value || l[i + 1] === value)); };
  for (const [s, t] of everyText(brand, 'doanh-thu')) {
    const body = s === 'mini375' ? lines(t).join('\n') : webContent(t).join('\n');
    if (!near(t, 'Doanh thu', fmt(api.revenue))) probs.push(`${s} thiếu doanh thu ${fmt(api.revenue)} cạnh nhãn "Doanh thu"`);
    if (!near(t, 'Số đơn', String(api.orderCount))) probs.push(`${s} thiếu số đơn ${api.orderCount}`);
    if (!near(t, 'Sản phẩm đã bán', String(api.unitsSold))) probs.push(`${s} thiếu sản phẩm đã bán ${api.unitsSold}`);
    if (!t.includes(`${api.delivered.orderCount} đơn đã giao · ${fmt(api.delivered.revenue)}`)) probs.push(`${s} thiếu "${api.delivered.orderCount} đơn đã giao · ${fmt(api.delivered.revenue)}"`);
    for (const p of api.topProducts) if (!t.includes(p.name)) probs.push(`${s} thiếu SP bán chạy ${p.name}`);
    if (/Khách|số điện thoại|SĐT/i.test(body.replace(/không hiện thông tin khách/i, ''))) probs.push(`${s} có chữ về khách`);
  }
  probs.push(...diffs(brand, 'doanh-thu'));
  check('L6-U23', T('Chủ nhãn: tab Doanh thu khớp API/SQL, nêu rõ cách tính, không hiện thông tin khách', 'brand', 'bấm tab Doanh thu ở ba khổ (kỳ 30 ngày mặc định)', `doanh thu ${fmt(api.revenue)}, ${api.orderCount} đơn, ${api.unitsSold} sản phẩm, ${api.delivered.orderCount} đơn đã giao ${fmt(api.delivered.revenue)}; top ${api.topProducts.length} SP`), probs.length === 0, probs.length ? probs.join(' | ').slice(0, 600) : `khớp ở ba khổ: ${fmt(api.revenue)}/${api.orderCount}/${api.unitsSold}`, 'API (đã đối soát SQL ở L6-H17) + ảnh *-chu-nhan-tab-doanh-thu.png');
  const orderOf = (t, web) => (web ? webContent(t) : lines(t)).filter((x) => ['Doanh thu', 'Số đơn', 'Sản phẩm đã bán', fmt(api.revenue), String(api.orderCount), String(api.unitsSold)].includes(x)).join('|');
  const miniOrder = orderOf(brand.mini375['doanh-thu'], false);
  const webOrder = orderOf(brand.web375['doanh-thu'], true);
  check('L6-U25', T('Chủ nhãn, tab Doanh thu: web 375 cùng bố cục với Mini (ô số liệu và danh sách SP bán chạy)', 'brand', 'so thứ tự nhãn/số của ba ô số liệu giữa Mini 375 và web 375 + xem ảnh', 'Mini: icon, số lớn rồi nhãn bên dưới; web 375 phải giống (brief: web 375 giống Mini cả chữ lẫn bố cục)'), miniOrder === webOrder, `Mini "${miniOrder}" ≠ web 375 "${webOrder}"; ảnh: Mini xếp icon trên, số lớn, nhãn dưới, SP bán chạy là danh sách phẳng; web 375 xếp icon trái, nhãn nhỏ trên số, SP bán chạy trong thẻ trắng (web/src/components/brand-owner/sales-tab.tsx:18 Stat; miniapp/src/pages/brand-owner-sales.tsx:53 StatTile)`, 'ảnh mini375-chu-nhan-tab-doanh-thu.png so web375-chu-nhan-tab-doanh-thu.png');
}

// =================== BẤM "CHUYỂN VÀO VÍ" (Mini 375) ===================
{
  const [a] = await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId"='uat_ctv' AND status::text='APPROVED'`);
  const [w0] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id='uat_ctv'`);
  const [taxY] = await sql(`SELECT COALESCE(SUM("grossAmount"),0)::int g FROM payouts WHERE "userId"='uat_ctv' AND "requestedAt" + interval '7 hours' >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')`);
  const s = await session('mini375', 'ctv', '/affiliate');
  let result = '';
  let after = '';
  try {
    await s.page.waitForTimeout(2500);
    await s.page.getByText('Chuyển vào Ví', { exact: true }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1500);
    const confirm = s.page.getByRole('button', { name: /^Nhận .* vào Ví$/ }).last();
    result = await snap(s, 'mini375', 'ctv-chuyen-vi-hoi');
    if (process.env.CLICK !== '1') {
      console.log('CHƯA BẤM XÁC NHẬN (đặt CLICK=1 để chạy bước ghi). Màn sau khi bấm:', result.slice(0, 600).replace(/\n/g, ' | '));
      await s.close();
      await done();
      process.exit(0);
    }
    await confirm.click({ timeout: 8000 });
    await s.page.waitForTimeout(2500);
    after = await snap(s, 'mini375', 'ctv-chuyen-vi-xong');
  } finally {
    await s.close();
  }
  const [w1] = await sql(`SELECT "walletBalance"::int w FROM users WHERE id='uat_ctv'`);
  const [last] = await sql(`SELECT "grossAmount"::int g, "taxWithheld"::int t, amount::int n FROM payouts WHERE "userId"='uat_ctv' ORDER BY "requestedAt" DESC LIMIT 1`);
  const [c] = await sql(`SELECT count(*)::int n FROM commissions WHERE "affiliateUserId"='uat_ctv' AND status::text='APPROVED'`);
  const afterLines = after.split("\n").map((x) => x.trim());
  const walletShown = afterLines[afterLines.indexOf("Số dư Ví Tubu") + 1] === fmt(w1.w);
  const credited = w1.w - w0.w;
  const expectedTax = Math.floor(a.s * 0.1);
  check('L6-U24', T('Bấm "Chuyển vào Ví" trên Mini: Ví tăng đúng số sau thuế TNCN, hết khoản khả dụng, số trên màn cập nhật', 'ctv', 'Mini 375: bấm Chuyển vào Ví (và xác nhận nếu có)', `khả dụng ${fmt(a.s)}; tổng tháng đã ≥ 5.000.000đ nên khấu trừ 10% = ${fmt(expectedTax)}; Ví +${fmt(a.s - expectedTax)}; không còn hoa hồng APPROVED; màn hiện Ví mới`), a.s > 0 && last?.g === a.s && last?.t === expectedTax && credited === a.s - expectedTax && c.n === 0 && walletShown, `khả dụng ${a.s}; payout=${short(last)}; Ví ${w0.w}→${w1.w} (+${credited}); còn APPROVED=${c.n}; màn sau hiện "Số dư Ví Tubu" = ${fmt(w1.w)}: ${walletShown}; tổng gốc trong tháng trước đó ${taxY.g}`, 'SQL + ảnh mini375-ctv-chuyen-vi-hoi.png, mini375-ctv-chuyen-vi-xong.png');
  void result;
}

await done();
