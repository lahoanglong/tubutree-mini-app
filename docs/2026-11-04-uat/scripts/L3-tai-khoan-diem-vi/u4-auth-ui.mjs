// U4: đăng nhập / đăng xuất trên web và Mini. Đăng nhập Zalo thật không giả được (Hạn chế bộ khung): kiểm màn khách, cổng khách, và đăng xuất.
import { makeRec, sql, sql1, A, done, SHOTS, sleep } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u4-auth-ui');
const J = 'Đăng nhập / đăng xuất';

// 1) Khách mở /dang-nhap
for (const surface of ['web375', 'web1280']) {
  const sess = await openSurface(surface, 'guest', '/dang-nhap');
  const p = sess.s.page;
  await p.waitForTimeout(2500);
  const t = await p.locator('body').innerText();
  await p.screenshot({ path: `${SHOTS}/login-1-khach-${surface}.png`, fullPage: true });
  const hasBtn = await p.getByRole('button', { name: /Đăng nhập với Zalo/ }).count();
  const unavailable = /đang tạm ngưng/.test(t);
  check(`U4-${surface}-login`, 'guest', surface, J, 'khách mở /dang-nhap: có tiêu đề Đăng nhập và nút Đăng nhập với Zalo (hoặc báo tạm ngưng nếu chưa cấu hình), không chữ cấm', 'apps/web/src/app/dang-nhap/page.tsx', /Đăng nhập/.test(t) && (hasBtn > 0 || unavailable) && !/Vui lòng|chúng tôi|undefined|NaN/.test(t), `nút=${hasBtn} tạmNgưng=${unavailable} chữ=${t.replace(/\s+/g, ' ').slice(0, 260)}`);
  // 2) cổng khách: /tai-khoan khi chưa đăng nhập
  await sess.s.goto('/tai-khoan');
  await p.waitForTimeout(3000);
  const url = new URL(p.url());
  await p.screenshot({ path: `${SHOTS}/login-2-cong-khach-${surface}.png`, fullPage: true });
  const t2 = await p.locator('body').innerText();
  check(`U4-${surface}-gate`, 'guest', surface, J, 'khách mở /tai-khoan: không thấy dữ liệu cá nhân, được đưa về đăng nhập hoặc hiện lời mời đăng nhập', 'guest-auth-gate.spec.tsx', (url.pathname.startsWith('/dang-nhap') || /Đăng nhập/.test(t2)) && !/Điểm Xanh của bạn|Ví Tubu/.test(t2), `url=${url.pathname}${url.search} chữ=${t2.replace(/\s+/g, ' ').slice(0, 200)}`);
  await sess.s.close();
}

// 3) Đăng xuất trên web
for (const [surface, w] of [['web375', 375], ['web1280', 1280]]) {
  const persona = 'ctv';
  const uid = 'uat_ctv';
  const sess = await openSurface(surface, persona, '/tai-khoan/cai-dat');
  const p = sess.s.page;
  await p.getByText('Đăng xuất', { exact: true }).first().waitFor({ timeout: 30000 });
  const before = await sql1(`SELECT count(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt">now())::int live FROM refresh_tokens WHERE "userId"=$1`, uid);
  const cookiesBefore = (await sess.s.context.cookies()).filter((c) => c.name === 'tubu_rt').length;
  const lsBefore = await p.evaluate(() => localStorage.getItem('tubu_web_session'));
  const logoutReqs = [];
  p.on('request', (r) => { if (r.url().includes('/auth/logout')) logoutReqs.push(r.method()); });
  await p.getByText('Đăng xuất', { exact: true }).first().click();
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${SHOTS}/logout-1-sau-bam-${surface}.png`, fullPage: true });
  const cookiesAfter = (await sess.s.context.cookies()).filter((c) => c.name === 'tubu_rt' && c.value).length;
  const lsAfter = await p.evaluate(() => localStorage.getItem('tubu_web_session'));
  const after = await sql1(`SELECT count(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt">now())::int live FROM refresh_tokens WHERE "userId"=$1`, uid);
  const urlAfter = new URL(p.url());
  check(`U4-${surface}-logout`, persona, surface, J, 'bấm Đăng xuất: gọi POST /auth/logout, xoá cookie tubu_rt + cờ phiên, thu hồi refresh token trong DB, rời khỏi trang cá nhân', 'auth.controller.ts logout; auth-context', logoutReqs.length >= 1 && cookiesAfter === 0 && (lsAfter === null || lsAfter === '0') && after.live < before.live, `logoutReq=${JSON.stringify(logoutReqs)} cookie ${cookiesBefore}→${cookiesAfter} cờ ${lsBefore}→${lsAfter} refresh còn hạn ${before.live}→${after.live} url sau=${urlAfter.pathname}`);
  // mở lại trang cá nhân: phải là khách
  await sess.s.goto('/tai-khoan');
  await p.waitForTimeout(3000);
  const url2 = new URL(p.url());
  const t = await p.locator('body').innerText();
  await p.screenshot({ path: `${SHOTS}/logout-2-mo-lai-${surface}.png`, fullPage: true });
  check(`U4-${surface}-after`, persona, surface, J, 'sau đăng xuất mở /tai-khoan: là khách (về đăng nhập / lời mời), không còn dữ liệu cá nhân', 'guest-auth-gate.spec.tsx', (url2.pathname.startsWith('/dang-nhap') || /Đăng nhập/.test(t)) && !/Ví Tubu/.test(t), `url=${url2.pathname} chữ=${t.replace(/\s+/g, ' ').slice(0, 160)}`);
  await sess.s.close();
}

// 4) Đăng xuất trên Mini
{
  const sess = await openSurface('mini375', 'ctv', '/settings');
  const p = sess.s.page;
  await p.getByText('Đăng xuất', { exact: true }).first().waitFor({ timeout: 30000 });
  await p.getByText('Đăng xuất', { exact: true }).first().click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${SHOTS}/logout-1-sau-bam-mini375.png`, fullPage: true });
  const t = await p.locator('body').innerText();
  rec('U4-mini375-logout', 'ctv', 'mini375', J, 'bấm Đăng xuất trên Mini: ghi lại hành vi (đưa về đâu, có hỏi lại không)', 'apps/miniapp/src/pages/settings.tsx', `url=${new URL(p.url()).pathname + new URL(p.url()).hash} chữ=${t.replace(/\s+/g, ' ').slice(0, 200)}`, `url=${p.url()}`, 'PASS');
  await sess.s.close();
}
rec('U4-login-zalo', 'guest', 'web375/web1280', J, 'bấm "Đăng nhập với Zalo" và quay lại với phiên đăng nhập', 'dang-nhap/page.tsx onLogin', 'Lane báo "Đăng nhập Zalo trên web đang tạm ngưng" (chưa có khoá Zalo) và Zalo OAuth thật không giả được bằng bộ khung', 'ảnh login-1-khach-web375.png', 'BLOCKED');
await done();
