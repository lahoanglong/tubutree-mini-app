// C16: đo bố cục ở khổ 375 (Mini và web): (1) ô thống kê gian hàng CTV không để chữ "đ" rớt xuống dòng riêng;
// (2) ô nhập "Số tiền đã chuyển" của tab Công nợ đại lý hiện trọn chữ gợi ý (không cắt chữ).
// Luật: web khổ điện thoại phải giống Mini App cả giao diện (chủ dặn); chữ trên màn hình không được cắt. Số đo lấy bằng DOM, không bằng mắt.
// Chạy sau c4, c5: node c16-layout-375.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, check, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const T = (title, persona, step, expect) => ({ title, persona, size: 'Mini 375 + web 375', journey: title, step, expect });
const sess = (surface, persona, route) => (surface === 'mini375'
  ? open(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } }));

/** Ô thống kê: chữ giá trị chứa "đ" mà cao hơn một dòng thì "đ" đã rớt dòng. */
const statProbe = (page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('[data-testid="builder-stat"]')];
  return tiles.map((t) => {
    const v = t.firstElementChild;
    const cs = getComputedStyle(v);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const r = v.getBoundingClientRect();
    return { text: v.textContent.trim(), lines: Math.round(r.height / lh), width: Math.round(r.width) };
  });
});
/** Cùng phép đo nhưng thay chữ ô giữa bằng số tiền bảy chữ số (doanh thu 30 ngày từ 1 triệu trở lên), để kết quả không phụ thuộc dữ liệu lane. */
const bigProbe = (page) => page.evaluate(() => {
  const v = document.querySelectorAll('[data-testid="builder-stat"]')[1]?.firstElementChild;
  if (!v) return null;
  const keep = v.textContent;
  v.textContent = '1.476.000đ';
  const cs = getComputedStyle(v);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
  const r = v.getBoundingClientRect();
  const lines = Math.round(r.height / lh);
  v.textContent = keep;
  return { text: '1.476.000đ', lines, width: Math.round(r.width) };
});
/** Ô nhập: độ rộng chữ gợi ý (đo bằng canvas, đúng font) so với chỗ trống trong ô. */
const placeholderProbe = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Số tiền đã chuyển');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const need = ctx.measureText(el.placeholder).width;
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return { need: Math.round(need), room: Math.round(room), inputWidth: Math.round(el.clientWidth) };
});

const out = { stats: {}, big: {}, ph: {} };
const stat = { mini375: '/storefront', web375: '/ctv/gian-hang' };
for (const surface of ['mini375', 'web375']) {
  const s = await sess(surface, 'ctv', stat[surface]);
  try {
    await s.page.waitForTimeout(3500);
    out.stats[surface] = await statProbe(s.page);
    out.big[surface] = await bigProbe(s.page);
    const tile = s.page.locator('[data-testid="builder-stat"]').nth(1);
    await tile.scrollIntoViewIfNeeded().catch(() => undefined);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-do-o-thong-ke.png`) });
  } finally { await s.close(); }
}
const dealerRoute = { mini375: '/dealer', web375: '/dai-ly' };
for (const surface of ['mini375', 'web375']) {
  const s = await sess(surface, 'dealer', dealerRoute[surface]);
  try {
    await s.page.waitForTimeout(3500);
    await s.page.getByText('Công nợ', { exact: true }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1500);
    out.ph[surface] = await placeholderProbe(s.page);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-do-o-nhap-cong-no.png`) });
  } finally { await s.close(); }
}
fs.writeFileSync(path.join(SHOTS, 'do-bo-cuc-375.json'), JSON.stringify(out, null, 2));

const wrapped = (surface) => (out.stats[surface] ?? []).filter((t) => t.lines > 1).map((t) => `${t.text} (${t.lines} dòng)`);
const statsOk = ['mini375', 'web375'].every((s) => (out.stats[s] ?? []).length === 3 && wrapped(s).length === 0 && out.big[s]?.lines === 1);
check('L6-U27', T('Ô thống kê 30 ngày của gian hàng CTV ở 375: số tiền không rớt chữ "đ" xuống dòng riêng', 'ctv', 'mở gian hàng CTV (Mini /storefront, web /ctv/gian-hang), đo ba ô thống kê', 'mỗi ô giá trị đúng một dòng ở cả Mini 375 và web 375'),
  statsOk, `số thật Mini: ${JSON.stringify(out.stats.mini375)}; số thật web: ${JSON.stringify(out.stats.web375)}; thử 1.476.000đ: Mini ${JSON.stringify(out.big.mini375)}, web ${JSON.stringify(out.big.web375)}`, 'shots/L6-ctv-dai-ly-nhan/mini375-do-o-thong-ke.png + web375-do-o-thong-ke.png');
const phOk = ['mini375', 'web375'].every((s) => out.ph[s] && out.ph[s].need <= out.ph[s].room);
check('L6-U28', T('Tab Công nợ đại lý ở 375: chữ gợi ý "Số tiền đã chuyển" hiện trọn trong ô nhập', 'dealer', 'mở Kênh đại lý > Công nợ (Mini /dealer, web /dai-ly), đo chữ gợi ý so với chỗ trống của ô', 'độ rộng chữ gợi ý ≤ chỗ trống trong ô ở cả hai khổ'),
  phOk, `Mini: ${JSON.stringify(out.ph.mini375)}; web: ${JSON.stringify(out.ph.web375)}`, 'shots/L6-ctv-dai-ly-nhan/mini375-do-o-nhap-cong-no.png + web375-do-o-nhap-cong-no.png');
await done();
