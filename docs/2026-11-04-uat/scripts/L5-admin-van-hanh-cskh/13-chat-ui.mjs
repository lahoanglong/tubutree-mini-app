// Chat CSKH bằng GIAO DIỆN admin 375: mở hội thoại, trả lời, chặn / bỏ chặn; nút "Gửi trả lời" khoá khi để trống. Bật chat tạm thời rồi khôi phục.
// Dùng: node 13-chat-ui.mjs
import { L, SHOTS, ENV, check, rec, save, short, call, sql, idem } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const J = 'Chat CSKH bằng giao diện (375)';
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}
const [orig] = await sql(`SELECT value v FROM system_configs WHERE key='chat.enabled'`);
const wasEnabled = orig?.v ?? false;
await call('admin', 'PUT', '/admin/support-chat/settings', { enabled: true });
const me = (await call('returning', 'GET', '/me')).body;
const marker = `UAT-UI-${Date.now().toString(36)}`;
const sent = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body: `${marker} Đơn của mình bao giờ giao?` });
const conv = (await sql(`SELECT id, code FROM support_conversations WHERE "userId"=$1`, [me.id]))[0];
check('L5-CUI-00', 'returning', 'api', J, 'Khách gửi tin để có hội thoại', '2xx', sent.status < 300, `HTTP ${sent.status}`, short(sent.body, 120));

const s = await openWeb(5, 'cskh', { viewport: { width: 375, height: 800 }, path: '/admin?tab=supportChat' });
await bypassApi(s.context);
await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
await s.page.waitForTimeout(1200);
await s.page.screenshot({ path: `${SHOTS}/ui375-cskh-chat-list.png` });
const listTxt = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('L5-CUI-01', 'cskh', 'web375', J, 'CSKH mở tab Chat CSKH', 'thấy danh sách hội thoại có mã #' + conv.code + ' và tin vừa gửi; thẻ cầu nối ở dạng gọn (không có công tắc "Cho khách chat" của admin)', listTxt.includes(conv.code) && listTxt.includes(marker) && !/Cho khách chat/.test(listTxt), `thấy mã=${listTxt.includes(conv.code)}; thấy tin=${listTxt.includes(marker)}; công tắc admin=${/Cho khách chat/.test(listTxt)}`, listTxt.slice(0, 300));

await s.page.getByText(conv.code).first().click({ timeout: 8000 }).catch(() => undefined);
await s.page.waitForTimeout(1800);
await s.page.screenshot({ path: `${SHOTS}/ui375-cskh-chat-detail.png` });
const sendBtn = s.page.getByRole('button', { name: /Gửi trả lời/ }).first();
const disabled0 = await sendBtn.isDisabled().catch(() => null);
check('L5-CUI-02', 'cskh', 'web375', J, 'Mở hội thoại: nút "Gửi trả lời" khi ô trống', 'bị khoá', disabled0 === true, `isDisabled=${disabled0}`, null);
const box = s.page.getByRole('textbox').last();
const reply = `${marker} Đơn đang trên đường giao nhé.`;
await box.fill(reply);
const from = s.requests.length;
await sendBtn.click({ timeout: 8000 }).catch((e) => console.log('lỗi bấm gửi:', String(e.message).split('\n')[0]));
await s.page.waitForTimeout(2500);
await s.page.screenshot({ path: `${SHOTS}/ui375-cskh-chat-replied.png` });
const req = s.requests.slice(from).find((r) => /\/reply$/.test(r.path));
const [dbm] = await sql(`SELECT sender, "adminUserId" a, body FROM support_messages WHERE body=$1`, [reply]);
const afterTxt = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('L5-CUI-03', 'cskh', 'web375', J, 'CSKH gõ và bấm "Gửi trả lời"', 'POST reply 2xx; DB sender STAFF, adminUserId = cskh; tin hiện trong luồng; ô nhập được xoá', req?.status < 300 && dbm?.sender === 'STAFF' && dbm?.a === 'uat_cskh' && afterTxt.includes(reply), `${req ? `${req.method} ${req.path} ${req.status}` : 'không gọi API'}; DB ${JSON.stringify(dbm)}; hiện trên màn=${afterTxt.includes(reply)}`, null);
const cust = await call('returning', 'GET', '/me/support-chat/messages');
check('L5-CUI-04', 'returning', 'api', J, 'Khách thấy câu trả lời vừa gõ ở giao diện admin', 'có trong khung chat của khách', (cust.body.messages ?? []).some((m) => m.body === reply), `${(cust.body.messages ?? []).length} tin`, null);

// Chặn / bỏ chặn bằng giao diện
await s.page.getByRole('button', { name: 'Chặn chat', exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log('lỗi bấm Chặn chat:', String(e.message).split('\n')[0]));
await s.page.waitForTimeout(800);
await s.page.screenshot({ path: `${SHOTS}/ui375-cskh-chat-block-dialog.png` });
const dlg = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const [pre] = await sql(`SELECT "blockedAt" b FROM support_conversations WHERE id=$1`, [conv.id]);
check('L5-CUI-05', 'cskh', 'web375', J, 'Bấm "Chặn chat": hộp xác nhận', 'hộp "Chặn chat của khách này?" nêu hậu quả; chưa chặn khi chưa xác nhận', /Chặn chat của khách này\?/.test(dlg) && pre.b === null, `hộp=${/Chặn chat của khách này\?/.test(dlg)}; DB blockedAt=${pre.b}`, dlg.slice(dlg.indexOf('Chặn chat của khách'), dlg.indexOf('Chặn chat của khách') + 200));
await s.page.getByRole('button', { name: 'Chặn chat', exact: true }).last().click({ timeout: 8000 }).catch((e) => console.log('lỗi xác nhận chặn:', String(e.message).split('\n')[0]));
await s.page.waitForTimeout(2000);
const [post] = await sql(`SELECT "blockedAt" b, "blockedByUserId" u FROM support_conversations WHERE id=$1`, [conv.id]);
const afterBlock = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: `ui-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body: 'thử khi bị chặn' });
check('L5-CUI-06', 'cskh', 'web375', J, 'Xác nhận chặn', 'DB blockedAt có, blockedByUserId = cskh; khách gửi tiếp bị 403', !!post.b && post.u === 'uat_cskh' && afterBlock.status === 403, `DB ${JSON.stringify(post)}; khách gửi -> ${afterBlock.status}`, null);
await s.page.screenshot({ path: `${SHOTS}/ui375-cskh-chat-blocked.png` });
await s.page.getByRole('button', { name: 'Bỏ chặn', exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log('lỗi Bỏ chặn:', String(e.message).split('\n')[0]));
await s.page.waitForTimeout(2000);
const [un] = await sql(`SELECT "blockedAt" b FROM support_conversations WHERE id=$1`, [conv.id]);
check('L5-CUI-07', 'cskh', 'web375', J, 'Bấm "Bỏ chặn"', 'DB blockedAt = null', un.b === null, `DB blockedAt=${un.b}`, null);
await s.close();

// Admin thấy công tắc "Cho khách chat"
const a = await openWeb(5, 'admin', { viewport: { width: 375, height: 800 }, path: '/admin?tab=supportChat' });
await bypassApi(a.context);
await a.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
await a.page.waitForTimeout(1200);
await a.page.getByText('Cầu nối Zalo').first().click({ timeout: 5000 }).catch(() => undefined);
await a.page.waitForTimeout(800);
await a.page.screenshot({ path: `${SHOTS}/ui375-admin-chat-bridge.png` });
const at = await a.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('L5-CUI-08', 'admin', 'web375', J, 'ADMIN mở thẻ Cầu nối Zalo ở 375px', 'thấy "Cho khách chat: đang bật" và chọn nhóm; không tràn ngang', /Cho khách chat: đang bật/.test(at) && (await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `công tắc=${/Cho khách chat: đang (bật|tắt)/.exec(at)?.[0]}`, at.slice(at.indexOf('Cầu nối Zalo'), at.indexOf('Cầu nối Zalo') + 260));
await a.close();

await call('admin', 'PUT', '/admin/support-chat/settings', { enabled: wasEnabled });
save('13-chat-ui');
process.exit(0);
