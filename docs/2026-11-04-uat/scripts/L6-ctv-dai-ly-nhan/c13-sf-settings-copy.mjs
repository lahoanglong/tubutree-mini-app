// C13: tiêu đề sheet "cài đặt gian hàng" của CTV phải giống nhau giữa Mini 375 và web 375 (gian hàng đã duyệt, persona ctv).
// Luật: web khổ điện thoại phải giống Mini App cả giao diện (chủ dặn, memory project-web-mobile-equals-miniapp); nút lưu ở cả hai nơi là "Lưu cấu hình gian hàng".
// Chạy từ gốc worktree uat-1104: node c13-sf-settings-copy.mjs (cần lane 6 đang chạy, persona ctv đã có gian hàng LIVE từ c4).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, check, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const sheetInfo = async (s) => {
  await s.page.waitForTimeout(2500);
  await s.page.getByText('Cài đặt', { exact: true }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(1200);
  return s.page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]') ?? document.body;
    const heads = [...dlg.querySelectorAll('h1,h2,h3,[class*="title"]')].map((e) => e.textContent.trim()).filter(Boolean);
    const btns = [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean);
    return { heads: heads.slice(0, 4), btns, text: dlg.innerText.slice(0, 600) };
  });
};

const out = {};
const mini = await open(6, 'ctv', { path: '/storefront', viewport: { width: 375, height: 812, isMobile: true } });
try {
  out.mini = await sheetInfo(mini);
  await mini.page.screenshot({ path: path.join(SHOTS, 'mini375-gian-hang-cai-dat-tieu-de.png') });
} finally { await mini.close(); }
const web = await openWeb(6, 'ctv', { path: '/ctv/gian-hang', viewport: { width: 375, height: 812, isMobile: true } });
try {
  out.web = await sheetInfo(web);
  await web.page.screenshot({ path: path.join(SHOTS, 'web375-gian-hang-cai-dat-tieu-de.png') });
} finally { await web.close(); }
fs.writeFileSync(path.join(SHOTS, 'gian-hang-cai-dat-tieu-de.json'), JSON.stringify(out, null, 2));

const title = (o) => o.heads.find((h) => /gian hàng/i.test(h)) ?? o.heads[0];
const tMini = title(out.mini);
const tWeb = title(out.web);
check('L6-U26', { title: 'Sheet cài đặt gian hàng CTV: tiêu đề Mini 375 = web 375', persona: 'ctv', size: 'mini375+web375', journey: 'Gian hàng CTV: mở Cài đặt', step: 'Mở /storefront (Mini) và /ctv/gian-hang (web), bấm "Cài đặt"', expect: 'Hai nơi cùng một tiêu đề sheet (nút lưu ở cả hai là "Lưu cấu hình gian hàng")' },
  tMini === tWeb, `Mini="${tMini}"; web="${tWeb}"; nút Mini=${JSON.stringify(out.mini.btns)}; nút web=${JSON.stringify(out.web.btns)}`, 'shots/L6-ctv-dai-ly-nhan/mini375-gian-hang-cai-dat-tieu-de.png + web375-gian-hang-cai-dat-tieu-de.png');
await done();
