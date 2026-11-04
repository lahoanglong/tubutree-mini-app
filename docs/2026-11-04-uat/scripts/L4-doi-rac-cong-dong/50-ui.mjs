// Giao diện thật (Playwright, một trình duyệt tại một thời điểm): Mini 375, web 375, web 1280.
//   node 50-ui.mjs matrix   : ma trận trang x khổ (chụp ảnh, tràn ngang, lỗi console/API, chữ, link ngoài ở Mini)
//   node 50-ui.mjs flows    : hành trình bấm thật (tạo yêu cầu, quầy xác nhận, huỷ, điểm danh, bình luận, CSKH duyệt/ẩn)
// Chạy sau 60-race.mjs / 70-perm.mjs trên cùng lane (cần dữ liệu có sẵn). Ảnh lưu ở docs/2026-11-04-uat/shots/L4-doi-rac-cong-dong.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { H, SHOTS, sql, call, idem, pointsState, check, short, msg, readParams, closeDb, toneIssues } from './l4lib.mjs';

fs.mkdirSync(SHOTS, { recursive: true });
const mini = await import(pathToFileURL(`${H}/miniapp-session.mjs`).href);
const web = await import(pathToFileURL(`${H}/web-session.mjs`).href);
const P = readParams();
const VP = {
  mini375: { width: 375, height: 812, isMobile: true, hasTouch: true },
  web375: { width: 375, height: 812, isMobile: true, hasTouch: true },
  web1280: { width: 1280, height: 800, isMobile: false, hasTouch: false },
};
const mk = (surf, persona, journey, step, expected) => ({ persona, viewport: surf, journey, step, expected });
const sess = (surf, persona, p) => (surf.startsWith('mini') ? mini.open(4, persona, { viewport: VP[surf], path: p }) : web.openWeb(4, persona, { viewport: VP[surf], path: p }));
const shot = async (s, name) => {
  const f = path.join(SHOTS, `${name}.png`);
  await s.page.screenshot({ path: f }).catch(() => undefined);
  return path.relative(path.resolve(SHOTS, '../..'), f);
};
const mode = process.argv[2] ?? 'all';

const BAD_CONSOLE = (t) => !/401 \(Unauthorized\)|favicon|Download the React DevTools|ERR_BLOCKED_BY_CLIENT|Failed to load resource: net::ERR_FAILED/.test(t);
async function pageMetrics(s) {
  return s.page.evaluate(() => {
    const vw = window.innerWidth;
    const scrollers = [document.documentElement, document.body, ...document.querySelectorAll('.zaui-page')];
    const over = Math.max(...scrollers.map((e) => e.scrollWidth)) - vw;
    const anchors = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, blank: a.target === '_blank', text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40) }));
    const ext = anchors.filter((a) => /^https?:/i.test(a.href) && new URL(a.href).host !== location.host);
    const nav = document.querySelector('nav[aria-label]');
    return {
      path: location.pathname + location.search,
      over,
      text: document.body.innerText,
      ext,
      blank: anchors.filter((a) => a.blank).length,
      navButtons: nav ? nav.querySelectorAll('button').length : 0,
      textareas: document.querySelectorAll('textarea').length,
      inputs: [...document.querySelectorAll('input:not([type=hidden])')].filter((e) => e.offsetParent !== null).length,
    };
  });
}

// ---------------------------------------------------------------- MA TRẬN TRANG
async function matrix() {
  const reqDone = (await sql(`SELECT id FROM waste_requests WHERE "userId"='uat_returning' AND status='COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
  const q1 = (await sql(`SELECT id FROM feed_posts WHERE status='PUBLISHED' AND kind='QUESTION' ORDER BY "createdAt" ASC LIMIT 1`))[0]?.id;
  const pages = [
    ['recycle-hub', '/recycle', '/doi-rac', 'returning'],
    ['recycle-rules', '/recycle/rules', '/doi-rac/quy-dinh', 'returning'],
    ['recycle-new', '/recycle/new', '/doi-rac/tao', 'returning'],
    ['recycle-points', '/recycle/points', '/doi-rac/diem-nhan', 'returning'],
    ['recycle-requests', '/recycle/requests', '/doi-rac/yeu-cau', 'returning'],
    ['recycle-request', `/recycle/r/${reqDone}`, `/doi-rac/yeu-cau/${reqDone}`, 'returning'],
    ['recycle-done', `/recycle/done/${reqDone}`, `/doi-rac/xong/${reqDone}`, 'returning'],
    ['rewards', '/rewards', '/kho-qua', 'returning'],
    ['rewards-mine', '/rewards/mine', '/kho-qua/cua-toi', 'returning'],
    ['garden', '/game', '/vuon-xanh', 'returning'],
    ['feed', '/feed', '/cong-dong', 'returning'],
    ['post', `/feed/${q1}`, `/cong-dong/${q1}`, 'returning'],
    ['events', '/feed/events', '/cong-dong/su-kien', 'returning'],
    ['desk', '/recycle/desk', '/doi-rac/quay', 'staff'],
    ['recycle-hub-new', '/recycle', '/doi-rac', 'new_nophone'],
    ['garden-new', '/game', '/vuon-xanh', 'new_nophone'],
  ];
  for (const surf of ['mini375', 'web375', 'web1280']) {
    const byPersona = new Map();
    for (const pg of pages) byPersona.set(pg[3], [...(byPersona.get(pg[3]) ?? []), pg]);
    for (const [persona, list] of byPersona) {
      let s;
      try {
        s = await sess(surf, persona, surf.startsWith('mini') ? '/' : '/');
      } catch (e) {
        for (const pg of list) check(`U-${surf}-${pg[0]}-${persona}`, mk(surf, persona, 'Mở trang', pg[0], 'Trang mở được'), 'BLOCKED', `không mở được phiên: ${String(e).slice(0, 160)}`);
        continue;
      }
      for (const [slug, miniPath, webPath] of list) {
        const id = `U-${surf}-${slug}-${persona}`;
        try {
          const target = surf.startsWith('mini') ? miniPath : webPath;
          s.requests.length = 0;
          s.consoleErrors.length = 0;
          s.errors.length = 0;
          await s.goto(target);
          await s.page.waitForTimeout(1800);
          const m = await pageMetrics(s);
          const file = await shot(s, `${surf}-${persona}-${slug}`);
          const issues = [];
          if (m.over > 1) issues.push(`tràn ngang ${m.over}px`);
          const cons = s.consoleErrors.filter(BAD_CONSOLE);
          if (s.errors.length) issues.push(`lỗi trang: ${s.errors[0].slice(0, 120)}`);
          if (cons.length) issues.push(`lỗi console: ${cons[0].slice(0, 120)}`);
          const badApi = s.requests.filter((r) => r.status >= 500 || (r.status >= 400 && !/\/auth\/|\/me\/loyalty\/member-card/.test(r.path) && r.status !== 401) || (r.status === 0 && !/ABORTED/i.test(r.failure ?? '')));
          if (badApi.length) issues.push(`API lỗi: ${badApi.slice(0, 3).map((r) => `${r.method} ${r.path} ${r.status}`).join('; ')}`);
          const junk = (m.text.match(/undefined|NaN|\[object|\bnull\b/g) ?? []).slice(0, 3);
          if (junk.length) issues.push(`chữ lạ: ${junk.join(',')}`);
          const tone = toneIssues(m.text).filter((t) => t !== 'dấu ...');
          if (tone.length) issues.push(`văn phong: ${tone.join(',')}`);
          if (surf.startsWith('mini') && m.ext.length) issues.push(`link ngoài ở Mini: ${m.ext.map((a) => a.href).join(', ').slice(0, 160)}`);
          if (surf.startsWith('mini') && m.blank) issues.push(`link mở tab mới ở Mini: ${m.blank}`);
          if (!m.text.trim()) issues.push('trang trống');
          const rootTab = /^\/(game|offers|cart|account|categories)?$/.test(m.path.split('?')[0]) || m.path === '/game';
          const navNote = surf.startsWith('mini') ? ` nav ${m.navButtons} nút` : '';
          check(id, mk(surf, persona, `Trang ${slug}`, `Mở ${target} (${persona})`, 'Trang hiển thị đủ nội dung, không tràn ngang, không lỗi console/API, chữ sạch (không undefined/NaN, không "Vui lòng"/"chúng tôi"), Mini không có link ngoài'),
            issues.length === 0, `${issues.join(' | ') || 'sạch'}; ${m.text.replace(/\s+/g, ' ').slice(0, 110)}${navNote}`, file);
        } catch (e) {
          check(id, mk(surf, persona, `Trang ${slug}`, 'Mở trang', 'Trang mở được'), 'BLOCKED', `lỗi khi chạy: ${String(e).slice(0, 200)}`);
        }
      }
      await s.close();
    }
  }
}

// ---------------------------------------------------------------- HÀNH TRÌNH BẤM THẬT
const clickText = (s, re) => s.page.getByText(re).first().click();
async function guarded(id, meta, fn) {
  try {
    await fn();
  } catch (e) {
    check(id, meta, 'BLOCKED', `không chạy hết hành trình (chọn phần tử/chờ): ${String(e).split('\n')[0].slice(0, 220)}`);
  }
}

async function createFlow(surf, persona, itemLabelFirst = true) {
  const id = `U-F-create-${surf}`;
  const meta = mk(surf, persona, 'Tạo yêu cầu Đổi rác', 'Chọn 5 thùng carton, mang tới điểm nhận (kho), đồng ý thể lệ, Tạo yêu cầu', 'Tạo được 1 yêu cầu DROP_OFF tại kho, 5 thùng carton, trạng thái OPEN, ước tính 5.000 điểm, chưa đổi số dư');
  await guarded(id, meta, async () => {
    const before = await pointsState(`uat_${persona}`);
    const s = await sess(surf, persona, surf.startsWith('mini') ? '/recycle/new' : '/doi-rac/tao');
    try {
      await s.page.waitForTimeout(1500);
      await s.page.getByRole('button', { name: 'Thêm 5' }).first().click();
      await s.page.waitForTimeout(1200);
      const est = await s.page.evaluate(() => /Ước tính 5\.000 điểm/.test(document.body.innerText));
      await shot(s, `${surf}-${persona}-create-1-items`);
      await s.page.getByRole('button', { name: 'Tiếp tục' }).click();
      await s.page.waitForTimeout(1200);
      await s.page.getByText('Mang tới điểm nhận').first().click();
      await s.page.getByRole('button', { name: /Chọn điểm nhận|Đổi điểm nhận/ }).click();
      await s.page.waitForTimeout(1500);
      await shot(s, `${surf}-${persona}-create-2-picker`);
      await s.page.getByText('Điểm nhận Tubu Quận 1').first().click();
      await s.page.getByRole('button', { name: 'Chọn điểm này' }).click();
      await s.page.waitForTimeout(1200);
      await s.page.locator('input[type=checkbox]').first().check({ force: true });
      await shot(s, `${surf}-${persona}-create-3-consent`);
      await s.page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
      await s.page.waitForURL(/\/(recycle\/r|doi-rac\/yeu-cau)\//, { timeout: 15000 });
      await s.page.waitForTimeout(1500);
      const file = await shot(s, `${surf}-${persona}-create-4-done`);
      const url = s.page.url();
      const text = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const rid = url.split('/').pop();
      const row = (await sql(`SELECT status::text AS st, method::text AS m, "pointId" AS pid, code FROM waste_requests WHERE id='${rid}'`))[0];
      const lines = await sql(`SELECT "itemId", "declaredQty" FROM waste_request_lines WHERE "requestId"='${rid}'`);
      const after = await pointsState(`uat_${persona}`);
      const ok = est && row?.st === 'OPEN' && row.m === 'DROP_OFF' && row.pid === P.whId && lines.length === 1 && lines[0].itemId === 'wi-carton' && lines[0].declaredQty === 5 && before.balance === after.balance && /TR-[A-Z0-9]{5}/.test(text) && /5\.000 điểm/.test(text);
      P[`uiRequest_${surf}`] = { id: rid, code: row?.code };
      check(id, meta, ok, `ước tính ở bước 1: ${est}; DB ${short(row, 140)} dòng ${short(lines, 100)}; số dư ${before.balance}→${after.balance}; trang: ${text.slice(0, 120)}`, file);
    } finally {
      await s.close();
    }
  });
}

async function deskFlow(surf, code) {
  const id = `U-F-desk-${surf}`;
  const meta = mk(surf, 'staff', 'Quầy xác nhận', `Nhập mã ${code}, Tra mã, Xác nhận đã nhận`, 'Cộng đúng 5.000 điểm cho khách: sổ RECYCLE dương, yêu cầu COMPLETED, số dư khách = tổng sổ; màn quầy báo thành công');
  await guarded(id, meta, async () => {
    const owner = (await sql(`SELECT "userId" AS u FROM waste_requests WHERE code='${code}'`))[0].u;
    const before = await pointsState(owner);
    const s = await sess(surf, 'staff', surf.startsWith('mini') ? '/recycle/desk' : '/doi-rac/quay');
    try {
      await s.page.waitForTimeout(1500);
      await s.page.getByPlaceholder(/TR-/).fill(code);
      await s.page.getByRole('button', { name: 'Tra mã' }).click();
      await s.page.waitForTimeout(1800);
      await shot(s, `${surf}-staff-desk-1-lookup`);
      const preview = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      await s.page.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
      await s.page.waitForTimeout(2500);
      const file = await shot(s, `${surf}-staff-desk-2-confirmed`);
      const after = await pointsState(owner);
      const row = (await sql(`SELECT status::text AS st, "pointsAwarded" AS pts FROM waste_requests WHERE code='${code}'`))[0];
      const led = await sql(`SELECT delta FROM points_transactions WHERE "userId"='${owner}' AND reason='RECYCLE:${code}'`);
      const text = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const ok = row?.st === 'COMPLETED' && row.pts === 5000 && after.balance - before.balance === 5000 && led.length === 1 && led[0].delta === 5000 && after.balance === after.ledgerSum && /5\.000 điểm/.test(preview);
      check(id, meta, ok, `xem trước: ${preview.slice(preview.indexOf(code), preview.indexOf(code) + 200)}; DB ${short(row, 80)}; ${before.balance}→${after.balance} sổ ${after.ledgerSum}; sau xác nhận: ${text.slice(0, 200)}`, file);
    } finally {
      await s.close();
    }
  });
}

async function cancelFlow(surf) {
  const id = `U-F-cancel-${surf}`;
  const meta = mk(surf, 'kho', 'Huỷ yêu cầu', 'Mở yêu cầu OPEN, bấm Huỷ yêu cầu, xác nhận', 'Yêu cầu chuyển CANCELLED, không đổi số dư, màn báo đã huỷ');
  await guarded(id, meta, async () => {
    const c = await call('kho', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 1 }] }, idem(`cancel-${surf}`));
    const rid = c.body?.id;
    if (!rid) throw new Error(`tạo yêu cầu thử huỷ lỗi ${c.status} ${msg(c)}`);
    const before = await pointsState('uat_kho');
    const s = await sess(surf, 'kho', surf.startsWith('mini') ? `/recycle/r/${rid}` : `/doi-rac/yeu-cau/${rid}`);
    try {
      await s.page.waitForTimeout(1500);
      await shot(s, `${surf}-kho-cancel-1-open`);
      await s.page.getByRole('button', { name: 'Huỷ yêu cầu' }).first().click();
      await s.page.waitForTimeout(800);
      await shot(s, `${surf}-kho-cancel-2-confirm`);
      const dlg = s.page.getByRole('button', { name: /^(Huỷ yêu cầu|Xác nhận huỷ|Đồng ý|Huỷ luôn)$/ });
      const n = await dlg.count();
      if (n > 1) await dlg.last().click();
      else if (n === 1 && (await s.page.getByRole('dialog').count()) > 0) await dlg.first().click();
      await s.page.waitForTimeout(2000);
      const file = await shot(s, `${surf}-kho-cancel-3-done`);
      const row = (await sql(`SELECT status::text AS st FROM waste_requests WHERE id='${rid}'`))[0];
      const after = await pointsState('uat_kho');
      const text = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      check(id, meta, row?.st === 'CANCELLED' && before.balance === after.balance, `DB ${row?.st}; số dư ${before.balance}→${after.balance}; trang: ${text.slice(0, 160)}`, file);
    } finally {
      await s.close();
    }
  });
}

async function gardenFlow(surf, persona) {
  const id = `U-F-garden-${surf}`;
  const meta = mk(surf, persona, 'Điểm danh Vườn Xanh', 'Mở Vườn Xanh, bấm Điểm danh', 'Cộng đúng 1.000 Điểm Xanh (DAILY_CHECKIN:DAY_1) + 65 giọt nước, chuỗi 1; số dư = tổng sổ; bấm lần hai không cộng thêm');
  await guarded(id, meta, async () => {
    const u = `uat_${persona}`;
    const before = await pointsState(u);
    const seeds0 = (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='${u}'),0) AS s`))[0].s;
    const s = await sess(surf, persona, surf.startsWith('mini') ? '/game' : '/vuon-xanh');
    try {
      await s.page.waitForTimeout(2000);
      await shot(s, `${surf}-${persona}-garden-1-before`);
      await s.page.getByRole('button', { name: /Điểm danh/ }).first().click();
      await s.page.waitForTimeout(2500);
      const file = await shot(s, `${surf}-${persona}-garden-2-after`);
      const after = await pointsState(u);
      const seeds1 = (await sql(`SELECT COALESCE((SELECT "totalSeeds" FROM game_profiles WHERE "userId"='${u}'),0) AS s`))[0].s;
      const rows = (await sql(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId"='${u}' AND "refType"='CHECKIN'`))[0].n;
      const text = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const again = await call(persona, 'POST', '/me/daily-check-in');
      const after2 = await pointsState(u);
      const ok = after.balance - before.balance === 1000 && seeds1 - seeds0 === 65 && rows === 1 && after.balance === after.ledgerSum && after2.balance === after.balance;
      check(id, meta, ok, `${before.balance}→${after.balance} sổ ${after.ledgerSum}; giọt ${seeds0}→${seeds1}; dòng CHECKIN ${rows}; bấm lại ${again.status} số dư ${after2.balance}; trang: ${text.slice(0, 140)}`, file);
    } finally {
      await s.close();
    }
  });
}

async function communityMiniReadOnly() {
  const surf = 'mini375';
  const id = 'U-F-community-mini';
  const meta = mk(surf, 'returning', 'Cộng đồng trên Mini', 'Xem bảng tin, mở bài có link được phép (tubutree.com, zalo.me) và bài có bình luận', 'Mini chỉ đọc: không ô soạn bài/bình luận, không link ra ngoài (kể cả link nằm trong nội dung bài/bình luận), không target=_blank, chỉ có "Báo cáo"');
  await guarded(id, meta, async () => {
    const catId = (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id;
    const linked = await call('dealer', 'POST', '/feed', { categoryId: catId, kind: 'MANUAL', body: 'Hướng dẫn dùng nước rửa chén: https://tubutree.com/huong-dan và nhóm Zalo https://zalo.me/g/abc xem thêm nhé.' });
    const cm = await call('returning', 'POST', `/feed/${linked.body?.id}/comments`, { body: 'Cảm ơn bạn, mình xem thêm ở https://tubutree.com/faq nhé.' });
    const s = await sess(surf, 'new_nophone', '/feed');
    try {
      await s.page.waitForTimeout(1500);
      const feedM = await pageMetrics(s);
      const f1 = await shot(s, 'mini375-community-feed');
      await s.goto(`/feed/${linked.body?.id}`);
      await s.page.waitForTimeout(2000);
      const m = await pageMetrics(s);
      const f2 = await shot(s, 'mini375-community-post-with-links');
      const bodyShowsLink = /tubutree\.com\/huong-dan|zalo\.me\/g\/abc/.test(m.text);
      const issues = [];
      if (feedM.ext.length || m.ext.length) issues.push(`link ngoài: ${[...feedM.ext, ...m.ext].map((a) => a.href).join(', ')}`);
      if (feedM.blank || m.blank) issues.push(`target=_blank ${feedM.blank + m.blank}`);
      if (m.textareas > 0 && !/Báo cáo/.test(m.text)) issues.push('có ô nhập trên chi tiết bài');
      const clickables = await s.page.evaluate(() => [...document.querySelectorAll('[role=link],[onclick]')].map((e) => (e.innerText || '').trim().slice(0, 40)).slice(0, 8));
      check(id, meta, issues.length === 0, `${issues.join(' | ') || 'không link ngoài'}; nội dung hiện link dạng chữ: ${bodyShowsLink}; ô nhập ở chi tiết: textarea ${m.textareas}, input ${m.inputs}; bình luận tạo ${cm.status}; phần tử bấm được lạ: ${short(clickables, 120)}`, `${f1}, ${f2}`);
      const tapped = s.page.getByText(/tubutree\.com\/huong-dan/).first();
      if ((await tapped.count()) > 0) {
        const urlBefore = s.page.url();
        s.requests.length = 0;
        await tapped.click({ trial: false }).catch(() => undefined);
        await s.page.waitForTimeout(800);
        const calls = await s.zmpCalls();
        const popup = s.context.pages().length;
        check('U-F-community-mini-tap', mk(surf, 'new_nophone', 'Cộng đồng trên Mini', 'Bấm vào chữ link trong nội dung bài', 'Không mở được trang ngoài: không đổi URL ra ngoài, không gọi openWebview/openOutApp, không mở tab mới'),
          s.page.url() === urlBefore && popup === 1 && !calls.some((c) => /openWebview|openOutApp/.test(c.name)), `url ${s.page.url() === urlBefore ? 'giữ nguyên' : s.page.url()}; tab ${popup}; lệnh zmp ${short(calls.map((c) => c.name), 80)}`, '');
      } else {
        check('U-F-community-mini-tap', mk(surf, 'new_nophone', 'Cộng đồng trên Mini', 'Bấm vào chữ link trong nội dung bài', 'Không mở được trang ngoài'), true, 'nội dung link không hiện thành chữ bấm được (đã ẩn hoặc không render)', '');
      }
    } finally {
      await s.close();
    }
  });
}

async function communityWebComment(surf, persona) {
  const id = `U-F-comment-${surf}`;
  const meta = mk(surf, persona, 'Bình luận ở web', 'Mở bài, gõ bình luận, Gửi', 'Bình luận xuất hiện ngay và có 1 dòng feed_comments; bài tăng số bình luận');
  await guarded(id, meta, async () => {
    const q = (await sql(`SELECT id FROM feed_posts WHERE status='PUBLISHED' AND "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
    const body = `Bình luận từ giao diện ${surf} lúc ${Date.now() % 100000}.`;
    const s = await sess(surf, persona, `/cong-dong/${q}`);
    try {
      await s.page.waitForTimeout(1500);
      await s.page.getByPlaceholder(/Viết trả lời/).fill(body);
      await s.page.getByRole('button', { name: 'Gửi' }).click();
      await s.page.waitForTimeout(2200);
      const file = await shot(s, `${surf}-${persona}-community-comment`);
      const n = (await sql(`SELECT count(*)::int AS n FROM feed_comments WHERE "postId"='${q}' AND body='${body}'`))[0].n;
      const text = await s.page.evaluate(() => document.body.innerText);
      check(id, meta, n === 1 && text.includes(body), `DB ${n} dòng; hiện trên trang: ${text.includes(body)}`, file);
    } finally {
      await s.close();
    }
  });
}

async function cskhModeration() {
  const surf = 'web1280';
  const mkPending = async (txt) => (await call('returning', 'POST', '/feed', { categoryId: (await call('returning', 'GET', '/feed/categories')).body?.[0]?.id, kind: 'MANUAL', body: `${txt} http://spam-shop.example.com/x` })).body?.id;
  const a = await mkPending('Bài chờ duyệt để CSKH bấm Duyệt');
  const b = await mkPending('Bài chờ duyệt để CSKH bấm Từ chối');
  const id = 'U-F-cskh-approve';
  const meta = mk(surf, 'cskh', 'CSKH kiểm duyệt', 'Mở Quản trị > Cộng đồng, bấm Duyệt bài A rồi Từ chối bài B', 'Bài A thành PUBLISHED và hiện ở bảng tin; bài B thành REJECTED/REMOVED và không hiện; thao tác có thông báo cho tác giả');
  await guarded(id, meta, async () => {
    const s = await sess(surf, 'cskh', '/admin?tab=community');
    try {
      await s.page.waitForTimeout(2500);
      await shot(s, 'web1280-cskh-community-queue');
      const cardA = s.page.locator('li,article,div').filter({ hasText: 'để CSKH bấm Duyệt' }).filter({ has: s.page.getByRole('button', { name: 'Duyệt' }) }).last();
      await cardA.getByRole('button', { name: 'Duyệt' }).click();
      await s.page.waitForTimeout(1800);
      const f1 = await shot(s, 'web1280-cskh-community-after-approve');
      const stA = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${a}'`))[0].s;
      const cardB = s.page.locator('li,article,div').filter({ hasText: 'để CSKH bấm Từ chối' }).filter({ has: s.page.getByRole('button', { name: 'Từ chối' }) }).last();
      await cardB.getByRole('button', { name: 'Từ chối' }).click();
      await s.page.waitForTimeout(1000);
      const dlgText = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
      await shot(s, 'web1280-cskh-community-reject-dialog');
      const reason = s.page.locator('textarea, input[type=text]').last();
      if ((await reason.count()) > 0) await reason.fill('Có link lạ, bài chưa phù hợp').catch(() => undefined);
      const confirmBtn = s.page.getByRole('button', { name: /^(Từ chối|Xác nhận|Gửi|Đồng ý)$/ });
      await confirmBtn.last().click();
      await s.page.waitForTimeout(2000);
      const f2 = await shot(s, 'web1280-cskh-community-after-reject');
      const stB = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${b}'`))[0].s;
      const feed = await call('new_nophone', 'GET', '/feed');
      const ids = (feed.body?.posts ?? []).map((x) => x.id);
      const notifA = await sql(`SELECT "templateCode" AS c FROM notification_logs WHERE "userId"='uat_returning' AND payload::text LIKE '%Bài chờ duyệt để CSKH bấm%' ORDER BY "sentAt"`);
      check(id, meta, stA === 'PUBLISHED' && ['REJECTED', 'REMOVED'].includes(stB) && ids.includes(a) && !ids.includes(b), `A=${stA} (hiện ở bảng tin ${ids.includes(a)}); B=${stB} (hiện ${ids.includes(b)}); hộp thoại từ chối: ${dlgText.slice(0, 160)}; tin cho tác giả: ${short(notifA.map((n) => n.c), 100)}`, `${f1}, ${f2}`);
    } finally {
      await s.close();
    }
  });
  const id2 = 'U-F-cskh-hide';
  const meta2 = mk(surf, 'cskh', 'CSKH kiểm duyệt', 'Mở tab Đã đăng, ẩn một bài đã đăng kèm lý do', 'Bài thành REMOVED/HIDDEN, biến khỏi bảng tin khách, vẫn có ở tab Đã đăng của CSKH (nếu có lịch sử)');
  await guarded(id2, meta2, async () => {
    const target = (await sql(`SELECT id FROM feed_posts WHERE status='PUBLISHED' AND body LIKE 'Bài đua số 2%' LIMIT 1`))[0]?.id;
    const s = await sess(surf, 'cskh', '/admin?tab=community');
    try {
      await s.page.waitForTimeout(2000);
      await s.page.getByRole('button', { name: 'Đã đăng' }).click();
      await s.page.waitForTimeout(2000);
      const f0 = await shot(s, 'web1280-cskh-community-published');
      const els = await s.page.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30)).filter(Boolean));
      const card = s.page.locator('li,article,div').filter({ hasText: 'Bài đua số 2' }).filter({ has: s.page.getByRole('button', { name: /Ẩn|Gỡ/ }) }).last();
      await card.getByRole('button', { name: /Ẩn|Gỡ/ }).first().click();
      await s.page.waitForTimeout(900);
      const reason = s.page.locator('textarea, input[type=text]').last();
      if ((await reason.count()) > 0) await reason.fill('Nội dung lặp, ẩn thử').catch(() => undefined);
      await s.page.getByRole('button', { name: /^(Ẩn|Gỡ|Xác nhận|Đồng ý)( bài)?$/ }).last().click();
      await s.page.waitForTimeout(2000);
      const f1 = await shot(s, 'web1280-cskh-community-after-hide');
      const st = (await sql(`SELECT status::text AS s FROM feed_posts WHERE id='${target}'`))[0].s;
      const feed = await call('new_nophone', 'GET', '/feed');
      const ids = (feed.body?.posts ?? []).map((x) => x.id);
      check(id2, meta2, ['REMOVED', 'HIDDEN'].includes(st) && !ids.includes(target), `trạng thái ${st}; còn trong bảng tin khách: ${ids.includes(target)}; nút thấy: ${els.slice(0, 14).join(' / ')}`, `${f0}, ${f1}`);
    } finally {
      await s.close();
    }
  });
}

async function webCreateGate() {
  // khách chưa đăng nhập vào trang riêng tư của web: được dẫn đi đăng nhập, không lộ dữ liệu
  for (const surf of ['web375', 'web1280']) {
    const id = `U-F-guest-${surf}`;
    const meta = mk(surf, 'guest', 'Khách chưa đăng nhập', 'Mở /doi-rac/tao, /vuon-xanh, /kho-qua, /cong-dong khi chưa đăng nhập', 'Trang riêng tư không lộ dữ liệu cá nhân và không lỗi trắng; /cong-dong xem được (xem trước công khai)');
    await guarded(id, meta, async () => {
      const s = await sess(surf, 'guest', '/');
      try {
        const out = [];
        for (const p of ['/doi-rac/tao', '/vuon-xanh', '/kho-qua', '/cong-dong', '/doi-rac/quy-dinh']) {
          s.requests.length = 0;
          await s.goto(p);
          await s.page.waitForTimeout(1500);
          const t = (await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 90);
          const bad = s.requests.filter((r) => r.status >= 500);
          out.push(`${p}→${s.page.url().replace(/^https?:\/\/[^/]+/, '')} [${t}]${bad.length ? ' 5xx' : ''}`);
        }
        const file = await shot(s, `${surf}-guest-last`);
        check(id, meta, out.every((x) => !/ 5xx/.test(x) && !/\[\]/.test(x)) && !out.some((x) => /0901|pointsBalance/.test(x)), out.join(' ; '), file);
      } finally {
        await s.close();
      }
    });
  }
}

async function flows() {
  await createFlow('mini375', 'brand');
  const code = P.uiRequest_mini375?.code;
  if (code) await deskFlow('mini375', code);
  await cancelFlow('mini375');
  await gardenFlow('mini375', 'ctv');
  await communityMiniReadOnly();
  await createFlow('web375', 'dealer');
  await createFlow('web1280', 'ketoan');
  const code2 = P.uiRequest_web375?.code;
  if (code2) await deskFlow('web375', code2);
  await cancelFlow('web1280');
  await gardenFlow('web375', 'ketoan');
  await gardenFlow('web1280', 'marketing');
  await communityWebComment('web375', 'new_nophone');
  await communityWebComment('web1280', 'dealer');
  await cskhModeration();
  await webCreateGate();
}

if (mode === 'matrix' || mode === 'all') await matrix();
if (mode === 'flows' || mode === 'all') await flows();
await closeDb();
