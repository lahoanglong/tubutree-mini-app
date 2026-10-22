#!/usr/bin/env node
// U3-50, U3-51 (ca mới, chạy lại 2026-10-22): trả bù thưởng quý đại lý (Q8, 60 ngày sau quý) và bản chụp bảng bậc theo quý (Q8b).
// Cần 04-dai-ly.mjs chạy trước: U3-32 đã trả thưởng Q3/2026 (dòng QUARTER_BONUS + bản chụp bảng bậc).
// Dựng: đơn CREDIT mới của uat_dealer, giao xong, kế toán ghi trả, rồi lùi orders.createdAt vào Q3/2026. Đơn này được chốt (đóng gói + ghi nợ)
// SAU lần trả thưởng nên là "đơn chốt muộn". Job DealerService.topUpQuarterlyBonuses chạy bằng giờ thật (22/10 nằm trong 60 ngày sau 30/9).
// Dùng: node 11-thuong-quy-tra-bu.mjs
import { L, api, apiOk, closeDb, deliver, exec, log, recorder, runJob, short, sql } from './u3lib.mjs';

const R = recorder('11-thuong-quy-tra-bu');
const RUN = Date.now().toString(36).slice(-5);
const D = 'uat_dealer';
const QUARTER = 'Q3/2026';
const TIER_KEY = 'dealer.quarterly_bonus_tiers';
const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const bonusOf = (v, tiers) => {
  const t = [...tiers].sort((a, b) => a.min - b.min).reverse().find((x) => v >= x.min);
  return t ? Math.round((v * t.pct) / 100) : 0;
};
const VN = 7 * 3600_000;
const qStart = new Date(Date.UTC(2026, 6, 1) - VN);
const qEnd = new Date(Date.UTC(2026, 9, 1) - VN);
const qMid = new Date(qStart.getTime() + 25 * 86_400_000);

const debtOf = async () => Number((await sql(`SELECT COALESCE(SUM(delta),0)::bigint d FROM dealer_credit_ledgers WHERE "userId" = $1`, D))[0].d);
const settled = async () =>
  Number((await sql(
    `SELECT COALESCE(SUM(o.total),0)::bigint s FROM orders o WHERE o."userId" = $1 AND o.type = 'DEALER' AND o."createdAt" >= $2 AND o."createdAt" < $3
       AND o.status::text IN ('PACKED','SHIPPING','DELIVERED') AND o."paymentStatus"::text NOT IN ('REFUNDED','FAILED')
       AND (o."paymentStatus" = 'PAID' OR EXISTS (SELECT 1 FROM dealer_credit_ledgers l WHERE l."userId" = o."userId" AND l."refType" = 'ORDER' AND l."refId" = o.id))`,
    D, qStart, qEnd,
  ))[0].s);
const quarterRows = () =>
  sql(
    `SELECT "refType", "refId", delta::int, "createdAt"::text c FROM dealer_credit_ledgers WHERE "userId" = $1 AND ("refType" IN ('QUARTER_BONUS','QUARTER_BONUS_TOPUP','QUARTER_BONUS_ADJ') AND "refId" LIKE $2) ORDER BY "createdAt", id`,
    D, `${QUARTER}%`,
  );
const held = async () => -(await quarterRows()).reduce((s, r) => s + r.delta, 0);
const snapshot = async () => (await sql(`SELECT tiers FROM dealer_quarter_bonus_tiers WHERE quarter = $1`, QUARTER))[0]?.tiers ?? null;

async function ketoanPay(amount, tag) {
  return api(L, 'POST', `/admin/dealers/${D}/credit-payment`, {
    user: 'uat_ketoan', headers: { 'idempotency-key': `u3-kt11-${RUN}-${tag}` }, body: { amount, bankRef: `FTU3B${RUN}${tag}`.toUpperCase().slice(0, 40), note: `UAT U3 ${tag}` },
  });
}

/** Đơn CREDIT ~target đồng tiền hàng, giao xong, kế toán ghi trả, lùi vào Q3/2026. */
async function lateOrder(target, tag) {
  const debt = await debtOf();
  if (debt > 0) await ketoanPay(debt, `pre${tag}`);
  const price = await apiOk(L, 'GET', '/dealer/pricelist', { user: D });
  const FLASH = ['BHN-CGL-100', 'BHN-CW-500', 'BHN-HN-500'];
  const lines = [];
  let left = target;
  for (const r of price.filter((x) => !FLASH.includes(x.sku)).sort((a, b) => b.stock * b.dealerPrice - a.stock * a.dealerPrice)) {
    if (left <= 0) break;
    const q = Math.min(Math.max(0, r.stock - 10), Math.ceil(left / r.dealerPrice));
    if (q <= 0) continue;
    lines.push({ variationId: r.variationId, quantity: q });
    left -= q * r.dealerPrice;
  }
  if (left > 0) throw new Error(`không đủ tồn dựng đơn ${target}đ`);
  const r = await api(L, 'POST', '/dealer/orders', { user: D, headers: { 'idempotency-key': `u3-late-${RUN}-${tag}` }, body: { items: lines, paymentMethod: 'CREDIT' } });
  if (!r.ok) throw new Error(`đơn chốt muộn ${tag} ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  await deliver(r.body.code);
  const o = (await sql(`SELECT id, code, total::int total, status::text s FROM orders WHERE code = $1`, r.body.code))[0];
  await exec(`UPDATE orders SET "createdAt" = $2 WHERE id = $1`, o.id, qMid);
  return o;
}

const notiCount = async (tpl) =>
  (await sql(`SELECT count(*)::int n FROM notification_logs WHERE "userId" = $1 AND "templateCode" = $2`, D, tpl).catch(() => [{ n: -1 }]))[0].n;

let prevTiers;
try {
  const base = await quarterRows();
  const snap0 = await snapshot();
  if (!base.some((r) => r.refType === 'QUARTER_BONUS') || !snap0) throw new Error(`chưa có thưởng ${QUARTER} + bản chụp bảng bậc: chạy 04-dai-ly.mjs trước (U3-32)`);
  prevTiers = (await sql(`SELECT value::text v FROM system_configs WHERE key = $1`, TIER_KEY))[0]?.v;
  log('thưởng gốc', base);

  // ---------- U3-50 trả bù đơn chốt muộn ----------
  const held0 = await held();
  const v0 = await settled();
  const o50 = await lateOrder(6_000_000, 'a');
  const v1 = await settled();
  const exp50 = Math.min(bonusOf(v1, snap0) - held0, bonusOf(v1, snap0) - bonusOf(v1 - o50.total, snap0));
  const notiBefore = await notiCount('DEALER_BONUS_TOPUP');
  const debtBefore = await debtOf();
  const t0 = Date.now();
  const job1 = runJob('DealerService.topUpQuarterlyBonuses');
  const rows1 = await quarterRows();
  const top1 = rows1.filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
  const debtAfter = await debtOf();
  const job2 = runJob('DealerService.topUpQuarterlyBonuses');
  const rows2 = await quarterRows();
  const noti1 = await notiCount('DEALER_BONUS_TOPUP');
  R.add({
    id: 'U3-50', role: 'Đại lý / hệ thống', journey: 'Trả bù thưởng quý (Q8)', title: `Đơn chốt muộn ${vnd(o50.total)} của ${QUARTER}: trả bù đúng phần chênh, chạy lại không trả đôi`,
    steps: `Thưởng ${QUARTER} đã trả ${vnd(held0)} (doanh số đã chốt ${vnd(v0)}); đơn CREDIT ${o50.code} giao xong, lùi vào ${QUARTER}; run-job DealerService.topUpQuarterlyBonuses hai lần`,
    expected: `Doanh số đã chốt ${vnd(v0)} → ${vnd(v1)}; 1 dòng QUARTER_BONUS_TOPUP refId "${QUARTER}:topup:1" = −${vnd(exp50)} (= min(thưởng mới − phần đang giữ, thưởng mới − thưởng lúc đã trả), bảng bậc đã chụp); dư nợ giảm đúng số đó; lượt 2 toppedUp 0, không thêm dòng; có tin DEALER_BONUS_TOPUP`,
    actual: { v0, v1, held0, exp50, job1: job1.result ?? job1.error, job2: job2.result ?? job2.error, top1, rowsAfterRun2: rows2.length, debt: [debtBefore, debtAfter], noti: [notiBefore, noti1] },
    evidence: `SQL doanh số ${QUARTER} ${v0}→${v1}; dealer_credit_ledgers ${short(top1)}; SUM sổ ${debtBefore}→${debtAfter}; lượt 2 ${short(job2.result)}; notification_logs DEALER_BONUS_TOPUP ${notiBefore}→${noti1}`,
    status: exp50 > 0 && (job1.result?.toppedUp ?? 0) >= 1 && job1.result?.quarters?.includes(QUARTER) && top1.length === 1 && top1[0].refId === `${QUARTER}:topup:1` && top1[0].delta === -exp50 &&
      debtAfter === debtBefore - exp50 && (job2.result?.toppedUp ?? -1) === 0 && rows2.length === rows1.length && noti1 === notiBefore + 1 &&
      Date.now() - t0 > 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-51 bảng bậc đã chụp: đổi bậc sau đó không ảnh hưởng quý cũ ----------
  // Đổi bậc bằng đường thật PUT /admin/config (API nhận khoá dealer.quarterly_bonus_tiers từ gói q8-bac-admin).
  // Mỗi lượt run-job là tiến trình mới nên không dính bộ nhớ đệm cấu hình của API.
  const put = await api(L, 'PUT', '/admin/config', { user: 'uat_admin', body: { key: TIER_KEY, value: [{ min: 50_000_000, pct: 10 }] } });
  log('PUT /admin/config', { status: put.status, body: put.body });
  if (put.status >= 300) throw new Error(`PUT /admin/config ${TIER_KEY} ${put.status}: ${JSON.stringify(put.body).slice(0, 300)}`);
  const held1 = await held();
  const o51 = await lateOrder(6_000_000, 'b');
  const v2 = await settled();
  const snap1 = await snapshot();
  const exp51 = Math.min(bonusOf(v2, snap0) - held1, bonusOf(v2, snap0) - bonusOf(v2 - o51.total, snap0));
  const naive = Math.min(bonusOf(v2, [{ min: 50_000_000, pct: 10 }]) - held1, bonusOf(v2, [{ min: 50_000_000, pct: 10 }]) - bonusOf(v2 - o51.total, [{ min: 50_000_000, pct: 10 }]));
  const job3 = runJob('DealerService.topUpQuarterlyBonuses');
  const rows3 = await quarterRows();
  const top3 = rows3.filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
  R.add({
    id: 'U3-51', role: 'ADMIN / hệ thống', journey: 'Bản chụp bảng bậc theo quý (Q8b)', title: `Admin đổi bậc thưởng lên 10% sau khi quý ${QUARTER} đã trả: trả bù vẫn theo bậc 2% đã chụp`,
    steps: `PUT /admin/config ${TIER_KEY} = [{min 50.000.000, pct 10}] (đường admin thật, status ${put.status}); đơn chốt muộn ${o51.code} (${vnd(o51.total)}) vào ${QUARTER}; run-job topUpQuarterlyBonuses; xoá khoá trả về bậc mặc định`,
    expected: `Bản chụp ${QUARTER} không đổi (2% / 3% / 4%); dòng trả bù thứ 2 "${QUARTER}:topup:2" = −${vnd(exp51)} theo bậc đã chụp (nếu theo bậc mới 10% sẽ là ${vnd(naive)})`,
    actual: { putStatus: put.status, snapshotBefore: snap0, snapshotAfter: snap1, held1, v2, exp51, naive, job3: job3.result ?? job3.error, top3 },
    evidence: `PUT /admin/config → ${put.status}; SQL dealer_quarter_bonus_tiers ${QUARTER} ${short(snap1)}; dealer_credit_ledgers ${short(top3.slice(1))}; doanh số ${v2}; số theo bậc cũ ${exp51} vs bậc mới ${naive}`,
    status: JSON.stringify(snap1) === JSON.stringify(snap0) && exp51 > 0 && exp51 !== naive && (job3.result?.toppedUp ?? 0) >= 1 && top3.length === 2 && top3[1].refId === `${QUARTER}:topup:2` && top3[1].delta === -exp51 ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-50..51', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
} finally {
  // Lane chưa từng có khoá này: xoá để về bảng mặc định của mã; nếu đã có thì đặt lại giá trị cũ.
  if (prevTiers === undefined) await exec(`DELETE FROM system_configs WHERE key = $1`, TIER_KEY).catch(() => undefined);
  else await exec(`UPDATE system_configs SET value = $2::jsonb WHERE key = $1`, TIER_KEY, prevTiers).catch(() => undefined);
  R.save();
  await closeDb();
}
