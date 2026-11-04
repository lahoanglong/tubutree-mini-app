// C17: giao diện form "Lên đơn hộ khách" của CTV ở Mini 375, web 375 và web 1280: mở được, chữ khớp giữa Mini và web 375, gửi form trống hiện lỗi từng ô,
// không chữ cấm. Việc tạo đơn thật đã kiểm ở c10 (API); script này không tạo đơn.
// Luật: apps/web/src/components/affiliate/ctv-order-copy.ts (giữ khớp vi.ctvOrder của Mini), AGENTS.md giọng chữ (không "Vui lòng", "chúng tôi", "...").
// Chạy sau c4: node c17-order-sheet-ui.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, check, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const T = (title, size, step, expect) => ({ title, persona: 'ctv', size, journey: title, step, expect });
const BAD = /Vui lòng|chúng tôi|\.\.\./i;
const FOOT = new Set(['Hotline: 0984 606 774', 'Điều khoản', 'Bảo mật', 'Đổi trả', 'Vận chuyển', 'Facebook', 'TikTok', 'tubutree@gmail.com']);
const VP = { mini375: { w: 375, h: 812 }, web375: { w: 375, h: 812 }, web1280: { w: 1280, h: 800 } };
const routes = { mini375: '/affiliate', web375: '/ctv', web1280: '/ctv' };
const sess = (surface) => (surface === 'mini375'
  ? open(6, 'ctv', { path: routes[surface], viewport: { width: 375, height: 1900, isMobile: true } })
  : openWeb(6, 'ctv', { path: routes[surface], viewport: { width: VP[surface].w, height: VP[surface].h, isMobile: surface === 'web375' } }));
const lines = (t) => t.split('\n').map((x) => x.trim()).filter((x) => x.length > 1).map((x) => x.replace(/[“”]/g, '"'));
const sheetLines = (t) => {
  let l = lines(t);
  const i = l.lastIndexOf('Lên đơn hộ khách');
  l = i >= 0 ? l.slice(i) : l;
  const foot = l.findIndex((x) => /^Sống xanh An Lành/.test(x));
  if (foot >= 0) l = l.slice(0, foot);
  return l.filter((x) => !FOOT.has(x));
};

const got = {};
const errors = [];
for (const surface of ['mini375', 'web375', 'web1280']) {
  const s = await sess(surface);
  s.page.on('pageerror', (e) => errors.push(`${surface}: ${String(e.message).slice(0, 120)}`));
  try {
    await s.page.waitForTimeout(3000);
    await s.page.getByText('Lên đơn hộ', { exact: true }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1800);
    const text = () => s.page.evaluate(() => { document.querySelectorAll('option').forEach((o) => { if (o.value) o.remove(); }); return document.body.innerText; });
    const empty = await text();
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-len-don-ho-trong.png`), fullPage: surface === 'mini375' });
    await s.page.getByRole('button', { name: 'Tạo đơn hộ khách' }).last().click({ timeout: 8000 }).catch(() => undefined);
    await s.page.waitForTimeout(1200);
    const errs = await text();
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-len-don-ho-loi.png`), fullPage: surface === 'mini375' });
    got[surface] = { empty, errs };
    fs.writeFileSync(path.join(SHOTS, `${surface}-len-don-ho-trong.txt`), empty);
    fs.writeFileSync(path.join(SHOTS, `${surface}-len-don-ho-loi.txt`), errs);
  } catch (e) {
    got[surface] = { empty: '', errs: '', fail: String(e.message).slice(0, 160) };
  } finally { await s.close(); }
}

const open3 = ['mini375', 'web375', 'web1280'].map((s) => [s, !got[s].fail && /Người nhận/.test(got[s].empty) && /Tạo đơn hộ khách/.test(got[s].empty)]);
check('L6-U29', T('Form Lên đơn hộ khách mở được ở ba khổ, có đủ nhóm Người nhận, Sản phẩm, Thanh toán', 'Mini 375 + web 375 + web 1280', 'bấm Lên đơn hộ ở trang CTV', 'sheet có Người nhận, Sản phẩm, Thanh toán, nút Tạo đơn hộ khách'),
  open3.every(([, ok]) => ok) && ['mini375', 'web375', 'web1280'].every((s) => /Sản phẩm/.test(got[s].empty) && /Thanh toán/.test(got[s].empty)),
  open3.map(([s, ok]) => `${s}=${ok ? 'mở được' : `không mở: ${got[s].fail ?? 'thiếu nhóm chữ'}`}`).join('; '), 'shots/L6-ctv-dai-ly-nhan/{mini375,web375,web1280}-len-don-ho-trong.png');

const a = sheetLines(got.mini375.empty);
const b = sheetLines(got.web375.empty);
const onlyMini = a.filter((x) => !b.includes(x));
const onlyWeb = b.filter((x) => !a.includes(x));
check('L6-U30', T('Form Lên đơn hộ khách: chữ ở web 375 giống Mini 375', 'Mini 375 vs web 375', 'so từng dòng chữ của sheet lúc mới mở', 'không dòng nào chỉ có ở một bên'),
  onlyMini.length === 0 && onlyWeb.length === 0 && a.length > 8, `Mini ${a.length} dòng, web ${b.length} dòng; chỉ Mini=${JSON.stringify(onlyMini.slice(0, 6))}; chỉ web=${JSON.stringify(onlyWeb.slice(0, 6))}`, 'shots/L6-ctv-dai-ly-nhan/mini375-len-don-ho-trong.txt vs web375-len-don-ho-trong.txt');

const need = ['Thêm ít nhất 1 sản phẩm'];
const missing = ['mini375', 'web375', 'web1280'].flatMap((s) => need.filter((n) => !got[s].errs.includes(n)).map((n) => `${s} thiếu "${n}"`));
const REQ = /Bạn điền giúp Tubu mục này nhé/g;
const noRequired = ['mini375', 'web375', 'web1280'].filter((s) => (got[s].errs.match(REQ) ?? []).length < 5);
check('L6-U31', T('Gửi form Lên đơn hộ khách khi trống: báo lỗi từng ô, không tạo đơn', 'Mini 375 + web 375 + web 1280', 'bấm Tạo đơn hộ khách khi chưa nhập gì', 'hiện "Thêm ít nhất 1 sản phẩm" và năm lần "Bạn điền giúp Tubu mục này nhé" (người nhận, SĐT, tỉnh, phường, địa chỉ) — chữ lấy từ REQUIRED_FIELD của app-core/client-copy'),
  missing.length === 0 && noRequired.length === 0, `${missing.join('; ') || 'đủ "Thêm ít nhất 1 sản phẩm"'}; đủ năm lỗi bắt buộc ở ba khổ: ${noRequired.length === 0 ? 'đủ' : `thiếu ở ${noRequired.join(', ')}`}`, 'shots/L6-ctv-dai-ly-nhan/{mini375,web375,web1280}-len-don-ho-loi.png');

const bad = ['mini375', 'web375', 'web1280'].flatMap((s) => sheetLines(`${got[s].empty}\n${got[s].errs}`).filter((x) => BAD.test(x)).map((x) => `${s}: ${x.slice(0, 80)}`));
check('L6-U32', T('Form Lên đơn hộ khách: không chữ cấm, không lỗi JS', 'Mini 375 + web 375 + web 1280', 'đọc toàn bộ chữ ở sheet trống và sheet báo lỗi', 'không "Vui lòng", "chúng tôi", "..."; không pageerror'),
  bad.length === 0 && errors.length === 0, `${bad.join(' | ') || 'sạch chữ cấm'}; pageerror=${errors.length ? errors.join(' | ') : 0}`, 'shots/*.txt');
await done();
