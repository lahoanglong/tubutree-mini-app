// Luồng 1: khách mới vào lần đầu (persona new = bản sao webnew1, rồi guest), 375.
// Đo: màn đầu, khảo sát chào mừng (Để sau / đi hết), và số chạm ít nhất tới 7 việc chính từ trang chủ.
// Chạy từ gốc worktree: node docs/2026-10-28-review/tools/flows/web-1.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startFlow, warm, sql, ensureClone, fmtTable, R, WEB } from './flow-lib.mjs';

ensureClone('uat_new', 'uat_webnew1', { phone: '0901000101' });
sql(`update users set role='CUSTOMER' where id='uat_webnew1'`);
const resetOnboarding = () => sql(`update users set metadata = coalesce(metadata,'{}'::jsonb) - 'onboardedAt' - 'segments' - 'affiliateTerms' where id='uat_webnew1'`);
await warm(['/', '/san-pham', '/tai-khoan', '/tai-khoan/don-hang', '/uu-dai', '/vuon-xanh', '/doi-rac', '/ho-tro/chat', '/ctv', '/dai-ly', '/kho-qua']);

const share = { rows: [], n: 0 };
const jobsOut = [];
const home = async (F) => {
  await F.page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await F.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await F.page.waitForTimeout(900);
  const sk = F.page.getByText('Để sau', { exact: true }).locator('visible=true').first();
  if (await sk.count()) await sk.click();
  await F.page.waitForTimeout(300);
};
const tab = (F, name) => F.page.getByRole('link', { name: new RegExp('^' + name) }).locator('visible=true').first();

const JOBS = (F) => [
  { job: 'Mua hàng', steps: [['Bấm "Chọn sản phẩm"', () => F.role('link', 'Chọn sản phẩm')]] },
  { job: 'Theo dõi đơn', steps: [['Bấm tab Cá nhân', () => tab(F, 'Cá nhân')], ['Bấm "Xem tất cả" (Đơn của tôi)', () => F.text('Xem tất cả')]] },
  { job: 'Điểm Xanh và ưu đãi', steps: [['Bấm tab Ưu đãi', () => tab(F, 'Ưu đãi')]] },
  { job: 'Vườn Xanh', steps: [['Bấm tab Vườn Xanh', () => tab(F, 'Vườn Xanh')]] },
  { job: 'Đổi rác lấy quà', steps: [['Bấm ô Đổi rác', () => F.text('Đổi rác')]] },
  { job: 'Chat CSKH', steps: [['Bấm tab Cá nhân', () => tab(F, 'Cá nhân')], ['Bấm "Chat với Tubu Tree"', () => F.page.getByRole('link', { name: /Chat với Tubu Tree/ }).first()]] },
  { job: 'CTV / đại lý', steps: [['Bấm ô Kiếm tiền', () => F.text('Kiếm tiền')], ['Bấm Cộng tác viên (hoặc Đại lý)', () => F.text('Cộng tác viên')]] },
];

async function runJobs(F, label) {
  for (const j of JOBS(F)) {
    await home(F);
    const before = F.touches;
    let ok = true;
    for (const [label2, loc] of j.steps) {
      const r = await F.tap(`${j.job}: ${label2}`, loc());
      if (!r.ok) ok = false;
      if (j.job === 'CTV / đại lý' && label2.startsWith('Bấm ô')) await F.page.waitForTimeout(500);
    }
    const n = F.touches - before;
    const body = (await F.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const route = new URL(F.page.url()).pathname;
    const wall = /Đăng nhập (với Zalo|để)/.test(body) && route !== '/';
    const row = await F.look(`${label} / ${j.job}: tới đích sau ${n} chạm`, { note: `${ok ? 'tìm thấy' : 'KHÔNG tìm thấy'}${wall ? ', bị chặn bằng màn Đăng nhập' : ''}`, ok });
    jobsOut.push({ persona: label, job: j.job, touches: n, found: ok, route, loginWall: wall, headline: body.slice(0, 140), shot: row.shot });
  }
}

// A. Khách mới (new): màn đầu và "Để sau"
resetOnboarding();
let F = await startFlow({ flow: '1-khach-moi', persona: 'webnew1', share, actor: 'new' });
await F.firstLoad('Mở app lần đầu (new): màn chào mừng phủ kín màn hình', 'màn chào mừng chặn trang chủ, có Bắt đầu và Để sau');
await F.page.waitForTimeout(8000);
await F.look('Màn đầu sau 9 giây không bấm gì', { note: 'xem màn chào mừng có tự tắt không' });
await F.tap('Bấm Để sau', F.text('Để sau'));
await F.look('Trang chủ sau Để sau (nhìn đầu trang)', { note: 'xem có ô tìm kiếm, ô Quà khách mới, lưới lối tắt' });
const touchesSkip = F.touches;
await F.page.waitForTimeout(8000);
await F.look('Trang chủ sau 8 giây: chú thích trên nút Vườn Xanh còn không?');
await F.close();

// B. Khách mới đi hết khảo sát chào mừng
resetOnboarding();
F = await startFlow({ flow: '1-khach-moi', persona: 'webnew1', share, actor: 'new' });
await F.firstLoad('Mở app lần đầu (lần 2): đi hết khảo sát');
await F.tap('Bấm Bắt đầu', F.text('Bắt đầu'));
let q = 1;
for (; q <= 8; q++) {
  const body = (await F.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  if (!/Chọn (nhiều )?(1 )?đáp án|Bạn quan tâm|Làn da|thế nào|nhất\?/.test(body.slice(0, 200))) break;
  const title = body.slice(0, 40);
  const labels = await F.page.evaluate(() => [...document.querySelectorAll('button,[role=radio],[role=checkbox],[role=option]')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.innerText.trim()).filter(Boolean));
  const pick = labels.find((l) => !/^(Tiếp tục|Quay lại|Để sau|Bỏ qua|Hoàn tất|Xong|Bắt đầu)$/.test(l) && !/^[-+\d]/.test(l) && l.length < 30 && !/Thêm yêu thích/.test(l));
  if (pick) await F.tap(`Câu ${q} (${title}...): chọn "${pick}"`, F.text(pick));
  const nxt = labels.find((l) => /^(Tiếp tục|Hoàn tất|Xong|Bắt đầu mua sắm)$/.test(l));
  if (nxt) await F.tap(`Câu ${q}: bấm ${nxt}`, F.page.getByRole('button', { name: nxt, exact: true }).first());
  else break;
}
await F.look('Sau khảo sát: màn tiếp theo', { note: 'xem khảo sát kết thúc ở đâu' });
const touchesSurvey = F.touches;
await F.close();

// C. Khách mới (new) sau khảo sát: 7 việc chính từ trang chủ
F = await startFlow({ flow: '1-khach-moi', persona: 'webnew1', share, actor: 'new' });
await F.firstLoad('Mở app lần ba (đã làm khảo sát)');
await runJobs(F, 'new');
await F.close();

// D. Guest (chưa đăng nhập)
F = await startFlow({ flow: '1-khach-moi', persona: 'guest', share, actor: 'guest' });
await F.firstLoad('Mở app khi chưa đăng nhập (guest)', 'xem màn đầu của guest');
const gbody = (await F.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const guestOverlay = /Chào mừng đến Tubu Tree/.test(gbody);
await runJobs(F, 'guest');
await F.close();

// E. Returning: đường tắt theo dõi đơn từ trang chủ (chỉ đọc, dùng persona returning)
F = await startFlow({ flow: '1-khach-moi', persona: 'returning', share, actor: 'returning' });
await F.firstLoad('Mở trang chủ returning (có đơn đang giao)');
const banner = F.page.getByText('Chạm để theo dõi đơn', { exact: false }).locator('visible=true').first();
if (await banner.count()) {
  const b = F.touches;
  await F.tap('Bấm dòng "N đơn đang giao - Chạm để theo dõi đơn"', banner);
  jobsOut.push({ persona: 'returning', job: 'Theo dõi đơn (có đơn đang giao)', touches: F.touches - b, found: true, route: new URL(F.page.url()).pathname });
} else {
  jobsOut.push({ persona: 'returning', job: 'Theo dõi đơn (có đơn đang giao)', touches: null, found: false, route: '-', note: 'không có dòng đơn đang giao trên trang chủ lúc chạy' });
}
await F.close();

const out = { flow: '1-khach-moi', rows: share.rows, jobs: jobsOut, touchesSkip, touchesSurvey, guestOverlay };
fs.writeFileSync(path.join(R, 'screens/flows/web/1-khach-moi/results.json'), JSON.stringify(out, null, 2));
console.log(fmtTable(out));
console.log(JSON.stringify({ touchesSkip, touchesSurvey, guestOverlay }));
console.log(jobsOut.map((j) => `${j.persona} | ${j.job} | ${j.touches} | ${j.route} | wall=${j.loginWall}`).join('\n'));
