// Đối chiếu tiền/điểm toàn lane 6 sau khi chạy các nhóm ca: in từng truy vấn + kết quả (dán vào báo cáo) và ghi results/reconcile.json.
// Chạy:  node reconcile.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Recorder, finish, sql, RESULTS } from './_lib.mjs';

const rec = new Recorder('reconcile');
const out = [];
const q = async (title, query, ...params) => {
  const rows = await sql(query, ...params);
  out.push({ title, query: query.replace(/\s+/g, ' ').trim(), params, rows });
  return rows;
};

await rec.run('U6-90', { role: 'Toàn bộ khách UAT (uat_returning, uat_new, uat_new_nophone)', journey: 'Đối chiếu sổ điểm / ví / tổng đơn', steps: 'Chạy truy vấn đối chiếu trên DB lane 6 sau khi mọi nhóm ca đã chạy', expected: 'users.pointsBalance = SUM(points_transactions lô STANDARD); users.walletBalance = SUM(wallet_transactions) (khi có dòng sổ ví); mỗi đơn: tổng = tạm tính − giảm + phí ship, giảm = mã + combo + hạng + Điểm Xanh, tổng dòng hàng = tạm tính; đơn đã giao: điểm = làm tròn xuống (2% × tiền hàng sau giảm × hệ số hạng); mỗi đơn có mã còn hiệu lực có đúng 1 dòng coupon_redemptions; hoa hồng = 8% tiền hàng tính hoa hồng' }, async (c) => {
  const uid = ['uat_returning', 'uat_new', 'uat_new_nophone'];
  const pointsMismatch = await q(
    'Số dư điểm = tổng sổ điểm (lô STANDARD)',
    `SELECT u.id, u."pointsBalance"::int AS balance, COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'STANDARD'), 0)::int AS ledger_sum, COUNT(p.id)::int AS rows FROM users u LEFT JOIN points_transactions p ON p."userId" = u.id WHERE u.id = ANY($1) GROUP BY u.id ORDER BY u.id`,
    uid,
  );
  c.ok('pointsBalance = SUM(sổ STANDARD) cho cả 3 khách', pointsMismatch.every((r) => r.balance === r.ledger_sum), pointsMismatch);
  const walletRows = await q(
    'Số dư ví = tổng sổ ví',
    `SELECT u.id, u."walletBalance"::int AS balance, COALESCE(SUM(w.delta), 0)::int AS ledger_sum, COUNT(w.id)::int AS rows FROM users u LEFT JOIN wallet_transactions w ON w."userId" = u.id WHERE u.id = ANY($1) GROUP BY u.id ORDER BY u.id`,
    uid,
  );
  c.ok('walletBalance = SUM(sổ ví) cho cả 3 khách', walletRows.every((r) => r.balance === r.ledger_sum), walletRows);
  const bad = await q(
    'Đơn có tổng ≠ tạm tính − giảm + phí ship (bỏ đơn mẫu cũ)',
    `SELECT code, status, subtotal::int, discount::int, "shippingFee"::int AS fee, total::int, (subtotal - discount + "shippingFee")::int AS expected FROM orders WHERE "userId" = ANY($1) AND total <> subtotal - discount + "shippingFee" ORDER BY "createdAt"`,
    uid,
  );
  c.ok('mọi đơn: total = subtotal − discount + shippingFee', bad.length === 0, bad);
  const badDisc = await q(
    'Đơn có giảm ≠ mã + combo + hạng + Điểm Xanh',
    `SELECT code, discount::int, ("couponDiscount" + "comboDiscount" + "tierDiscount" + "pointsDiscount")::int AS parts FROM orders WHERE "userId" = ANY($1) AND discount <> "couponDiscount" + "comboDiscount" + "tierDiscount" + "pointsDiscount"`,
    uid,
  );
  c.ok('mọi đơn: discount = couponDiscount + comboDiscount + tierDiscount + pointsDiscount', badDisc.length === 0, badDisc);
  const badItems = await q(
    'Đơn có tổng dòng hàng ≠ tạm tính',
    `SELECT o.code, o.subtotal::int, SUM(oi.total)::int AS items_sum FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE o."userId" = ANY($1) GROUP BY o.id HAVING SUM(oi.total) <> o.subtotal`,
    uid,
  );
  c.ok('mọi đơn: SUM(order_items.total) = subtotal', badItems.length === 0, badItems);
  const earn = await q(
    'Điểm tích của đơn đã giao trong đợt UAT (từ 2026-10-19): so với công thức 2% × tiền hàng sau giảm × hệ số hạng. Bỏ các đơn mẫu có sẵn trong DB mẫu (tạo 2026-10-09), phát hành điểm lúc khách còn hạng khác',
    `SELECT o.code, u."tierId", o.subtotal::int, o."couponDiscount"::int AS coupon, o."pointsDiscount"::int AS pts_disc, o."pointsEarned"::int AS earned,
            COALESCE((SELECT SUM(p.delta) FROM points_transactions p WHERE p."userId" = o."userId" AND p.reason LIKE 'ORDER_DELIVERED:' || o.code || '%'), 0)::int AS ledger,
            FLOOR((o.subtotal - o."couponDiscount" - o."comboDiscount" - o."tierDiscount") * 0.02 * CASE u."tierId" WHEN 'LOC_BIEC' THEN 1.2 WHEN 'DAI_THU' THEN 1.5 WHEN 'CO_THU' THEN 2 ELSE 1 END)::int AS expect_before_points,
            FLOOR((o.subtotal - o."couponDiscount" - o."comboDiscount" - o."tierDiscount" - o."pointsDiscount") * 0.02 * CASE u."tierId" WHEN 'LOC_BIEC' THEN 1.2 WHEN 'DAI_THU' THEN 1.5 WHEN 'CO_THU' THEN 2 ELSE 1 END)::int AS expect_after_points
       FROM orders o JOIN users u ON u.id = o."userId" WHERE o."userId" = ANY($1) AND o.status = 'DELIVERED' AND o."createdAt" >= '2026-10-19T00:00:00+07:00' ORDER BY o."createdAt"`,
    uid,
  );
  const earnBad = earn.filter((r) => r.ledger !== r.earned || (r.earned !== r.expect_before_points && r.earned !== r.expect_after_points));
  c.ok('mọi đơn đã giao: dòng sổ = pointsEarned và = công thức (2% × tiền hàng sau giảm × hệ số hạng)', earnBad.length === 0, earnBad);
  const redeem = await q(
    'Đơn có mã giảm giá còn hiệu lực phải có đúng 1 dòng coupon_redemptions; đơn huỷ không còn dòng',
    `SELECT o.code, o.status, o."couponCode", (SELECT count(*) FROM coupon_redemptions r WHERE r."orderId" = o.id)::int AS redemptions FROM orders o WHERE o."userId" = ANY($1) AND o."couponCode" IS NOT NULL ORDER BY o."createdAt"`,
    uid,
  );
  c.ok('đơn có mã chưa huỷ: 1 redemption; đơn huỷ: 0', redeem.every((r) => (r.status === 'CANCELLED' ? r.redemptions === 0 : r.redemptions === 1)), redeem);
  const com = await q(
    'Hoa hồng CTV: 8% tiền hàng tính hoa hồng, giữ 10 ngày sau giao',
    `SELECT o.code, c.status, c."commissionableTotal"::int AS base, c.rate::float AS rate, c.amount::int AS amount, ROUND(c."commissionableTotal" * 0.08)::int AS expect_8pct, o."deliveredAt", c."lockedAt", c."approvedAt" FROM commissions c JOIN orders o ON o.id = c."orderId" WHERE o."userId" = ANY($1)`,
    uid,
  );
  c.ok('hoa hồng = 8% × tiền hàng tính hoa hồng', com.length > 0 && com.every((r) => Math.abs(r.amount - r.expect_8pct) <= 1), com);
  if (com[0]?.deliveredAt) {
    const hold = (new Date(com[0].lockedAt ?? com[0].approvedAt ?? 0) - new Date(com[0].deliveredAt)) / 86400_000;
    c.ev('khoảng cách giao → khoá/duyệt hoa hồng (ngày)', { lockedAt: com[0].lockedAt, approvedAt: com[0].approvedAt, days: hold, status: com[0].status });
  }
  const stock = await q(
    'Tồn kho không âm',
    `SELECT sku, stock::int, "reservedStock"::int AS reserved FROM variations WHERE stock < 0 OR "reservedStock" < 0`,
  );
  c.ok('không SKU nào có tồn hoặc tồn giữ chỗ âm', stock.length === 0, stock);
  const dupes = await q(
    'Đơn trùng (cùng khách, cùng tổng, cách nhau dưới 1 giây): dấu hiệu bấm đặt hàng hai lần mà không được chặn',
    `SELECT a.code AS a, b.code AS b FROM orders a JOIN orders b ON a."userId" = b."userId" AND a.id < b.id AND a.total = b.total AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - b."createdAt"))) < 1 WHERE a."userId" = ANY($1)`,
    uid,
  );
  c.ok('không có cặp đơn trùng trong 1 giây', dupes.length === 0, dupes);
  c.ev('số truy vấn đối chiếu', out.length);
});

fs.writeFileSync(path.join(RESULTS, 'reconcile-queries.json'), JSON.stringify(out, null, 2));
await finish(rec);
