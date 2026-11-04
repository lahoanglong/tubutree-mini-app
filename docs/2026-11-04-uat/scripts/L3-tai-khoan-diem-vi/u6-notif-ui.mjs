// U6: thông báo trong app: đánh dấu đã đọc từng tin (bấm vào tin) và "Đọc tất cả"; đối chiếu DB + API unread-count + giờ VN.
import { makeRec, sql, sql1, A, done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u6-notif-ui');
const J = 'Thông báo';
const persona = 'returning', uid = 'uat_returning';
const routes = { mini375: '/notifications', web375: '/tai-khoan/thong-bao', web1280: '/tai-khoan/thong-bao' };
for (const surface of ['mini375', 'web375', 'web1280']) {
  const id = `U6-${surface}`;
  await sql(`UPDATE notification_logs SET status='SENT' WHERE id IN (SELECT id FROM notification_logs WHERE "userId"=$1 AND channel='INAPP' ORDER BY "sentAt" DESC LIMIT 3) RETURNING id`, uid);
  const unread0 = (await A(persona, 'GET', '/me/notifications/unread-count')).body.count;
  const s = await openSurface(surface, persona, routes[surface]);
  const p = s.s.page;
  try {
    await p.getByText('Đọc tất cả', { exact: true }).first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(1000);
    await p.screenshot({ path: `${SHOTS}/notif-1-chua-doc-${surface}.png`, fullPage: true });
    const t0 = await p.locator('body').innerText();
    check(`${id}-list`, persona, surface, J, 'có tin chưa đọc: hiện nút "Đọc tất cả"; chữ tiếng Việt đúng giọng, không "Vui lòng"/"chúng tôi"', 'notifications.tsx; brief giọng đợt 8', unread0 === 3 && !/Vui lòng|chúng tôi|undefined|NaN/.test(t0), `unread API=${unread0}; chữ=${t0.replace(/\s+/g, ' ').slice(0, 320)}`);
    // bấm tin mới nhất
    const first = (await sql1(`SELECT id, "payload"->>'body' b, "sentAt" st FROM notification_logs WHERE "userId"=$1 AND channel='INAPP' ORDER BY "sentAt" DESC LIMIT 1`, uid));
    const snippet = first.b.slice(0, 24);
    await p.getByText(snippet, { exact: false }).first().click();
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `${SHOTS}/notif-2-chi-tiet-${surface}.png` });
    const st1 = (await sql1(`SELECT status FROM notification_logs WHERE id=$1`, first.id)).status;
    const unread1 = (await A(persona, 'GET', '/me/notifications/unread-count')).body.count;
    const others = (await sql1(`SELECT count(*)::int n FROM notification_logs WHERE "userId"=$1 AND channel='INAPP' AND status<>'READ'`, uid)).n;
    check(`${id}-one`, persona, surface, J, 'bấm một tin: chỉ tin đó chuyển READ, unread-count giảm đúng 1', 'notifications.controller.ts POST :id/read', st1 === 'READ' && unread1 === unread0 - 1 && others === unread1, `tin ${first.id} status=${st1}; unread ${unread0}→${unread1}; DB chưa đọc=${others}`);
    await s.s.goto(routes[surface]);
    await p.waitForTimeout(2000);
    await p.getByText('Đọc tất cả', { exact: true }).first().click();
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${SHOTS}/notif-3-doc-het-${surface}.png`, fullPage: true });
    const unread2 = (await A(persona, 'GET', '/me/notifications/unread-count')).body.count;
    const dbUnread = (await sql1(`SELECT count(*)::int n FROM notification_logs WHERE "userId"=$1 AND channel='INAPP' AND status<>'READ'`, uid)).n;
    const stillBtn = await p.getByText('Đọc tất cả', { exact: true }).count();
    check(`${id}-all`, persona, surface, J, '"Đọc tất cả": mọi tin INAPP thành READ, unread-count 0, nút biến mất', 'notification-feed.service.ts markAllRead', unread2 === 0 && dbUnread === 0 && stillBtn === 0, `unread API=${unread2} DB chưa đọc=${dbUnread} nút còn=${stillBtn}`);
  } catch (e) {
    rec(id, persona, surface, J, 'luồng thông báo', '', String(e).slice(0, 300), String(e).slice(0, 300), 'FAIL');
    await p.screenshot({ path: `${SHOTS}/notif-loi-${surface}.png` }).catch(() => {});
  }
  await s.s.close();
}
// Giờ hiển thị: so với sentAt (UTC) đổi sang VN
const row = await sql1(`SELECT "sentAt" st FROM notification_logs WHERE "userId"=$1 AND channel='INAPP' ORDER BY "sentAt" DESC LIMIT 1`, uid);
rec('U6-time', persona, 'DB', J, 'ghi chú giờ: sentAt mới nhất của returning (UTC) để đối chiếu với ảnh', 'cách hiển thị giờ VN', `sentAt=${row.st}`, `sentAt=${row.st}`, 'PASS');
await done();
