#!/usr/bin/env node
// U4-20..U4-30: cộng đồng. Khách đăng bài trên Mini App thật (ảnh, gắn sản phẩm, hashtag), thưởng Điểm Xanh có trần ngày,
// bài khách mới chờ duyệt, CSKH duyệt / từ chối / ẩn / ghim trên web admin thật, thích + bình luận, xem trước khi chưa đăng nhập,
// sự kiện (ADMIN chọn người thắng trên Mini App), khoảng quà sự kiện, bảng xếp hạng không lộ dữ liệu cá nhân.
// Chạy sau 00/10/20 (số dư uat_returning đã có điểm đổi rác) trên lane có web (lane-up.sh 4 --web).
// Dùng: node 30-community.mjs [lane] [--headed]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { openWeb } from '../../../tools/uat-harness/web-session.mjs';
import { Case, HERE, L, RESULTS, call, closePrisma, ledger, ledgerRows, log, q, relShot, runCase, saveResults, shot, short, sleep, headless } from './u4-lib.mjs';

const cases = [];
const state = {};
const monthsAhead = (d) => (new Date(d).getTime() - Date.now()) / (30.44 * 86_400_000);

/** Ảnh PNG 96x96 hai màu xanh (giả ảnh vườn) để chọn qua input[type=file] thật. */
function fixturePng() {
  const file = path.join(HERE, 'fixtures', 'vuon-xanh.png');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const w = 96;
  const h = 96;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const leaf = (x - 48) ** 2 + (y - 40) ** 2 < 900;
      raw[o] = leaf ? 46 : 214;
      raw[o + 1] = leaf ? 125 : 236;
      raw[o + 2] = leaf ? 50 : 200;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  );
  return file;
}

async function inapp(userId, templateCode) {
  return q(
    `SELECT id, status, payload->>'body' AS body, payload->>'dedupeKey' AS "dedupeKey", "sentAt" FROM notification_logs WHERE "userId" = $1 AND "templateCode" = $2 AND channel = 'INAPP' ORDER BY "sentAt"`,
    userId,
    templateCode,
  );
}

async function postRow(id) {
  const [r] = await q(
    `SELECT p.id, p.status::text, p.kind::text, p."isPinned", p."userId", COALESCE(array_length(p.images, 1), 0)::int AS images,
            (SELECT json_agg(pr.slug) FROM post_product_tags t JOIN products pr ON pr.id = t."productId" WHERE t."postId" = p.id) AS products,
            (SELECT json_agg(tg.slug) FROM post_tags pt JOIN community_tags tg ON tg.id = pt."tagId" WHERE pt."postId" = p.id) AS tags,
            (SELECT count(*)::int FROM feed_reactions r WHERE r."postId" = p.id) AS likes,
            (SELECT count(*)::int FROM feed_comments c WHERE c."postId" = p.id AND NOT c."isRemoved") AS comments
       FROM feed_posts p WHERE p.id = $1`,
    id,
  );
  return r;
}

/** Mở composer trên /feed, chọn loại, gõ nội dung; tuỳ chọn ảnh, sản phẩm, hashtag; bấm "Đăng" và trả response POST /feed. */
async function composeOnFeed(p, { kindLabel, body, image, productQuery, productName, tags }) {
  await p.getByRole('button', { name: 'Đăng bài', exact: true }).first().click();
  await p.getByRole('button', { name: kindLabel, exact: true }).click();
  await p.getByRole('textbox', { name: 'Chia sẻ chi tiết…' }).fill(body);
  if (image) {
    await p.locator('input[type=file][accept="image/*"][multiple]').setInputFiles(image);
    await p.getByRole('button', { name: 'Xoá ảnh' }).first().waitFor({ timeout: 15_000 });
  }
  if (productQuery) {
    await p.getByPlaceholder('Tìm sản phẩm để gắn…').fill(productQuery);
    await p.getByRole('button', { name: new RegExp(productName) }).first().click({ timeout: 15_000 });
  }
  if (tags) await p.getByRole('textbox', { name: 'Thẻ (hashtag)' }).fill(tags);
  const resp = p.waitForResponse((r) => r.url().endsWith('/api/feed') && r.request().method() === 'POST', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Đăng', exact: true }).click();
  const r = await resp;
  return { status: r.status(), body: await r.json().catch(() => null) };
}

const BODY1 = 'Gom vỏ hộp với túi nilon cả tháng, mang ra đại lý đổi được Điểm Xanh. Nhà mình dùng bột rau má này hằng ngày. Ai cần hỏi thì nhắn Zalo 0901 234 567 nha.';

// ---------- U4-20: khách đã mua đăng bài có ảnh + sản phẩm + hashtag
cases.push(
  await runCase(
    new Case('U4-20', {
      role: 'KHÁCH đã có đơn giao (uat_returning)',
      journey: 'Đăng bài cộng đồng có ảnh, gắn sản phẩm, hashtag; nhận thưởng đăng bài',
      steps: '/feed → "Đăng bài" → "Trải nghiệm" → gõ nội dung → chọn ảnh (input file thật) → tìm "rau má" gắn sản phẩm → hashtag "tái chế, đổi rác" → "Đăng"',
      expected: 'Khách có đơn DELIVERED được đăng thẳng (PUBLISHED); bài lưu 1 ảnh, 1 sản phẩm, 2 thẻ; thưởng 1.000 Điểm Xanh (sổ COMMUNITY_POST:<id>, hạn 12 tháng); số dư = trước + 1.000 = SUM(delta)',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'returning', { headless, path: '/feed' });
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Đăng bài', exact: true }).first().waitFor({ timeout: 30_000 });
        const r = await composeOnFeed(p, {
          kindLabel: 'Trải nghiệm',
          body: BODY1,
          image: fixturePng(),
          productQuery: 'rau má',
          productName: 'Bột rau má nguyên chất Sokfram',
          tags: 'tái chế, đổi rác',
        });
        c.check('POST /feed → 201, status PUBLISHED', r.status === 201 && r.body?.status === 'PUBLISHED', r);
        state.post1 = r.body?.id;
        const snack = p.getByText('Đã đăng bài 🌿');
        await snack.waitFor({ timeout: 10_000 }).catch(() => undefined);
        c.check('Snackbar "Đã đăng bài 🌿"', await snack.isVisible().catch(() => false));
        await p.waitForTimeout(800);
        await p.screenshot({ path: shot('U4-20-feed-posted') });
      } finally {
        await s.close();
      }
      const row = await postRow(state.post1);
      c.check('DB feed_posts: PUBLISHED, SHOWCASE, 1 ảnh, sản phẩm bot-rau-ma-sokfram, 2 thẻ', row?.status === 'PUBLISHED' && row.kind === 'SHOWCASE' && row.images === 1 && row.products?.includes('bot-rau-ma-sokfram') && row.tags?.length === 2, row);
      const rows = await ledgerRows('uat_returning', `COMMUNITY_POST:${state.post1}`);
      const after = await ledger('uat_returning');
      c.check('SQL: 1 dòng COMMUNITY_POST:<id> +1.000 refType COMMUNITY', rows.length === 1 && rows[0].delta === 1000 && rows[0].refType === 'COMMUNITY', rows);
      c.check('SQL: hạn ≈ 12 tháng', rows[0] && monthsAhead(rows[0].expiresAt) > 11.5 && monthsAhead(rows[0].expiresAt) < 12.5, rows[0]?.expiresAt);
      c.check('SQL: số dư = trước + 1.000 = SUM(delta)', after.balance === before.balance + 1000 && after.balance === after.ledgerSum, { before, after });
      c.actual(`Bài ${state.post1} ${row?.status}, ${row?.images} ảnh, sản phẩm ${JSON.stringify(row?.products)}, thẻ ${JSON.stringify(row?.tags)}; sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}).`);
      c.ev(relShot('U4-20-feed-posted'));
      c.ev(`SQL points_transactions COMMUNITY_POST:${state.post1} → ${short(rows.map((x) => ({ delta: x.delta, refType: x.refType, expiresAt: x.expiresAt })))}`);
      c.ev(`SQL users.pointsBalance ${before.balance} → ${after.balance}, SUM = ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-21: bài thứ hai cùng ngày không thưởng; bài có từ cấm vào hàng chờ dù khách tin cậy
cases.push(
  await runCase(
    new Case('U4-21', {
      role: 'KHÁCH đã có đơn giao (uat_returning)',
      journey: 'Trần thưởng đăng bài 1 lần/ngày; bộ lọc từ cấm',
      steps: 'Đăng bài thứ hai (TIP) trong ngày qua API; đăng bài thứ ba có chữ "casino"',
      expected: 'Bài 2 PUBLISHED nhưng không có dòng thưởng (community.daily_post_reward_cap = 1); số dư không đổi = SUM; bài có từ cấm vào PENDING dù khách tin cậy, không thưởng',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const r2 = await call('POST', '/feed', 'returning', { kind: 'TIP', body: 'Mẹo: tráng sơ vỏ hộp sữa, phơi khô rồi gấp dẹt cho gọn túi mang đi đổi.' });
      c.check('Bài 2 → 201 PUBLISHED', r2.status === 201 && r2.body?.status === 'PUBLISHED', r2.body);
      state.post2 = r2.body?.id;
      const r3 = await call('POST', '/feed', 'returning', { kind: 'TIP', body: 'Ai biết chỗ chơi casino online uy tín không, chỉ mình với.' });
      c.check('Bài có "casino" → 201 PENDING', r3.status === 201 && r3.body?.status === 'PENDING', r3.body);
      state.postFlagged = r3.body?.id;
      const rows2 = await ledgerRows('uat_returning', `COMMUNITY_POST:${state.post2}`);
      const rows3 = await ledgerRows('uat_returning', `COMMUNITY_POST:${state.postFlagged}`);
      const after = await ledger('uat_returning');
      c.check('SQL: không có dòng thưởng cho bài 2 và bài chờ duyệt', rows2.length === 0 && rows3.length === 0, { rows2, rows3 });
      c.check('SQL: số dư không đổi = SUM(delta)', after.balance === before.balance && after.balance === after.ledgerSum, { before, after });
      c.actual(`Bài 2 ${r2.body?.status}, bài từ cấm ${r3.body?.status}; sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}).`);
      c.ev(`POST /feed → ${r2.status} ${short(r2.body)}; ${r3.status} ${short(r3.body)}`);
      c.ev(`SQL COMMUNITY_POST:<bài 2> ${rows2.length} dòng, <bài từ cấm> ${rows3.length} dòng`);
    },
  ),
);

// ---------- U4-22: khách mới đăng bài → chờ duyệt
cases.push(
  await runCase(
    new Case('U4-22', {
      role: 'KHÁCH mới chưa có đơn (uat_new)',
      journey: 'Bài của khách mới vào hàng chờ duyệt',
      steps: '/feed → "Đăng bài" → "Mẹo hay" → gõ nội dung → "Đăng"; đăng thêm bài 2 qua API (để CSKH từ chối ở U4-24)',
      expected: 'POST /feed → PENDING; Mini App báo "Bài đang chờ duyệt…"; người khác mở bài → 404; chưa thưởng điểm',
    }),
    async (c) => {
      const s = await open(L.n, 'new', { headless, path: '/feed' });
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Đăng bài', exact: true }).first().waitFor({ timeout: 30_000 });
        const r = await composeOnFeed(p, { kindLabel: 'Mẹo hay', body: 'Mẹo của mình: gấp dẹt hộp carton, buộc chặt rồi mới mang tới điểm nhận, đỡ tốn chỗ.' });
        c.check('POST /feed → 201 PENDING', r.status === 201 && r.body?.status === 'PENDING', r);
        state.newPost1 = r.body?.id;
        const snack = p.getByText('Bài đang chờ duyệt, sẽ hiện sau khi được duyệt 🌱');
        await snack.waitFor({ timeout: 10_000 }).catch(() => undefined);
        c.check('Snackbar "Bài đang chờ duyệt…"', await snack.isVisible().catch(() => false));
        await p.screenshot({ path: shot('U4-22-pending-notice') });
      } finally {
        await s.close();
      }
      const r2 = await call('POST', '/feed', 'new', { kind: 'TIP', body: 'Bài thứ hai của mình để test duyệt.' });
      state.newPost2 = r2.body?.id;
      c.check('Bài 2 → PENDING', r2.body?.status === 'PENDING', r2.body);
      const other = await call('GET', `/feed/${state.newPost1}`, 'returning');
      c.check('Người khác GET /feed/:id bài chờ duyệt → 404', other.status === 404, other.status);
      const rows = await ledgerRows('uat_new', 'COMMUNITY_POST:%');
      c.check('SQL: uat_new chưa có dòng COMMUNITY_POST', rows.length === 0, rows);
      c.actual(`Hai bài ${state.newPost1}, ${state.newPost2} PENDING; người khác xem → ${other.status}; chưa có thưởng.`);
      c.ev(relShot('U4-22-pending-notice'));
      c.ev(`GET /feed/${state.newPost1} (uat_returning) → ${other.status}`);
    },
  ),
);

// ---------- U4-23: CSKH duyệt trên web
cases.push(
  await runCase(
    new Case('U4-23', {
      role: 'KIỂM DUYỆT (uat_cskh, STAFF CSKH) → KHÁCH (uat_new)',
      journey: 'CSKH duyệt bài trên web admin',
      steps: 'Web 1440 /admin?tab=community → "Chờ duyệt" → dòng bài của uat_new → "Duyệt"',
      expected: 'Bài PUBLISHED; tác giả được đánh dấu tin cậy; thưởng 1.000 Điểm Xanh (COMMUNITY_POST:<id>), số dư = SUM; khách nhận tin COMMUNITY_POST_APPROVED',
    }),
    async (c) => {
      const before = await ledger('uat_new');
      const s = await openWeb(L.n, 'cskh', { width: 1440, path: '/admin?tab=community', headless });
      try {
        const p = s.page;
        const row = p.locator(`li[data-post="${state.newPost1}"]`);
        await row.waitFor({ timeout: 60_000 });
        await p.screenshot({ path: shot('U4-23-web-pending') });
        const resp = p.waitForResponse((r) => r.url().endsWith(`/api/feed/admin/${state.newPost1}/approve`), { timeout: 20_000 });
        await row.getByRole('button', { name: 'Duyệt' }).click();
        const r = await resp;
        c.check('POST /feed/admin/:id/approve (CSKH) → 2xx', r.status() < 300, r.status());
        await row.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
        c.check('Dòng biến khỏi "Chờ duyệt"', (await row.count()) === 0);
      } finally {
        await s.close();
      }
      const post = await postRow(state.newPost1);
      const [prof] = await q(`SELECT "isTrusted" FROM community_profiles WHERE "userId" = 'uat_new'`);
      const rows = await ledgerRows('uat_new', `COMMUNITY_POST:${state.newPost1}`);
      const after = await ledger('uat_new');
      const n = await inapp('uat_new', 'COMMUNITY_POST_APPROVED');
      c.check('DB bài PUBLISHED', post?.status === 'PUBLISHED', post?.status);
      c.check('DB community_profiles.isTrusted = true', prof?.isTrusted === true, prof);
      c.check('SQL: 1 dòng COMMUNITY_POST:<id> +1.000', rows.length === 1 && rows[0].delta === 1000, rows);
      c.check('SQL: số dư = trước + 1.000 = SUM(delta)', after.balance === before.balance + 1000 && after.balance === after.ledgerSum, { before, after });
      c.check('notification_logs INAPP COMMUNITY_POST_APPROVED', n.length >= 1, n.map((x) => x.body));
      c.actual(`Bài ${post?.status}, isTrusted ${prof?.isTrusted}; sổ uat_new ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}); tin "${n.at(-1)?.body}".`);
      c.ev(relShot('U4-23-web-pending'));
      c.ev(`SQL COMMUNITY_POST:${state.newPost1} → ${short(rows.map((x) => x.delta))}; pointsBalance ${before.balance} → ${after.balance}, SUM ${after.ledgerSum}`);
    },
  ),
);

async function webDialogAction(p, row, buttonName, confirmLabel, reason, urlSuffix) {
  await row.getByRole('button', { name: buttonName, exact: true }).click();
  const dlg = p.getByRole('alertdialog');
  await dlg.waitFor({ timeout: 10_000 });
  await dlg.getByRole('textbox').fill(reason);
  const resp = p.waitForResponse((r) => r.url().endsWith(urlSuffix), { timeout: 20_000 });
  await dlg.getByRole('button', { name: confirmLabel, exact: true }).click();
  return (await resp).status();
}

// ---------- U4-24: CSKH từ chối bài chờ duyệt, ẩn bài đã đăng
cases.push(
  await runCase(
    new Case('U4-24', {
      role: 'KIỂM DUYỆT (uat_cskh) → KHÁCH (uat_returning, uat_new)',
      journey: 'CSKH từ chối và gỡ bài trên web admin',
      steps: '"Chờ duyệt" → bài có "casino" → "Từ chối" → gõ lý do → "Từ chối"; bài 2 của uat_new → "Từ chối"; "Đã đăng" → bài 2 của uat_returning → "Ẩn" → gõ lý do → "Ẩn bài"',
      expected: 'Bài bị từ chối/ẩn thành REMOVED, khỏi bảng tin; tác giả nhận COMMUNITY_POST_REJECTED / COMMUNITY_POST_HIDDEN có lý do; không đảo điểm đã thưởng (sổ vẫn = SUM)',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const s = await openWeb(L.n, 'cskh', { width: 1440, path: '/admin?tab=community', headless });
      try {
        const p = s.page;
        const flagged = p.locator(`li[data-post="${state.postFlagged}"]`);
        await flagged.waitFor({ timeout: 60_000 });
        const st1 = await webDialogAction(p, flagged, 'Từ chối', 'Từ chối', 'Nội dung cờ bạc, không hợp cộng đồng', `/api/feed/admin/${state.postFlagged}/reject`);
        c.check('Từ chối bài từ cấm → 2xx', st1 < 300, st1);
        const n2 = p.locator(`li[data-post="${state.newPost2}"]`);
        await n2.waitFor({ timeout: 15_000 });
        const st2 = await webDialogAction(p, n2, 'Từ chối', 'Từ chối', 'Bài thử, không có nội dung', `/api/feed/admin/${state.newPost2}/reject`);
        c.check('Từ chối bài 2 của uat_new → 2xx', st2 < 300, st2);
        await p.getByRole('button', { name: 'Đã đăng', exact: true }).click();
        const pub = p.locator(`li[data-post="${state.post2}"]`);
        await pub.waitFor({ timeout: 20_000 });
        await p.screenshot({ path: shot('U4-24-web-published') });
        const st3 = await webDialogAction(p, pub, 'Ẩn', 'Ẩn bài', 'Trùng nội dung', `/api/feed/admin/${state.post2}/hide`);
        c.check('Ẩn bài 2 của uat_returning → 2xx', st3 < 300, st3);
      } finally {
        await s.close();
      }
      const [a, b, d] = await Promise.all([postRow(state.postFlagged), postRow(state.newPost2), postRow(state.post2)]);
      c.check('DB ba bài REMOVED', a?.status === 'REMOVED' && b?.status === 'REMOVED' && d?.status === 'REMOVED', [a?.status, b?.status, d?.status]);
      const rej = await inapp('uat_returning', 'COMMUNITY_POST_REJECTED');
      const hid = await inapp('uat_returning', 'COMMUNITY_POST_HIDDEN');
      const rejNew = await inapp('uat_new', 'COMMUNITY_POST_REJECTED');
      c.check('Tin COMMUNITY_POST_REJECTED kèm lý do "cờ bạc"', rej.some((x) => /cờ bạc/.test(x.body ?? '')), rej.map((x) => x.body));
      c.check('Tin COMMUNITY_POST_HIDDEN kèm lý do "Trùng nội dung"', hid.some((x) => /Trùng nội dung/.test(x.body ?? '')), hid.map((x) => x.body));
      c.check('uat_new nhận COMMUNITY_POST_REJECTED', rejNew.length >= 1, rejNew.map((x) => x.body));
      const feed = await call('GET', '/feed', 'new');
      const ids = (feed.body?.posts ?? []).map((x) => x.id);
      c.check('GET /feed không còn ba bài đã gỡ', ![state.postFlagged, state.newPost2, state.post2].some((id) => ids.includes(id)), ids);
      const after = await ledger('uat_returning');
      c.check('SQL: số dư uat_returning không đổi = SUM(delta)', after.balance === before.balance && after.balance === after.ledgerSum, { before, after });
      c.actual(`Ba bài REMOVED; tin từ chối "${rej.at(-1)?.body}"; tin ẩn "${hid.at(-1)?.body}"; sổ ${before.balance} → ${after.balance}.`);
      c.ev(relShot('U4-24-web-published'));
      c.ev(`SQL feed_posts.status: ${a?.status}, ${b?.status}, ${d?.status}`);
    },
  ),
);

// ---------- U4-25: thích + bình luận trên Mini App, báo tác giả
cases.push(
  await runCase(
    new Case('U4-25', {
      role: 'KHÁCH (uat_new) → KHÁCH tác giả (uat_returning)',
      journey: 'Thích và bình luận bài của người khác',
      steps: 'uat_new mở /feed/<bài U4-20> → bấm tim → gõ "Viết trả lời…" → "Gửi"; uat_returning tự thích bài mình qua API',
      expected: 'Tim chuyển aria-pressed=true, đếm +1; bình luận hiện; DB 1 reaction + 1 comment; tác giả nhận COMMUNITY_POST_LIKED và COMMUNITY_POST_COMMENTED; tự thích bài mình không sinh tin',
    }),
    async (c) => {
      const likedBefore = (await inapp('uat_returning', 'COMMUNITY_POST_LIKED')).length;
      const s = await open(L.n, 'new', { headless, path: `/feed/${state.post1}` });
      try {
        const p = s.page;
        const like = p.locator('button[aria-pressed]').filter({ has: p.locator('svg') }).first();
        await like.waitFor({ timeout: 30_000 });
        const resp = p.waitForResponse((r) => r.url().endsWith(`/api/feed/${state.post1}/react`), { timeout: 15_000 });
        await like.click();
        c.check('POST /feed/:id/react → 2xx', (await resp).status() < 300);
        await p.waitForFunction(() => document.querySelector('button[aria-pressed="true"]'), null, { timeout: 10_000 }).catch(() => undefined);
        c.check('Nút tim aria-pressed=true', (await p.locator('button[aria-pressed="true"]').count()) >= 1);
        const box = p.getByRole('textbox', { name: 'Viết trả lời…' });
        await box.fill('Hay quá, mình cũng gom vỏ hộp mang đi đổi.');
        const cr = p.waitForResponse((r) => r.url().endsWith(`/api/feed/${state.post1}/comments`) && r.request().method() === 'POST', { timeout: 15_000 });
        await p.getByRole('button', { name: 'Gửi', exact: true }).click();
        c.check('POST /feed/:id/comments → 2xx', (await cr).status() < 300);
        await p.getByText('Hay quá, mình cũng gom vỏ hộp mang đi đổi.').first().waitFor({ timeout: 10_000 });
        await p.screenshot({ path: shot('U4-25-like-comment') });
      } finally {
        await s.close();
      }
      await call('POST', `/feed/${state.post1}/react`, 'returning');
      await sleep(500);
      const row = await postRow(state.post1);
      c.check('DB: 2 tim (uat_new + chủ bài), 1 bình luận', row?.likes === 2 && row?.comments === 1, row);
      const liked = await inapp('uat_returning', 'COMMUNITY_POST_LIKED');
      const commented = await inapp('uat_returning', 'COMMUNITY_POST_COMMENTED');
      c.check('Tác giả nhận đúng 1 COMMUNITY_POST_LIKED (tự thích không sinh tin)', liked.length === likedBefore + 1, liked.map((x) => x.body));
      c.check('Tác giả nhận COMMUNITY_POST_COMMENTED', commented.length >= 1, commented.map((x) => x.body));
      c.actual(`Bài U4-20: ${row?.likes} tim, ${row?.comments} bình luận; tin thích "${liked.at(-1)?.body}"; tin bình luận "${commented.at(-1)?.body}".`);
      c.ev(relShot('U4-25-like-comment'));
      c.ev(`SQL notification_logs INAPP: LIKED ${liked.length}, COMMENTED ${commented.length}`);
    },
  ),
);

// ---------- U4-26: ghim bài, chỉ ADMIN
cases.push(
  await runCase(
    new Case('U4-26', {
      role: 'KIỂM DUYỆT (uat_cskh), ADMIN (uat_admin)',
      journey: 'Ghim bài cộng đồng',
      steps: 'CSKH: web /admin?tab=community → "Đã đăng" → bài U4-20 (không còn nút "Ghim"); CSKH gọi thẳng POST /feed/admin/:id/pin; ADMIN: POST /feed/admin/:id/pin {pinned:true}',
      expected: 'Theo B8 chỉ ADMIN được ghim (bản sửa D2-02): web CSKH không hiện nút "Ghim"/"Bỏ ghim"; CSKH gọi API → 403, bài không ghim; ADMIN ghim → 2xx, isPinned = true',
    }),
    async (c) => {
      const s = await openWeb(L.n, 'cskh', { width: 1440, path: '/admin?tab=community', headless });
      let pinButtons = -1;
      try {
        const p = s.page;
        await p.getByRole('button', { name: 'Đã đăng', exact: true }).click();
        const row = p.locator(`li[data-post="${state.post1}"]`);
        await row.waitFor({ timeout: 60_000 });
        await p.waitForTimeout(1000);
        pinButtons = await row.getByRole('button', { name: /^(Bỏ )?[Gg]him$/ }).count();
        await p.screenshot({ path: shot('U4-26-cskh-pin') });
      } finally {
        await s.close();
      }
      const rc = await call('POST', `/feed/admin/${state.post1}/pin`, 'cskh', { pinned: true });
      const cskhStatus = rc.status;
      const afterCskh = await postRow(state.post1);
      c.check('Web CSKH: bài đã đăng không có nút Ghim/Bỏ ghim', pinButtons === 0, pinButtons);
      c.check('CSKH gọi API ghim → 403', cskhStatus === 403, cskhStatus);
      c.check('Sau lượt CSKH bài chưa ghim', afterCskh?.isPinned === false, afterCskh?.isPinned);
      if (afterCskh?.isPinned) await call('POST', `/feed/admin/${state.post1}/pin`, 'admin', { pinned: false });
      const ra = await call('POST', `/feed/admin/${state.post1}/pin`, 'admin', { pinned: true });
      const afterAdmin = await postRow(state.post1);
      c.check('ADMIN ghim → 2xx, isPinned = true', ra.status < 300 && afterAdmin?.isPinned === true, { status: ra.status, isPinned: afterAdmin?.isPinned });
      c.actual(`Web CSKH: ${pinButtons} nút Ghim/Bỏ ghim trên bài; CSKH gọi API ghim → ${cskhStatus}, isPinned sau lượt CSKH = ${afterCskh?.isPinned}; ADMIN ghim → ${ra.status}, isPinned = ${afterAdmin?.isPinned}.`);
      c.ev(relShot('U4-26-cskh-pin'));
      c.ev(`web CSKH: ${pinButtons} nút Ghim; POST /api/feed/admin/${state.post1}/pin (token uat_cskh) → ${cskhStatus}; SQL feed_posts.isPinned = ${afterCskh?.isPinned}`);
    },
  ),
);

// ---------- U4-27: xem trước khi chưa đăng nhập
cases.push(
  await runCase(
    new Case('U4-27', {
      role: 'KHÁCH chưa đăng nhập',
      journey: 'Xem trước cộng đồng (community.public_preview, B14)',
      steps: 'GET /feed/public-preview không token; web 390 không cookie mở /cong-dong',
      expected: 'Cờ bật: 200, chỉ bài đã đăng (không có bài chờ duyệt/đã gỡ), bài ghim lên đầu; chỉ trường công khai (không id người dùng, SĐT, ảnh đại diện); tác giả chỉ tên gọi; SĐT trong nội dung bị che; web hiện thẻ xem trước + nút "Đăng nhập với Zalo"',
    }),
    async (c) => {
      let r;
      for (let i = 0; i < 16; i++) {
        r = await call('GET', '/feed/public-preview', null);
        // API đặt cache công khai cho nội dung người dùng: chờ tới khi thấy bài ghim và bài đã gỡ biến mất (tối đa ~80 giây).
        const got = r.body?.posts ?? [];
        if (got[0]?.id === state.post1 && got[0]?.isPinned && ![state.postFlagged, state.newPost2, state.post2].some((id) => got.some((x) => x.id === id))) break;
        await sleep(5000);
      }
      const posts = r.body?.posts ?? [];
      const ids = posts.map((x) => x.id);
      c.check('GET /feed/public-preview → 200, có bài U4-20 (đã ghim) đứng đầu', r.status === 200 && posts[0]?.id === state.post1 && posts[0]?.isPinned === true, { status: r.status, ids });
      c.check('Không có bài chờ duyệt/đã gỡ', ![state.postFlagged, state.newPost2, state.post2].some((id) => ids.includes(id)), ids);
      const keys = [...new Set(posts.flatMap((x) => Object.keys(x)))].sort();
      const flat = JSON.stringify(r.body);
      c.check('Chỉ trường công khai: không userId/phone/avatar/email', !keys.some((k) => /user|phone|avatar|email|zalo/i.test(k)), keys);
      const p1 = posts.find((x) => x.id === state.post1);
      c.check('Tác giả chỉ tên gọi "Lại"', p1?.author === 'Lại', p1?.author);
      c.check('SĐT trong nội dung bị che (không còn 0901 234 567)', !/0901 ?234 ?567/.test(flat) && /…/.test(p1?.snippet ?? ''), p1?.snippet);
      // Mini App luôn có phiên (đăng nhập Zalo im lặng, hoặc tài khoản khách theo deviceId khi Zalo chưa sẵn), nên khách chưa
      // đăng nhập thật chỉ có ở web: /cong-dong không cookie.
      let cardText = '';
      const w = await openWeb(L.n, 'guest', { width: 390, path: '/cong-dong', headless });
      try {
        const pg = w.page;
        const cards = pg.getByTestId('preview-card');
        await cards.first().waitFor({ timeout: 60_000 });
        cardText = (await cards.first().innerText()).replace(/\s+/g, ' ');
        c.check('Web chưa đăng nhập /cong-dong: thẻ xem trước đầu là bài ghim, tác giả "Lại", SĐT bị che', /Gom vỏ hộp với túi nilon/.test(cardText) && /\bLại\b/.test(cardText) && !cardText.includes('Nguyễn Thị') && !/0901 ?234 ?567/.test(cardText), short(cardText, 240));
        c.check('Có lời mời "Đăng nhập với Zalo"', await pg.getByText('Đăng nhập với Zalo').first().isVisible());
        await pg.screenshot({ path: shot('U4-27-guest-preview') });
      } finally {
        await w.close();
      }
      c.actual(`200, ${posts.length} bài, đầu là bài ghim ${posts[0]?.id}; trường ${keys.join(',')}; tác giả "${p1?.author}"; đoạn "${short(p1?.snippet, 160)}". Thẻ web đầu: "${short(cardText, 160)}".`);
      c.ev(relShot('U4-27-guest-preview'));
      c.ev(`GET /api/feed/public-preview (không token) → ${r.status} ${short(posts[0], 360)}`);
    },
  ),
);

// ---------- U4-28: sự kiện, ADMIN chọn người thắng trên Mini App
cases.push(
  await runCase(
    new Case('U4-28', {
      role: 'ADMIN (uat_admin), KIỂM DUYỆT (uat_cskh), KHÁCH (uat_returning)',
      journey: 'Sự kiện cộng đồng: dự thi, chọn người thắng, trả quà Điểm Xanh',
      steps: 'ADMIN tạo sự kiện thưởng 30.000; CSKH thử tạo sự kiện; khách nộp bài dự thi; CSKH thử chọn người thắng; ADMIN Mini App /admin/community → "Sự kiện" → "Chọn người thắng" → chọn khách → "Chốt … là người thắng"; ADMIN gọi chọn lần hai',
      expected: 'CSKH tạo sự kiện / chọn người thắng → 403; ADMIN chốt → sổ COMMUNITY_EVENT_WIN:<event>:<user> +30.000, số dư = trước + 30.000 = SUM; tin COMMUNITY_EVENT_WINNER "30.000"; chọn lần hai → 400, không trả đôi',
    }),
    async (c) => {
      const now = Date.now();
      const evBody = { title: 'UAT Khoe góc tái chế tháng 10', description: 'Chụp góc gom rác tái chế ở nhà', startAt: new Date(now - 3600_000).toISOString(), endAt: new Date(now + 7 * 86_400_000).toISOString(), rewardPoints: 30000 };
      const cskhCreate = await call('POST', '/feed/events', 'cskh', evBody);
      c.check('CSKH POST /feed/events → 403', cskhCreate.status === 403, cskhCreate.status);
      const ev = await call('POST', '/feed/events', 'admin', evBody);
      c.check('ADMIN POST /feed/events → 201', ev.status === 201 && ev.body?.id, short(ev.body));
      state.eventId = ev.body?.id;
      const entry = await call('POST', '/feed', 'returning', { kind: 'SHOWCASE', body: 'Góc gom vỏ hộp và nilon nhà mình, tuần nào cũng mang đi đổi.', eventId: state.eventId });
      c.check('Khách nộp bài dự thi → 201 PUBLISHED', entry.status === 201 && entry.body?.status === 'PUBLISHED', entry.body);
      state.eventPost = entry.body?.id;
      const cskhWin = await call('POST', `/feed/events/${state.eventId}/winner`, 'cskh', { userId: 'uat_returning' });
      c.check('CSKH chọn người thắng → 403', cskhWin.status === 403, cskhWin.status);
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'admin', { headless, path: '/admin/community' });
      try {
        const p = s.page;
        await p.getByText('Sự kiện', { exact: true }).first().click({ timeout: 30_000 });
        await p.getByText(evBody.title).first().waitFor({ timeout: 20_000 });
        await p.getByRole('button', { name: 'Chọn người thắng' }).first().click();
        await p.getByRole('radio', { name: /Nguyễn Thị Quay Lại/ }).click({ timeout: 15_000 });
        await p.screenshot({ path: shot('U4-28-admin-pick-winner') });
        const resp = p.waitForResponse((r) => r.url().endsWith(`/api/feed/events/${state.eventId}/winner`), { timeout: 15_000 });
        await p.getByRole('button', { name: 'Chốt Nguyễn Thị Quay Lại là người thắng' }).click();
        c.check('POST winner (ADMIN, Mini App) → 2xx', (await resp).status() < 300);
        await p.getByText('Đã chọn người thắng').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      } finally {
        await s.close();
      }
      const reason = `COMMUNITY_EVENT_WIN:${state.eventId}:uat_returning`;
      const rows = await ledgerRows('uat_returning', reason);
      const after = await ledger('uat_returning');
      c.check('SQL: 1 dòng COMMUNITY_EVENT_WIN +30.000', rows.length === 1 && rows[0].delta === 30000, rows);
      c.check('SQL: số dư = trước + 30.000 = SUM(delta)', after.balance === before.balance + 30000 && after.balance === after.ledgerSum, { before, after });
      const n = await inapp('uat_returning', 'COMMUNITY_EVENT_WINNER');
      c.check('Tin COMMUNITY_EVENT_WINNER có "30.000"', n.some((x) => /30\.000/.test(x.body ?? '')), n.map((x) => x.body));
      const again = await call('POST', `/feed/events/${state.eventId}/winner`, 'admin', { userId: 'uat_new' });
      const rowsNew = await ledgerRows('uat_new', `COMMUNITY_EVENT_WIN:${state.eventId}:%`);
      c.check('Chọn lần hai → 400, uat_new không được trả', again.status === 400 && rowsNew.length === 0, { status: again.status, rowsNew });
      const [evRow] = await q(`SELECT status::text, "winnerUserId" FROM community_events WHERE id = $1`, state.eventId);
      c.check('DB sự kiện CLOSED, winnerUserId = uat_returning', evRow?.status === 'CLOSED' && evRow?.winnerUserId === 'uat_returning', evRow);
      c.actual(`CSKH tạo/chọn → ${cskhCreate.status}/${cskhWin.status}; ADMIN chốt; sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}); tin "${n.at(-1)?.body}"; chọn lần hai → ${again.status}.`);
      c.ev(relShot('U4-28-admin-pick-winner'));
      c.ev(`SQL ${reason} → ${short(rows.map((x) => ({ delta: x.delta, expiresAt: x.expiresAt })))}; pointsBalance ${before.balance} → ${after.balance}, SUM ${after.ledgerSum}`);
    },
  ),
);

// ---------- U4-29: khoảng quà sự kiện 20.000–50.000 (quyết định C)
cases.push(
  await runCase(
    new Case('U4-29', {
      role: 'ADMIN (uat_admin)',
      journey: 'Mức quà sự kiện cộng đồng',
      steps: 'POST /feed/events với rewardPoints 30.000 / 5.000 / 1.000.000; đóng các sự kiện thử',
      expected: 'Quyết định C: quà sự kiện 20.000–50.000 điểm. 30.000 nhận; 5.000 và 1.000.000 nằm ngoài khoảng đã chốt nên bị chặn (hoặc ít nhất cảnh báo admin)',
    }),
    async (c) => {
      const now = Date.now();
      const mk = (rewardPoints) => ({ title: `UAT quà ${rewardPoints}`, startAt: new Date(now - 60_000).toISOString(), endAt: new Date(now + 86_400_000).toISOString(), rewardPoints });
      const ok = await call('POST', '/feed/events', 'admin', mk(30000));
      const low = await call('POST', '/feed/events', 'admin', mk(5000));
      const high = await call('POST', '/feed/events', 'admin', mk(1_000_000));
      c.check('30.000 → 201', ok.status === 201, ok.status);
      c.check('5.000 (dưới 20.000) bị chặn 4xx', low.status >= 400 && low.status < 500, { status: low.status, body: short(low.body, 160) });
      c.check('1.000.000 (trên 50.000) bị chặn 4xx', high.status >= 400 && high.status < 500, { status: high.status, body: short(high.body, 160) });
      // Người thắng không dự thi: chưa có luật chốt, chỉ ghi lại hành vi để chủ quyết.
      let probe = null;
      if (ok.body?.id) {
        const r = await call('POST', `/feed/events/${ok.body.id}/winner`, 'admin', { userId: 'uat_marketing' });
        const rows = await ledgerRows('uat_marketing', `COMMUNITY_EVENT_WIN:${ok.body.id}:%`);
        probe = { status: r.status, paid: rows.map((x) => x.delta) };
      }
      for (const e of [low, high]) if (e.body?.id) await call('POST', `/feed/events/${e.body.id}/close`, 'admin');
      c.actual(`30.000 → ${ok.status}; 5.000 → ${low.status}; 1.000.000 → ${high.status}. Ghi thêm: chọn uat_marketing (không dự thi) làm người thắng sự kiện 30.000 → ${probe?.status}, trả ${JSON.stringify(probe?.paid)}.`);
      c.ev(`POST /feed/events rewardPoints 5000 → ${low.status} ${short(low.body, 120)}; 1000000 → ${high.status} ${short(high.body, 120)}`);
      c.ev(`POST /feed/events/:id/winner userId=uat_marketing (không có bài dự thi) → ${probe?.status}; SQL COMMUNITY_EVENT_WIN uat_marketing → ${JSON.stringify(probe?.paid)}`);
      state.rangeProbe = probe;
    },
  ),
);

// ---------- U4-30: bảng xếp hạng không lộ dữ liệu cá nhân
cases.push(
  await runCase(
    new Case('U4-30', {
      role: 'KHÁCH (uat_new), KHÁCH chưa đăng nhập',
      journey: 'Bảng xếp hạng cộng đồng và Vườn Xanh',
      steps: 'Mini App /feed/leaderboard (uat_new); GET /feed/leaderboard; GET /game/leaderboard không token',
      expected: 'Không lộ SĐT, email, id người dùng, zaloId; BXH Vườn Xanh công khai che tên (maskName); BXH cộng đồng cần đăng nhập',
    }),
    async (c) => {
      const anon = await call('GET', '/feed/leaderboard', null);
      c.check('GET /feed/leaderboard không token → 401', anon.status === 401, anon.status);
      const lb = await call('GET', '/feed/leaderboard', 'new');
      const rows = Array.isArray(lb.body) ? lb.body : [];
      const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))].sort();
      const flat = JSON.stringify(lb.body);
      c.check('BXH cộng đồng 200, có hàng', lb.status === 200 && rows.length > 0, { status: lb.status, n: rows.length });
      c.check('BXH cộng đồng không có trường id/SĐT/email/zalo', !keys.some((k) => /id|phone|email|zalo/i.test(k)), keys);
      c.check('BXH cộng đồng không chứa chuỗi SĐT 0901…', !/09\d{8}/.test(flat), short(flat, 200));
      const gl = await call('GET', '/game/leaderboard', null);
      const gflat = JSON.stringify(gl.body);
      c.check('BXH Vườn Xanh công khai 200, không chứa họ tên đầy đủ "Nguyễn Thị Quay Lại"', gl.status === 200 && !gflat.includes('Nguyễn Thị Quay Lại') && !/09\d{8}/.test(gflat), short(gl.body, 200));
      const s = await open(L.n, 'new', { headless, path: '/feed/leaderboard' });
      try {
        await s.page.getByText(rows[0]?.author ?? 'Bạn Tubu').first().waitFor({ timeout: 30_000 });
        await s.page.screenshot({ path: shot('U4-30-feed-leaderboard') });
      } finally {
        await s.close();
      }
      c.actual(`/feed/leaderboard trường ${keys.join(',')}, tên hiện đủ họ tên: ${rows.map((x) => x.author).join(', ')}; /game/leaderboard ${short(gl.body, 160)}.`);
      c.ev(relShot('U4-30-feed-leaderboard'));
      c.ev(`GET /feed/leaderboard → ${short(rows.slice(0, 3), 300)}`);
      c.ev(`GET /game/leaderboard (không token) → ${short(gl.body, 200)}`);
    },
  ),
);

fs.writeFileSync(path.join(RESULTS, 'community-state.json'), JSON.stringify(state, null, 2));
saveResults('30-community', cases);
await closePrisma();
log('xong', state);
