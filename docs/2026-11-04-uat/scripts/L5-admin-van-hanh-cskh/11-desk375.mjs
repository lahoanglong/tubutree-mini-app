// Mini App 375: bàn nhận đổi rác của nhân viên. Tra mã sai, mã rỗng, nút "Tra mã" khoá khi chưa nhập; chữ lỗi đúng giọng.
// Dùng: node 11-desk375.mjs
import { SHOTS, check, rec, save, short, toneProblems } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { open } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/miniapp-session.mjs`);
const vp = { width: 375, height: 812 };
const J = 'Bàn nhận đổi rác (Mini 375)';

const s = await open(5, 'staff', { path: '/recycle/desk', viewport: vp, waitMs: 20000 });
await s.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
await s.page.waitForTimeout(1200);
const input = s.page.locator('input').first();
const btn = s.page.getByRole('button', { name: /Tra mã/ }).first();
const disabled0 = await btn.isDisabled().catch(() => null);
check('L5-DESK-01', 'staff', 'mini375', J, 'Mở bàn nhận, chưa nhập mã', 'nút "Tra mã" bị khoá (không gọi API khi rỗng)', disabled0 === true, `isDisabled=${disabled0}`, null);

for (const [id, code, label] of [['02', 'TR-ZZZZZ', 'mã yêu cầu không có thật'], ['03', "'; DROP TABLE users;--", 'chuỗi lạ có dấu nháy'], ['04', 'x'.repeat(120), 'chuỗi dài 120 ký tự']]) {
  await input.fill('');
  await input.fill(code);
  const from = s.requests.length;
  await btn.click({ timeout: 5000 }).catch(() => undefined);
  await s.page.waitForTimeout(1800);
  const reqs = s.requests.slice(from);
  const txt = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const five = reqs.filter((r) => r.status >= 500);
  const msg = txt.match(/(Không tìm thấy[^.]*\.|Mã [^.]*không[^.]*\.|[^.]*không hợp lệ[^.]*\.)/i)?.[0] ?? '';
  await s.page.screenshot({ path: `${SHOTS}/mini375-desk-${id}.png` });
  const tone = toneProblems(msg || txt);
  check(`L5-DESK-${id}`, 'staff', 'mini375', J, `Tra ${label}`, 'báo lỗi tiếng Việt rõ, không 500, không tràn ngang, không "Vui lòng/chúng tôi/..."',
    five.length === 0 && overflow <= 1 && tone.length === 0 && (msg.length > 0 || reqs.some((r) => r.status === 404 || r.status === 400)),
    `${reqs.map((r) => `${r.method} ${r.path} ${r.status}`).join('; ') || 'không gọi API'}; chữ lỗi: "${msg.slice(0, 120)}"; tràn ngang ${overflow}px; giọng: ${tone.join(',') || 'sạch'}`, { reqs: reqs.slice(0, 3), txt: txt.slice(0, 240) });
}
await s.close();

const g = await open(5, 'returning', { path: '/recycle/desk', viewport: vp, waitMs: 20000 });
await g.page.waitForTimeout(1500);
const inputs = await g.page.locator('input').count();
check('L5-DESK-05', 'returning', 'mini375', J, 'Khách mở /recycle/desk', 'không có ô tra mã của nhân viên', inputs === 0, `${inputs} ô nhập; chữ: "${(await g.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())).slice(0, 120)}"`, null);
await g.close();
save('11-desk375');
process.exit(0);
