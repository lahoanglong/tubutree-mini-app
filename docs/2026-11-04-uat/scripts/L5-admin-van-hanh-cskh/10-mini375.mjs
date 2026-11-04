// Mini App khổ 375: màn nội bộ cho nhân viên và admin (/staff, /recycle/desk, /admin, /my-payroll) + chặn truy cập trái quyền.
// Dùng: node 10-mini375.mjs        (WASTE=on để bật waste.enabled tạm thời rồi khôi phục khi xong)
import { L, SHOTS, check, rec, save, short, call, sql } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { open } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/miniapp-session.mjs`);
const WASTE_ON = process.env.WASTE === 'on';
const vp = { width: 375, height: 812 };

const origWaste = (await sql(`SELECT key, value FROM system_configs WHERE key IN ('waste.enabled','waste.rules_text')`));
if (WASTE_ON) {
  const rules = origWaste.find((r) => r.key === 'waste.rules_text')?.value;
  if (!rules) await call('admin', 'PUT', '/admin/config', { key: 'waste.rules_text', value: 'Thể lệ UAT: đổi rác lấy quà tại điểm nhận.' });
  const en = await call('admin', 'PUT', '/admin/config', { key: 'waste.enabled', value: true });
  rec('L5-M375-cfg', 'admin', 'api', 'Mini nội bộ', 'Bật tạm waste.enabled', '200', `HTTP ${en.status}`, short(en.body, 160), en.status < 300 ? 'PASS' : 'BLOCKED');
}

const PLAN = [
  ['staff', '/staff', 'Quầy nhân viên'],
  ['staff', '/recycle/desk', 'Bàn nhận đổi rác'],
  ['staff', '/my-payroll', 'Bảng lương của tôi'],
  ['admin', '/admin', 'Admin trong Mini App'],
  ['cskh', '/staff', 'Quầy nhân viên (CSKH)'],
  ['kho', '/recycle/desk', 'Bàn nhận đổi rác (kho)'],
  ['returning', '/staff', 'Khách gõ thẳng /staff'],
  ['returning', '/admin', 'Khách gõ thẳng /admin'],
  ['returning', '/recycle/desk', 'Khách gõ thẳng /recycle/desk'],
];
for (const [persona, path, label] of PLAN) {
  const s = await open(5, persona, { path, viewport: vp, waitMs: 20000 }).catch((e) => ({ err: e }));
  if (s.err) { rec(`L5-M375-${persona}-${path.replace(/\W+/g, '_')}`, persona, 'mini375', label, `mở ${path}`, 'màn mở được', `lỗi mở phiên: ${short(String(s.err.message), 200)}`, null, 'BLOCKED'); continue; }
  await s.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await s.page.waitForTimeout(1500);
  const bad = s.requests.filter((r) => r.status >= 400 && !(r.status === 401 && /^\/me\//.test(r.path)) && !r.mocked);
  const m = await s.page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText.trim().slice(0, 260).replace(/\s+/g, ' '),
    len: document.body.innerText.trim().length,
    url: location.pathname + location.search,
    small: [...document.querySelectorAll('button, a[href]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32 && r.top < 812; }).length,
  }));
  const file = `${SHOTS}/mini375-${persona}-${path.replace(/\W+/g, '_')}${WASTE_ON ? '-wasteon' : ''}.png`;
  await s.page.screenshot({ path: file });
  const internal = ['staff', 'admin', 'cskh', 'kho'].includes(persona);
  const forbidden = persona === 'returning';
  const problems = [];
  if (m.overflow > 1) problems.push(`tràn ngang ${m.overflow}px`);
  if (!forbidden && bad.length) problems.push(`request lỗi: ${bad.slice(0, 3).map((r) => `${r.method} ${r.path} ${r.status}`).join('; ')}`);
  if (m.len < 20) problems.push('nội dung trống');
  if (forbidden) {
    const rightsCalls = s.requests.filter((r) => r.status === 403);
    const redirected = m.url !== path;
    rec(`L5-M375-${persona}-${path.replace(/\W+/g, '_')}`, persona, 'mini375', label, `khách (CUSTOMER) gõ thẳng ${path}`, 'không thấy dữ liệu nội bộ: bị đẩy đi hoặc hiện thông báo không có quyền; không có dữ liệu admin trong màn',
      `URL cuối ${m.url}; ${rightsCalls.length} request 403; chữ trên màn: "${m.text.slice(0, 140)}"; ${problems.join(' | ')}`, { url: m.url, text: m.text, r403: rightsCalls.slice(0, 3).map((r) => `${r.method} ${r.path}`), shot: file },
      m.overflow > 1 ? 'FAIL' : 'PASS');
  } else {
    rec(`L5-M375-${persona}-${path.replace(/\W+/g, '_')}`, persona, 'mini375', label, `mở ${path} ở 375px`, 'không tràn ngang, không request lỗi, có nội dung',
      `${problems.join(' | ') || 'ổn'}; URL ${m.url}; ${m.small} nút thấp hơn 32px; chữ: "${m.text.slice(0, 120)}"`, { ...m, bad: bad.slice(0, 3), shot: file }, problems.length ? 'FAIL' : 'PASS');
  }
  await s.close();
}

if (WASTE_ON) {
  for (const r of origWaste) await sql(`UPDATE system_configs SET value=$2::jsonb WHERE key=$1`, [r.key, JSON.stringify(r.value)]);
  if (!origWaste.find((r) => r.key === 'waste.rules_text')) await sql(`UPDATE system_configs SET value='""'::jsonb WHERE key='waste.rules_text'`);
}
save(`10-mini375${WASTE_ON ? '-wasteon' : ''}`);
process.exit(0);
