#!/usr/bin/env node
// U4-39..U4-40: thông báo trong app trên Mini App thật: danh sách, đọc một tin, "Đọc tất cả"; tắt nhóm "Nhắc nhở Vườn Xanh &
// tương tác bài viết" ở /settings thì tin thích/bình luận không còn được ghi, tin giao dịch vẫn tới.
// Chạy sau 30-community.mjs (results/community-state.json). Dùng: node 50-notifications.mjs [lane] [--headed]
import fs from 'node:fs';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { Case, L, call, closePrisma, log, q, relShot, runCase, saveResults, shot, short, sleep, headless } from './u4-lib.mjs';

const cs = JSON.parse(fs.readFileSync(new URL('./results/community-state.json', import.meta.url), 'utf8'));
const cases = [];

const unread = async (userId) =>
  (await q(`SELECT count(*)::int AS n FROM notification_logs WHERE "userId" = $1 AND channel = 'INAPP' AND status <> 'READ'`, userId))[0].n;
const countOf = async (userId, code) =>
  (await q(`SELECT count(*)::int AS n FROM notification_logs WHERE "userId" = $1 AND channel = 'INAPP' AND "templateCode" = $2`, userId, code))[0].n;

// ---------- U4-39: danh sách, đọc một tin, đọc tất cả
cases.push(
  await runCase(
    new Case('U4-39', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Xem và đánh dấu đã đọc thông báo',
      steps: '/notifications → thấy tin "đã đếm xong" (đổi rác) có chấm "chưa đọc" → chạm mở → quay lại → "Đọc tất cả"',
      expected: 'Danh sách khớp GET /me/notifications (tin INAPP của chính khách: đổi rác, cộng đồng, sự kiện); chạm một tin → tin đó READ trong DB; "Đọc tất cả" → không còn tin chưa đọc (DB 0, UI hết chấm)',
    }),
    async (c) => {
      const list = await call('GET', '/me/notifications', 'returning');
      const codes = [...new Set((list.body ?? []).map((x) => x.templateCode))].sort();
      c.check('GET /me/notifications 200, có WASTE_POINTS_CREDITED, COMMUNITY_EVENT_WINNER', list.status === 200 && codes.includes('WASTE_POINTS_CREDITED') && codes.includes('COMMUNITY_EVENT_WINNER'), codes);
      const u0 = await unread('uat_returning');
      c.check('DB có tin chưa đọc', u0 > 0, u0);
      const target = (list.body ?? []).find((x) => x.templateCode === 'WASTE_POINTS_CREDITED' && x.status !== 'READ');
      const s = await open(L.n, 'returning', { headless, path: '/notifications' });
      try {
        const p = s.page;
        const row = p.getByRole('button').filter({ hasText: target?.payload?.body?.slice(0, 40) ?? 'đã đếm xong' }).first();
        await row.waitFor({ timeout: 30_000 });
        const dots = await p.getByRole('img', { name: 'chưa đọc' }).count();
        c.check('UI có chấm "chưa đọc" bằng số tin chưa đọc trong 50 tin mới nhất', dots === Math.min(u0, (list.body ?? []).filter((x) => x.status !== 'READ').length), { dots, u0 });
        await p.screenshot({ path: shot('U4-39-notifications-unread') });
        const resp = p.waitForResponse((r) => r.url().endsWith(`/api/me/notifications/${target.id}/read`), { timeout: 15_000 });
        await row.click();
        c.check('POST /me/notifications/:id/read → 2xx', (await resp).status() < 300);
        const detail = p.getByRole('dialog', { name: 'Chi tiết thông báo' });
        await detail.waitFor({ timeout: 10_000 });
        c.check('Mở chi tiết tin, có nội dung đổi rác', /đã đếm xong/.test(await detail.innerText()));
        await p.screenshot({ path: shot('U4-39-notification-detail') });
        await detail.getByRole('button', { name: 'Quay lại' }).click();
        await detail.waitFor({ state: 'detached', timeout: 10_000 });
        const [one] = await q(`SELECT status FROM notification_logs WHERE id = $1`, target.id);
        c.check('DB tin vừa chạm = READ', one?.status === 'READ', one);
        const u1 = await unread('uat_returning');
        c.check('DB chưa đọc giảm 1', u1 === u0 - 1, { u0, u1 });
        const all = p.waitForResponse((r) => r.url().endsWith('/api/me/notifications/read-all'), { timeout: 15_000 });
        await p.getByRole('button', { name: 'Đọc tất cả' }).click();
        c.check('POST /me/notifications/read-all → 2xx', (await all).status() < 300);
        await p.waitForTimeout(1000);
        c.check('UI hết chấm "chưa đọc"', (await p.getByRole('img', { name: 'chưa đọc' }).count()) === 0);
        await p.screenshot({ path: shot('U4-39-notifications-read') });
      } finally {
        await s.close();
      }
      const u2 = await unread('uat_returning');
      c.check('DB không còn tin INAPP chưa đọc', u2 === 0, u2);
      c.actual(`${(list.body ?? []).length} tin, mã ${codes.join(',')}; chưa đọc ${u0} → chạm một tin còn ${u0 - 1} → "Đọc tất cả" còn ${u2}.`);
      c.ev(relShot('U4-39-notifications-unread'));
      c.ev(relShot('U4-39-notifications-read'));
      c.ev(`SQL count(status<>'READ') INAPP uat_returning: ${u0} → ${u2}`);
    },
  ),
);

// ---------- U4-40: tắt nhóm tin
cases.push(
  await runCase(
    new Case('U4-40', {
      role: 'KHÁCH (uat_returning), NHÂN VIÊN (uat_staff), KIỂM DUYỆT (uat_cskh)',
      journey: 'Tắt nhận tin theo nhóm ở Cài đặt',
      steps: '/settings → tắt "Nhắc nhở Vườn Xanh & tương tác bài viết" và "Khuyến mãi & mã giảm giá" → tải lại; uat_staff thích + bình luận bài dự thi của khách (và bài của uat_new để đối chứng); khách đăng bài có từ cấm, CSKH từ chối',
      expected: 'users.notifyGarden = false, notifyPromo = false (giữ sau tải lại); không ghi COMMUNITY_POST_LIKED/COMMENTED cho khách đã tắt (uat_new còn bật vẫn nhận); tin giao dịch COMMUNITY_POST_REJECTED vẫn tới',
    }),
    async (c) => {
      const s = await open(L.n, 'returning', { headless, path: '/settings' });
      try {
        const p = s.page;
        for (const name of ['Nhắc nhở Vườn Xanh & tương tác bài viết', 'Khuyến mãi & mã giảm giá']) {
          const sw = p.getByRole('switch', { name });
          await sw.waitFor({ timeout: 30_000 });
          if ((await sw.getAttribute('aria-checked')) === 'true') {
            const resp = p.waitForResponse((r) => r.url().endsWith('/api/me/notifications/prefs') && r.request().method() === 'PATCH', { timeout: 15_000 });
            await sw.click();
            c.check(`PATCH prefs (${name}) → 2xx`, (await resp).status() < 300);
          }
        }
        await p.reload();
        const g = p.getByRole('switch', { name: 'Nhắc nhở Vườn Xanh & tương tác bài viết' });
        await g.waitFor({ timeout: 30_000 });
        await p.waitForTimeout(1000);
        c.check('Sau tải lại hai công tắc vẫn tắt', (await g.getAttribute('aria-checked')) === 'false' && (await p.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' }).getAttribute('aria-checked')) === 'false');
        await p.screenshot({ path: shot('U4-40-settings-off') });
      } finally {
        await s.close();
      }
      const [u] = await q(`SELECT "notifyGarden", "notifyPromo" FROM users WHERE id = 'uat_returning'`);
      c.check('DB users.notifyGarden = false, notifyPromo = false', u?.notifyGarden === false && u?.notifyPromo === false, u);
      const liked0 = await countOf('uat_returning', 'COMMUNITY_POST_LIKED');
      const comm0 = await countOf('uat_returning', 'COMMUNITY_POST_COMMENTED');
      const ctl0 = await countOf('uat_new', 'COMMUNITY_POST_LIKED');
      const rLike = await call('POST', `/feed/${cs.eventPost}/react`, 'staff');
      const rCom = await call('POST', `/feed/${cs.eventPost}/comments`, 'staff', { body: 'Góc gom gọn gàng quá!' });
      const rCtl = await call('POST', `/feed/${cs.newPost1}/react`, 'staff');
      c.check('uat_staff thích + bình luận → 2xx', rLike.status < 300 && rCom.status < 300 && rCtl.status < 300, [rLike.status, rCom.status, rCtl.status]);
      await sleep(1500);
      const liked1 = await countOf('uat_returning', 'COMMUNITY_POST_LIKED');
      const comm1 = await countOf('uat_returning', 'COMMUNITY_POST_COMMENTED');
      const ctl1 = await countOf('uat_new', 'COMMUNITY_POST_LIKED');
      c.check('Khách đã tắt: không thêm COMMUNITY_POST_LIKED / COMMENTED', liked1 === liked0 && comm1 === comm0, { liked0, liked1, comm0, comm1 });
      c.check('Đối chứng uat_new còn bật: có thêm COMMUNITY_POST_LIKED', ctl1 === ctl0 + 1, { ctl0, ctl1 });
      const rej0 = await countOf('uat_returning', 'COMMUNITY_POST_REJECTED');
      const flagged = await call('POST', '/feed', 'returning', { kind: 'TIP', body: 'Có ai rủ cá cược bóng đá không?' });
      const rr = await call('POST', `/feed/admin/${flagged.body?.id}/reject`, 'cskh', { reason: 'Nội dung cá cược' });
      await sleep(1000);
      const rej1 = await countOf('uat_returning', 'COMMUNITY_POST_REJECTED');
      c.check('Tin giao dịch COMMUNITY_POST_REJECTED vẫn tới', flagged.body?.status === 'PENDING' && rr.status < 300 && rej1 === rej0 + 1, { post: flagged.body, reject: rr.status, rej0, rej1 });
      c.actual(`notifyGarden=${u?.notifyGarden}, notifyPromo=${u?.notifyPromo}; LIKED ${liked0}→${liked1}, COMMENTED ${comm0}→${comm1} (đối chứng uat_new LIKED ${ctl0}→${ctl1}); REJECTED ${rej0}→${rej1}. Tin nhóm khuyến mãi do cron sinh, chưa chạy ở ca này: chặn PROMO chưa kiểm chứng.`);
      c.ev(relShot('U4-40-settings-off'));
      c.ev(`SQL users uat_returning ${JSON.stringify(u)}; notification_logs INAPP LIKED ${liked0}→${liked1}, COMMENTED ${comm0}→${comm1}, REJECTED ${rej0}→${rej1}; uat_new LIKED ${ctl0}→${ctl1}`);
    },
  ),
);

saveResults('50-notifications', cases);
await closePrisma();
log('xong');
