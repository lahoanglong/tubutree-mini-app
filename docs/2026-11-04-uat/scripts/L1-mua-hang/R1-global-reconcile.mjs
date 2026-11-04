// R1: đối soát SQL toàn DB lane 1 (chỉ đọc): đơn, sổ điểm, ví, tồn kho, lượt dùng mã, hoàn tiền.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/R1-global-reconcile.mjs
import { sql, rec, closePrisma } from './lib.mjs';
import { reconcileOrder } from './kit.mjs';

const FILE = 'R1';
const out = [];
const add = (id, step, expected, actual, ok) => {
  const row = { id, persona: 'toàn DB', surface: 'sql', journey: 'đối soát', step, expected, actual, status: ok ? 'PASS' : 'FAIL' };
  rec(FILE, row);
  out.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${step} :: ${actual}`);
};

// R1-01: mọi đơn tự khớp số học
const orders = await sql(`select code, status from orders order by "createdAt"`);
const bad = [];
for (const o of orders) {
  const r = await reconcileOrder(o.code);
  if (!r.ok) bad.push(`${o.code}(${o.status}): ${r.problems.join('; ')}`);
}
add('R1-01', `${orders.length} đơn: Σ dòng = tạm tính; giảm = mã+combo+hạng+điểm; tổng = tạm tính − giảm + ship; Σ paidTotal; điểm dùng`, '0 đơn lệch', bad.length ? bad.slice(0, 6).join(' | ') : '0 đơn lệch', bad.length === 0);

// R1-02: số dư điểm = Σ sổ cái theo lô
const drift = await sql(`
  select u.id, u.phone, u."pointsBalance"::int pb, coalesce(s.std,0)::int std, u."pointsConvertedBalance"::int pcb, coalesce(s.conv,0)::int conv
  from users u left join (
    select "userId", sum(case when lot='STANDARD' then delta else 0 end) std, sum(case when lot='CONVERTED' then delta else 0 end) conv
    from points_transactions group by "userId") s on s."userId" = u.id
  where u."pointsBalance" <> coalesce(s.std,0) or u."pointsConvertedBalance" <> coalesce(s.conv,0)`);
add('R1-02', 'users.pointsBalance / pointsConvertedBalance = Σ points_transactions.delta theo lô', '0 user lệch', drift.length ? JSON.stringify(drift.slice(0, 5)) : '0 user lệch', drift.length === 0);

// R1-03: số dư ví = Σ sổ ví = balanceAfter dòng cuối
const wd = await sql(`
  select u.id, u."walletBalance"::int wb, coalesce(s.sum,0)::int sm
  from users u left join (select "userId", sum(delta) sum from wallet_transactions group by "userId") s on s."userId"=u.id
  where u."walletBalance" <> coalesce(s.sum,0)`);
add('R1-03', 'users.walletBalance = Σ wallet_transactions.delta', '0 user lệch', wd.length ? JSON.stringify(wd.slice(0, 5)) : '0 user lệch', wd.length === 0);
const neg = await sql(`select count(*)::int n from users where "pointsBalance" < 0 or "walletBalance" < 0 or "pointsConvertedBalance" < 0`);
add('R1-04', 'không user nào có số dư điểm/ví âm', '0', String(neg[0].n), neg[0].n === 0);

// R1-05: điểm dùng của đơn có dòng sổ trừ tương ứng; đơn huỷ có dòng hoàn
const pu = await sql(`
  select o.code, o.status, o."pointsUsed"::int pu,
    coalesce((select sum(-delta) from points_transactions t where t."refId" = o.id and t.delta < 0 and t.reason ilike '%order%' ),0)::int spent
  from orders o where o."pointsUsed" > 0`);
const puBad = pu.filter((r) => r.spent !== r.pu && r.status !== 'CANCELLED');
add('R1-05', `${pu.length} đơn có dùng điểm: Σ dòng sổ trừ (refId = id đơn) = pointsUsed`, '0 đơn lệch', puBad.length ? JSON.stringify(puBad.slice(0, 5)) : '0 đơn lệch', puBad.length === 0);

// R1-06: đơn huỷ đã hoàn điểm
const canc = await sql(`
  select o.code, o."pointsUsed"::int pu,
    coalesce((select sum(delta) from points_transactions t where t."refId" = o.id),0)::int net
  from orders o where o.status = 'CANCELLED' and o."pointsUsed" > 0`);
const cancBad = canc.filter((r) => r.net !== 0);
add('R1-06', `${canc.length} đơn đã huỷ có dùng điểm: Σ sổ theo đơn = 0 (đã hoàn đủ)`, '0 đơn còn lệch', cancBad.length ? JSON.stringify(cancBad.slice(0, 5)) : '0 đơn lệch', cancBad.length === 0);

// R1-07: lượt dùng mã
const cp = await sql(`
  select c.code, c."usageLimit", c."usedCount"::int uc, (select count(*)::int from coupon_redemptions r where r."couponId"=c.id) rd,
    (select count(*)::int from coupon_redemptions r join orders o on o.id=r."orderId" where r."couponId"=c.id and o.status <> 'CANCELLED') live
  from coupons c`);
const cpBad = cp.filter((c) => c.usageLimit != null && c.uc > c.usageLimit);
add('R1-07', 'usedCount không vượt usageLimit', '0 mã vượt', cpBad.length ? JSON.stringify(cpBad) : `${cp.length} mã, 0 vượt`, cpBad.length === 0);

// R1-08: mỗi user không vượt perUserLimit số lượt dùng (đơn chưa huỷ)
const pul = await sql(`
  select c.code, c."perUserLimit"::int lim, o."userId", count(*)::int n
  from coupon_redemptions r join coupons c on c.id = r."couponId" join orders o on o.id = r."orderId"
  where o.status <> 'CANCELLED' and c."perUserLimit" is not null group by c.code, c."perUserLimit", o."userId" having count(*) > c."perUserLimit"`);
add('R1-08', 'mỗi user không vượt perUserLimit (đơn chưa huỷ)', '0', pul.length ? JSON.stringify(pul) : '0', pul.length === 0);

// R1-09: tồn kho
const st = await sql(`select id, stock::int s, "reservedStock"::int r from variations where stock < 0 or "reservedStock" < 0`);
add('R1-09', 'tồn kho / reservedStock không âm', '0 biến thể', st.length ? JSON.stringify(st.slice(0, 5)) : '0', st.length === 0);

// R1-10: đơn hoàn tiền (refund) mồ côi
const rf = await sql(`select count(*)::int n from order_customer_refunds rr where not exists (select 1 from orders o where o.id = rr."orderId")`).catch(() => [{ n: 'không có bảng' }]);
add('R1-10', 'yêu cầu hoàn tiền đều gắn đơn có thật', '0 mồ côi', String(rf[0].n), rf[0].n === 0);

await closePrisma();
console.log(`\n${out.filter((x) => x.status === 'PASS').length}/${out.length} PASS`);
