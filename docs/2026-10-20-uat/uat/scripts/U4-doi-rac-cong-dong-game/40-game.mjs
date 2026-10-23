#!/usr/bin/env node
// U4-31..U4-38: Vườn Xanh và Điểm Xanh trên Mini App thật: điểm danh nhận Điểm Xanh (×1.000), điểm danh giọt nước, nhiệm vụ,
// vòng quay (phí 10.000, trần 5 lượt/ngày), đổi quà bằng điểm, thiếu điểm, gợi ý "Vườn Xanh" lần đầu.
// Mỗi lần cộng/trừ đều đối chiếu users.pointsBalance với SUM(points_transactions.delta).
// Chạy sau 30-community.mjs (số dư uat_returning, uat_new đã có điểm). Dùng: node 40-game.mjs [lane] [--headed]
import { randomUUID } from 'node:crypto';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { Case, L, call, closePrisma, ledger, ledgerRows, log, q, relShot, runCase, saveResults, shot, short, sleep, headless } from './u4-lib.mjs';

const cases = [];
const monthsAhead = (d) => (new Date(d).getTime() - Date.now()) / (30.44 * 86_400_000);
const profileOf = async (userId) =>
  (await q(`SELECT "totalSeeds"::int AS seeds, "streakDays"::int AS streak, "lastCheckInAt" FROM game_profiles WHERE "userId" = $1`, userId))[0] ?? null;
const spinsToday = async (userId) =>
  (await q(`SELECT count(*)::int AS n FROM game_spins WHERE "userId" = $1 AND "spunAt" >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`, userId))[0].n;

// ---------- U4-31: điểm danh nhận Điểm Xanh
cases.push(
  await runCase(
    new Case('U4-31', {
      role: 'KHÁCH (uat_new)',
      journey: 'Điểm danh mỗi ngày nhận Điểm Xanh',
      steps: '/loyalty → thẻ "Điểm danh nhận Điểm Xanh" → bấm "Điểm danh +…"; gọi POST /me/loyalty/check-in lần hai',
      expected: 'Ngày 1 được 1.000 điểm (bảng 1.000×6, 2.000 ngày 7): sổ DAILY_CHECKIN:DAY_1 +1.000 refType CHECKIN hạn 12 tháng; số dư = trước + 1.000 = SUM; nút thành "Đã điểm danh"; lần hai → 400, không cộng',
    }),
    async (c) => {
      const before = await ledger('uat_new');
      let label = '';
      const s = await open(L.n, 'new', { headless, path: '/loyalty' });
      try {
        const p = s.page;
        const btn = p.getByRole('button', { name: /^Điểm danh/ }).first();
        await btn.waitFor({ timeout: 30_000 });
        label = (await btn.innerText()).trim();
        await p.screenshot({ path: shot('U4-31-loyalty-before') });
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/me/loyalty/check-in') && r.request().method() === 'POST', { timeout: 15_000 });
        await btn.click();
        const r = await resp;
        c.check('POST /me/loyalty/check-in → 2xx', r.status() < 300, r.status());
        const done = p.getByRole('button', { name: 'Đã điểm danh' }).first();
        await done.waitFor({ timeout: 10_000 });
        c.check('Nút thành "Đã điểm danh" và bị khoá', await done.isDisabled());
        await p.screenshot({ path: shot('U4-31-loyalty-after') });
      } finally {
        await s.close();
      }
      const rows = await ledgerRows('uat_new', 'DAILY_CHECKIN:%');
      const mid = await ledger('uat_new');
      c.check('SQL: 1 dòng DAILY_CHECKIN:DAY_1 +1.000 refType CHECKIN', rows.length === 1 && rows[0].reason === 'DAILY_CHECKIN:DAY_1' && rows[0].delta === 1000 && rows[0].refType === 'CHECKIN', rows);
      c.check('SQL: hạn ≈ 12 tháng', rows[0] && monthsAhead(rows[0].expiresAt) > 11.5 && monthsAhead(rows[0].expiresAt) < 12.5, rows[0]?.expiresAt);
      c.check('SQL: số dư = trước + 1.000 = SUM(delta)', mid.balance === before.balance + 1000 && mid.balance === mid.ledgerSum, { before, mid });
      const again = await call('POST', '/me/loyalty/check-in', 'new');
      const after = await ledger('uat_new');
      c.check('Lần hai → 400 "Hôm nay bạn đã điểm danh nhận điểm rồi"', again.status === 400 && /đã điểm danh nhận điểm rồi/.test(again.body?.message ?? ''), again.body);
      c.check('SQL: lần hai không cộng, số dư = SUM', after.balance === mid.balance && after.balance === after.ledgerSum, { mid, after });
      c.actual(`Nhãn nút "${label}"; +${rows[0]?.delta} (${rows[0]?.reason}); sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}); lần hai → ${again.status} "${again.body?.message}".`);
      c.ev(relShot('U4-31-loyalty-before'));
      c.ev(relShot('U4-31-loyalty-after'));
      c.ev(`SQL DAILY_CHECKIN → ${short(rows.map((x) => ({ reason: x.reason, delta: x.delta, refType: x.refType, expiresAt: x.expiresAt })))}`);
    },
  ),
);

// ---------- U4-32: điểm danh giọt nước Vườn Xanh
cases.push(
  await runCase(
    new Case('U4-32', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Điểm danh Vườn Xanh nhận giọt nước',
      steps: '/game tab "Hôm nay" → thẻ "Điểm danh chuỗi … ngày" → "Điểm danh"; gọi POST /game/check-in lần hai',
      expected: 'Chuỗi mới: +10 giọt (game.daily_login_seeds), streakDays = 1; KHÔNG đổi Điểm Xanh (sổ không thêm dòng); nút thành "Đã điểm danh"; lần hai → 400',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const pBefore = await profileOf('uat_returning');
      const s = await open(L.n, 'returning', { headless, path: '/game' });
      try {
        const p = s.page;
        const btn = p.getByRole('button', { name: 'Điểm danh', exact: true });
        await btn.waitFor({ timeout: 30_000 });
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/game/check-in'), { timeout: 15_000 });
        await btn.click();
        c.check('POST /game/check-in → 2xx', (await resp).status() < 300);
        const done = p.getByRole('button', { name: 'Đã điểm danh' }).first();
        await done.waitFor({ timeout: 10_000 });
        c.check('Nút thành "Đã điểm danh" và bị khoá', await done.isDisabled());
        await p.screenshot({ path: shot('U4-32-game-checkin') });
      } finally {
        await s.close();
      }
      const pAfter = await profileOf('uat_returning');
      const after = await ledger('uat_returning');
      const expectSeeds = Math.min(500, (pBefore?.seeds ?? 0) + 10);
      c.check('game_profiles: +10 giọt, streakDays 1', pAfter?.seeds === expectSeeds && pAfter?.streak === 1, { pBefore, pAfter });
      c.check('SQL: Điểm Xanh không đổi, số dư = SUM', after.balance === before.balance && after.rows === before.rows && after.balance === after.ledgerSum, { before, after });
      const again = await call('POST', '/game/check-in', 'returning');
      c.check('Lần hai → 400 "Hôm nay bạn đã điểm danh rồi"', again.status === 400 && /đã điểm danh rồi/.test(again.body?.message ?? ''), again.body);
      c.actual(`Giọt ${pBefore?.seeds} → ${pAfter?.seeds}, chuỗi ${pAfter?.streak}; Điểm Xanh ${before.balance} → ${after.balance}; lần hai → ${again.status}.`);
      c.ev(relShot('U4-32-game-checkin'));
      c.ev(`SQL game_profiles ${JSON.stringify(pBefore)} → ${JSON.stringify(pAfter)}`);
    },
  ),
);

// ---------- U4-33: nhiệm vụ "Đơn hàng đầu tiên"
cases.push(
  await runCase(
    new Case('U4-33', {
      role: 'KHÁCH đã có đơn giao (uat_returning), KHÁCH mới (uat_new)',
      journey: 'Nhận thưởng nhiệm vụ Vườn Xanh',
      steps: '/game → thẻ nhiệm vụ "Đơn hàng đầu tiên" → "Nhận thưởng"; nhận lần hai qua API; uat_new nhận FIRST_ORDER qua API',
      expected: '+20.000 Điểm Xanh (sổ MISSION:FIRST_ORDER:0, hạn 12 tháng), số dư = trước + 20.000 = SUM; lần hai → 400 "đã nhận"; khách chưa có đơn → 400 "Chưa đủ điều kiện"',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'returning', { headless, path: '/game' });
      try {
        const p = s.page;
        await p.getByText('Đơn hàng đầu tiên').first().waitFor({ timeout: 30_000 });
        const btns = p.getByRole('button', { name: 'Nhận thưởng', exact: true });
        let target = null;
        for (let i = 0; i < (await btns.count()); i++) {
          const txt = await btns.nth(i).evaluate((el) => el.parentElement?.innerText ?? '');
          if (txt.includes('Đơn hàng đầu tiên')) target = btns.nth(i);
        }
        c.check('Thẻ "Đơn hàng đầu tiên" có nút "Nhận thưởng"', Boolean(target));
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/game/missions/FIRST_ORDER/claim'), { timeout: 15_000 });
        await target.click();
        c.check('POST /game/missions/FIRST_ORDER/claim → 2xx', (await resp).status() < 300);
        const snack = p.getByText('Đã nhận +20.000 Điểm Xanh! 🌿');
        await snack.waitFor({ timeout: 10_000 }).catch(() => undefined);
        c.check('Snackbar "Đã nhận +20.000 Điểm Xanh! 🌿"', await snack.isVisible().catch(() => false));
        await p.screenshot({ path: shot('U4-33-mission-claimed') });
      } finally {
        await s.close();
      }
      const rows = await ledgerRows('uat_returning', 'MISSION:%');
      const after = await ledger('uat_returning');
      c.check('SQL: 1 dòng MISSION:FIRST_ORDER:0 +20.000', rows.length === 1 && rows[0].reason === 'MISSION:FIRST_ORDER:0' && rows[0].delta === 20000, rows);
      c.check('SQL: hạn ≈ 12 tháng', rows[0] && monthsAhead(rows[0].expiresAt) > 11.5 && monthsAhead(rows[0].expiresAt) < 12.5, rows[0]?.expiresAt);
      c.check('SQL: số dư = trước + 20.000 = SUM(delta)', after.balance === before.balance + 20000 && after.balance === after.ledgerSum, { before, after });
      const again = await call('POST', '/game/missions/FIRST_ORDER/claim', 'returning');
      c.check('Lần hai → 400 "đã nhận"', again.status === 400 && /đã nhận thưởng/.test(again.body?.message ?? ''), again.body);
      const newer = await call('POST', '/game/missions/FIRST_ORDER/claim', 'new');
      c.check('uat_new → 400 "Chưa đủ điều kiện"', newer.status === 400 && /Chưa đủ điều kiện/.test(newer.body?.message ?? ''), newer.body);
      const final = await ledger('uat_returning');
      c.check('SQL: sau hai lần gọi lỗi số dư không đổi', final.balance === after.balance && final.balance === final.ledgerSum, final);
      c.actual(`+${rows[0]?.delta} (${rows[0]?.reason}); sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}); lần hai → ${again.status}; uat_new → ${newer.status}.`);
      c.ev(relShot('U4-33-mission-claimed'));
      c.ev(`SQL MISSION:% → ${short(rows.map((x) => ({ reason: x.reason, delta: x.delta, expiresAt: x.expiresAt })))}`);
    },
  ),
);

function expectedDelta(prize, cost) {
  return -cost + (prize?.rewardType === 'POINTS' ? prize.value : 0);
}

async function checkSpin(c, label, prize, before, after, userId) {
  const d = expectedDelta(prize, 10000);
  c.check(`${label}: số dư đổi ${d} (phí −10.000${prize?.rewardType === 'POINTS' ? ` + giải ${prize.value}` : ''}) = SUM`, after.balance === before.balance + d && after.balance === after.ledgerSum, { prize, before, after });
  if (prize?.rewardType === 'COUPON') {
    const [cp] = await q(`SELECT code, "usageLimit", "perUserLimit", scope::text AS scope, "scopeMeta"->>'userId' AS owner FROM coupons WHERE code = $1`, prize.coupon?.code ?? '');
    c.check(`${label}: mã giảm giá ${prize.coupon?.code} chỉ khách dùng được (USER_GROUP userId), 1 lượt mỗi người`, cp?.scope === "USER_GROUP" && cp?.owner === userId && cp?.perUserLimit === 1, cp);
  }
}

// ---------- U4-34: vòng quay trên Mini App
cases.push(
  await runCase(
    new Case('U4-34', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Vòng quay may mắn bằng Điểm Xanh',
      steps: '/game → "Quay ngay (10.000 Điểm Xanh)"',
      expected: 'Trừ 10.000 (sổ GAME_SPIN_COST −10.000); trúng điểm thì cộng GAME_SPIN_WIN:<giải> có hạn 12 tháng; trúng mã thì mã thuộc khách 1 lượt; số dư = SUM; game_spins +1',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const n0 = await spinsToday('uat_returning');
      let prize = null;
      const s = await open(L.n, 'returning', { headless, path: '/game' });
      try {
        const p = s.page;
        const btn = p.getByRole('button', { name: 'Quay ngay (10.000 Điểm Xanh)' });
        await btn.waitFor({ timeout: 30_000 });
        await btn.scrollIntoViewIfNeeded();
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/game/spin'), { timeout: 15_000 });
        await btn.click();
        const r = await resp;
        prize = (await r.json().catch(() => null))?.prize ?? null;
        c.check('POST /game/spin → 2xx, có giải', r.status() < 300 && prize?.id, { status: r.status(), prize });
        await p.getByRole('button', { name: /Quay ngay/ }).waitFor({ timeout: 15_000 }).catch(() => undefined);
        await p.waitForTimeout(6000);
        await p.screenshot({ path: shot('U4-34-spin-result') });
      } finally {
        await s.close();
      }
      const after = await ledger('uat_returning');
      await checkSpin(c, 'Lượt UI', prize, before, after, 'uat_returning');
      const cost = await q(`SELECT count(*)::int AS n FROM points_transactions WHERE "userId" = 'uat_returning' AND reason = 'GAME_SPIN_COST'`);
      c.check('SQL: 1 dòng GAME_SPIN_COST −10.000', cost[0].n === 1);
      if (prize?.rewardType === 'POINTS') {
        const w = await ledgerRows('uat_returning', `GAME_SPIN_WIN:${prize.id}`);
        c.check('SQL: dòng GAME_SPIN_WIN có hạn ≈ 12 tháng', w.length === 1 && monthsAhead(w[0].expiresAt) > 11.5, w);
      }
      const n1 = await spinsToday('uat_returning');
      c.check('game_spins hôm nay +1', n1 === n0 + 1, { n0, n1 });
      c.actual(`Giải ${prize?.name} (${prize?.rewardType} ${prize?.value}); sổ ${before.balance} → ${after.balance} (SUM ${after.ledgerSum}).`);
      c.ev(relShot('U4-34-spin-result'));
      c.ev(`SQL pointsBalance ${before.balance} → ${after.balance}, SUM ${after.ledgerSum}; game_spins hôm nay ${n0} → ${n1}`);
    },
  ),
);

// ---------- U4-35: trần 5 lượt quay/ngày
cases.push(
  await runCase(
    new Case('U4-35', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Trần lượt quay mỗi ngày',
      steps: 'POST /game/spin thêm tới đủ 5 lượt trong ngày, rồi lượt thứ 6',
      expected: 'game.spin_buy_daily_limit = 5: lượt 2–5 thành công, mỗi lượt số dư = SUM; lượt 6 → 400 "Bạn đã quay đủ 5 lượt hôm nay", không trừ phí (giao dịch huỷ cả)',
    }),
    async (c) => {
      const results = [];
      for (let i = (await spinsToday('uat_returning')) + 1; i <= 5; i++) {
        const b = await ledger('uat_returning');
        const r = await call('POST', '/game/spin', 'returning');
        const a = await ledger('uat_returning');
        results.push({ i, status: r.status, prize: r.body?.prize?.id, type: r.body?.prize?.rewardType, value: r.body?.prize?.value });
        c.check(`Lượt ${i} → 2xx`, r.status < 300, r.body);
        await checkSpin(c, `Lượt ${i}`, r.body?.prize, b, a, 'uat_returning');
      }
      const b6 = await ledger('uat_returning');
      const r6 = await call('POST', '/game/spin', 'returning');
      const a6 = await ledger('uat_returning');
      c.check('Lượt 6 → 400 "Bạn đã quay đủ 5 lượt hôm nay"', r6.status === 400 && /quay đủ 5 lượt/.test(r6.body?.message ?? ''), r6.body);
      c.check('SQL: lượt 6 không trừ phí, số dư = SUM', a6.balance === b6.balance && a6.rows === b6.rows && a6.balance === a6.ledgerSum, { b6, a6 });
      const n = await spinsToday('uat_returning');
      c.check('game_spins hôm nay = 5', n === 5, n);
      c.actual(`Lượt 2–5: ${results.map((x) => `${x.i}:${x.status}/${x.type}${x.value ? ' ' + x.value : ''}`).join(', ')}; lượt 6 → ${r6.status} "${r6.body?.message}"; sổ ${b6.balance} → ${a6.balance}.`);
      c.ev(`SQL users.pointsBalance = SUM(delta) = ${a6.ledgerSum}; game_spins hôm nay = ${n}`);
    },
  ),
);

// ---------- U4-36: đổi quà bằng Điểm Xanh
cases.push(
  await runCase(
    new Case('U4-36', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi quà "Miễn phí vận chuyển" bằng 20.000 Điểm Xanh',
      steps: '/rewards → thẻ "Miễn phí vận chuyển" → "Đổi" → "Xác nhận đổi"; rồi đổi qua API hai lần cùng Idempotency-Key',
      expected: 'Trừ 20.000 (sổ LOYALTY_REDEEM_VOUCHER:reward-freeship), số dư = trước − 20.000 = SUM; mã FREESHIP thuộc khách 1 lượt; waste_gift_redemptions FULFILLED; gọi lại cùng khoá không trừ lần hai',
    }),
    async (c) => {
      const before = await ledger('uat_returning');
      const s = await open(L.n, 'returning', { headless, path: '/rewards' });
      let res = null;
      try {
        const p = s.page;
        const card = p.locator('[data-reward]').filter({ hasText: 'Miễn phí vận chuyển' }).first();
        await card.waitFor({ timeout: 30_000 });
        await card.getByRole('button', { name: 'Đổi', exact: true }).click();
        await p.getByText('Xác nhận đổi quà').first().waitFor({ timeout: 10_000 });
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/me/loyalty/rewards/reward-freeship/redeem'), { timeout: 15_000 });
        await p.getByRole('button', { name: 'Xác nhận đổi' }).click();
        const r = await resp;
        res = await r.json().catch(() => null);
        c.check('POST redeem → 2xx, pointsSpent 20.000', r.status() < 300 && res?.pointsSpent === 20000, { status: r.status(), body: short(res, 200) });
        await p.getByText('Đổi quà thành công').first().waitFor({ timeout: 10_000 });
        c.check('Sheet "Đổi quà thành công"', true);
        await p.screenshot({ path: shot('U4-36-redeem-done') });
      } finally {
        await s.close();
      }
      const mid = await ledger('uat_returning');
      const rows = await ledgerRows('uat_returning', 'LOYALTY_REDEEM_VOUCHER:reward-freeship');
      c.check('SQL: 1 dòng LOYALTY_REDEEM_VOUCHER −20.000 refType REWARD', rows.length === 1 && rows[0].delta === -20000 && rows[0].refType === 'REWARD', rows);
      c.check('SQL: số dư = trước − 20.000 = SUM(delta)', mid.balance === before.balance - 20000 && mid.balance === mid.ledgerSum, { before, mid });
      const [cp] = await q(`SELECT code, type::text, "usageLimit", "perUserLimit", "scopeMeta"->>'userId' AS owner FROM coupons WHERE id = $1`, rows[0]?.refId ?? '');
      c.check('Mã FREESHIP thuộc uat_returning, 1 lượt', cp?.type === 'FREESHIP' && cp?.owner === 'uat_returning' && cp?.usageLimit === 1 && cp?.perUserLimit === 1, cp);
      const [rd] = await q(`SELECT status::text, "pointsCost" FROM waste_gift_redemptions WHERE "userId" = 'uat_returning' AND "giftId" = 'reward-freeship' ORDER BY "createdAt" DESC LIMIT 1`);
      c.check('waste_gift_redemptions FULFILLED 20.000', rd?.status === 'FULFILLED' && rd?.pointsCost === 20000, rd);
      const key = { 'idempotency-key': randomUUID() };
      const r1 = await call('POST', '/me/loyalty/rewards/reward-freeship/redeem', 'returning', undefined, key);
      const r2 = await call('POST', '/me/loyalty/rewards/reward-freeship/redeem', 'returning', undefined, key);
      const after = await ledger('uat_returning');
      const rows2 = await ledgerRows('uat_returning', 'LOYALTY_REDEEM_VOUCHER:reward-freeship');
      c.check('API cùng khoá hai lần: 2xx cả hai, cùng mã', r1.status < 300 && r2.status < 300 && r1.body?.redemption?.id === r2.body?.redemption?.id, { r1: short(r1.body?.redemption, 120), r2: short(r2.body?.redemption, 120) });
      c.check('SQL: chỉ thêm 1 dòng trừ (tổng 2), số dư = mid − 20.000 = SUM', rows2.length === 2 && after.balance === mid.balance - 20000 && after.balance === after.ledgerSum, { mid, after, n: rows2.length });
      c.actual(`UI đổi: mã ${res?.coupon?.code}; sổ ${before.balance} → ${mid.balance}; API cùng khoá ×2 → ${r1.status}/${r2.status}, sổ → ${after.balance} (SUM ${after.ledgerSum}), ${rows2.length} dòng trừ.`);
      c.ev(relShot('U4-36-redeem-done'));
      c.ev(`SQL coupons ${JSON.stringify(cp)}; waste_gift_redemptions ${JSON.stringify(rd)}`);
    },
  ),
);

// ---------- U4-37: thiếu điểm
cases.push(
  await runCase(
    new Case('U4-37', {
      role: 'KHÁCH ít điểm (uat_new)',
      journey: 'Đổi quà và quay khi không đủ Điểm Xanh',
      steps: '/rewards xem thẻ "Miễn phí vận chuyển"; POST redeem; POST /game/spin',
      expected: 'Thẻ hiện "Cần thêm … điểm" thay nút "Đổi"; redeem → 400 "Bạn cần 20.000 Điểm Xanh…"; quay → 400 "Cần 10.000 Điểm Xanh để quay."; không có dòng sổ mới, số dư = SUM',
    }),
    async (c) => {
      const before = await ledger('uat_new');
      const missing = 20000 - before.balance;
      const s = await open(L.n, 'new', { headless, path: '/rewards' });
      try {
        const p = s.page;
        const card = p.locator('[data-reward]').filter({ hasText: 'Miễn phí vận chuyển' }).first();
        await card.waitFor({ timeout: 30_000 });
        const txt = (await card.innerText()).replace(/\s+/g, ' ');
        const want = `Cần thêm ${missing.toLocaleString('vi-VN')} điểm`;
        c.check(`Thẻ ghi "${want}", không có nút "Đổi"`, txt.includes(want) && (await card.getByRole('button', { name: 'Đổi', exact: true }).count()) === 0, short(txt, 200));
        await p.screenshot({ path: shot('U4-37-need-points') });
      } finally {
        await s.close();
      }
      const r = await call('POST', '/me/loyalty/rewards/reward-freeship/redeem', 'new', undefined, { 'idempotency-key': randomUUID() });
      c.check('Redeem → 400 "Bạn cần 20.000 Điểm Xanh"', r.status === 400 && /Bạn cần 20\.000 Điểm Xanh/.test(r.body?.message ?? ''), r.body);
      const sp = await call('POST', '/game/spin', 'new');
      c.check('Quay → 400 "Cần 10.000 Điểm Xanh để quay."', sp.status === 400 && /Cần 10\.000 Điểm Xanh để quay/.test(sp.body?.message ?? ''), sp.body);
      const after = await ledger('uat_new');
      const [rd] = await q(`SELECT count(*)::int AS n FROM waste_gift_redemptions WHERE "userId" = 'uat_new'`);
      c.check('SQL: số dư và số dòng không đổi, = SUM; không có lượt đổi', after.balance === before.balance && after.rows === before.rows && after.balance === after.ledgerSum && rd.n === 0, { before, after, redemptions: rd.n });
      c.actual(`Số dư ${before.balance}; redeem → ${r.status} "${r.body?.message}"; quay → ${sp.status} "${sp.body?.message}".`);
      c.ev(relShot('U4-37-need-points'));
    },
  ),
);

// ---------- U4-38: gợi ý "Vườn Xanh" lần đầu (B12)
cases.push(
  await runCase(
    new Case('U4-38', {
      role: 'KHÁCH (uat_new) trên máy mới',
      journey: 'Gợi ý lần đầu cho tab Vườn Xanh',
      steps: 'Mở / trên trình duyệt mới (bộ nhớ trống) → màn "Chào mừng đến Tubu Tree!" hiện thì bấm "Để sau" → thấy bóng gợi ý trên tab Vườn Xanh → tải lại trang',
      expected: 'Lần đầu hiện bóng "Trồng cây mỗi ngày, nhận quà thật" trỏ tab Vườn Xanh và ghi tubu_garden_hint_seen; tải lại không hiện nữa',
    }),
    async (c) => {
      const s = await open(L.n, 'new', { headless, path: '/' });
      try {
        const p = s.page;
        const bubble = p.getByRole('status').filter({ hasText: 'Trồng cây mỗi ngày, nhận quà thật' });
        await bubble.waitFor({ timeout: 30_000 });
        // Khách chưa chọn sở thích thấy màn "Chào mừng đến Tubu Tree!" phủ lên trang chủ: đóng bằng "Để sau" như khách thật.
        const later = p.getByRole('button', { name: 'Để sau' });
        await later.waitFor({ timeout: 5_000 }).catch(() => undefined);
        const onboarding = await later.isVisible().catch(() => false);
        if (onboarding) {
          await later.click();
          await p.waitForTimeout(1500);
        }
        c.check(onboarding ? 'Sau khi đóng màn chào mừng ("Để sau"), bóng gợi ý vẫn hiện' : 'Lần đầu hiện bóng gợi ý', await bubble.isVisible());
        await p.screenshot({ path: shot('U4-38-garden-hint') });
        const flag = await p.evaluate(() => localStorage.getItem('tubu_garden_hint_seen'));
        c.check('localStorage tubu_garden_hint_seen = "1"', flag === '1', flag);
        await p.reload();
        await p.waitForLoadState('networkidle').catch(() => undefined);
        await p.waitForTimeout(3000);
        c.check('Tải lại: không hiện nữa', (await bubble.count()) === 0);
        await p.screenshot({ path: shot('U4-38-garden-hint-reload') });
      } finally {
        await s.close();
      }
      c.actual('Bóng gợi ý hiện ở lần mở đầu, cờ lưu "1", tải lại không hiện.');
      c.ev(relShot('U4-38-garden-hint'));
      c.ev(relShot('U4-38-garden-hint-reload'));
    },
  ),
);

saveResults('40-game', cases);
await closePrisma();
log('xong');
