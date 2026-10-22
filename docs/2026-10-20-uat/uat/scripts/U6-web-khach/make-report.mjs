// Gộp results/*.json thành bảng ca (một dòng mỗi ca; ca chạy ở nhiều khổ gộp theo ID gốc, kết quả xấu nhất thắng)
// và ghi results/table.md + results/summary.json. Phần "Lỗi tìm thấy", "Hạn chế bộ khung" viết tay trong ../../U6-web-khach.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const files = fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json') && !['summary.json', 'reconcile-queries.json'].includes(f) && !f.startsWith('probe') && !f.startsWith('repro'));
const cases = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')).cases ?? []);

const SQL = {
  'U6-30': 'SELECT code,status,"paymentMethod","paymentStatus",subtotal,"shippingFee",total,"pointsEarned" FROM orders WHERE code=$1; SELECT v.sku,oi.quantity,oi."unitPrice",oi.total FROM order_items oi JOIN variations v ON v.id=oi."variationId" WHERE oi."orderId"=…; SELECT stock,"reservedStock" FROM variations WHERE sku=\'FUWA-HW-500\'; SELECT delta,reason FROM points_transactions WHERE "userId"=\'uat_returning\' AND reason LIKE \'ORDER_DELIVERED:<mã>%\'; SELECT "pointsBalance" FROM users …; SELECT SUM(delta) FROM points_transactions WHERE lot=\'STANDARD\' …',
  'U6-31': 'SELECT "pointsUsed","pointsDiscount",total FROM orders WHERE code=$1; SELECT delta,reason FROM points_transactions WHERE "userId"=… AND reason LIKE \'%<mã>%\'; SELECT "pointsBalance" vs SUM(delta) trước đặt / sau đặt / sau huỷ; SELECT stock,"reservedStock" FROM variations WHERE sku=\'FUWA-DW-1L\'',
  'U6-32': 'SELECT "couponCode","couponDiscount",subtotal,"shippingFee",total FROM orders WHERE code=$1; SELECT r.id FROM coupon_redemptions r JOIN coupons c ON c.id=r."couponId" WHERE c.code=\'XANH10\' AND r."userId"=\'uat_returning\' (sau đặt = 1 dòng, sau huỷ = 0 dòng)',
  'U6-33': 'SELECT recipient,street,"isDefault" FROM addresses WHERE "userId"=\'uat_new\'; SELECT status,"paymentStatus","paidAt","couponCode","couponDiscount",total FROM orders WHERE code=$1 (trước/sau từng khoản CK); SELECT delta,reason FROM points_transactions WHERE reason LIKE \'ORDER_DELIVERED:<mã>%\' (= +3.380); SELECT "usedCount","usageLimit" FROM coupons WHERE code=<HOPSAN-…>',
  'U6-35': 'POST /checkout/quote (oracle) + so với dòng "Phí vận chuyển" trên trang: SELECT count(*) FROM orders WHERE "userId"=\'uat_new_nophone\' (=0: đơn đầu)',
  'U6-36': 'SELECT count(*) FROM orders WHERE "userId"=… (không đổi); SELECT stock,"reservedStock" FROM variations WHERE sku=\'FUWA-GL-500\'',
  'U6-38': 'SELECT "paymentMethod","paymentStatus",total FROM orders WHERE code=$1; SELECT "walletBalance" FROM users WHERE id=\'uat_returning\' (200.000 → 200.000 − tổng → hoàn lại 200.000); SELECT delta,type,reason FROM wallet_transactions WHERE "userId"=… ORDER BY "createdAt" DESC',
  'U6-39': 'SELECT "storefrontSlug","referrerUserId" FROM orders WHERE code=$1; SELECT "affiliateUserId","commissionableTotal",rate,amount,status FROM commissions WHERE "orderId"=…',
  'U6-54': 'SELECT status,"paymentStatus",total FROM orders WHERE code=$1; SELECT "walletBalance" FROM users …; SELECT SUM(delta) FROM wallet_transactions WHERE "userId"=…; SELECT delta,type,reason,"balanceAfter" FROM wallet_transactions ORDER BY "createdAt" DESC LIMIT 3',
  'U6-62': 'SELECT delta,reason,"expiresAt","createdAt" FROM points_transactions WHERE "userId"=\'uat_returning\' ORDER BY "createdAt" DESC LIMIT 100; SELECT "pointsBalance" vs SUM(delta) lot=\'STANDARD\'; GET /me/loyalty (lockedPoints, expiringPoints)',
  'U6-63': 'SELECT "cycleDay","streakDays",points,"dayKey" FROM loyalty_check_ins WHERE "userId"=\'uat_new_nophone\'; SELECT "pointsBalance" vs SUM(delta) trước/sau; lần 2: COUNT(*) vẫn 1',
  'U6-64': 'SELECT "walletBalance" FROM users …; SELECT COALESCE(SUM(delta),0) FROM wallet_transactions WHERE "userId"=…',
  'U6-90': 'xem results/reconcile-queries.json (mọi truy vấn + kết quả)',
};
const MONEY = new Set(Object.keys(SQL));

const base = (id) => id.match(/^U6-\d+/)[0];
const rank = { PASS: 0, BLOCKED: 1, FAIL: 2 };
const groups = new Map();
for (const c of cases) {
  const b = base(c.id);
  if (!groups.has(b)) groups.set(b, []);
  groups.get(b).push(c);
}
const esc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
const cut = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
const shotLink = (s) => `[${path.basename(s)}](${s.replace(/^uat\//, '')})`;

const rows = [];
const summary = { PASS: 0, FAIL: 0, BLOCKED: 0, fail: [], blocked: [] };
for (const [b, list] of [...groups.entries()].sort((a, z) => Number(a[0].slice(3)) - Number(z[0].slice(3)))) {
  const verdict = list.map((c) => c.verdict).sort((a, z) => rank[z] - rank[a])[0];
  const first = list[0];
  const checks = list.flatMap((c) => c.checks.map((k) => ({ ...k, id: c.id })));
  const okN = checks.filter((k) => k.ok).length;
  const failed = checks.filter((k) => !k.ok);
  let actual = `${okN}/${checks.length} kiểm tra đúng`;
  if (failed.length) actual += `<br>SAI: ${failed.slice(0, 5).map((k) => `${esc(k.name)}${k.detail ? ` → ${esc(cut(k.detail, 160))}` : ''}`).join('<br>')}${failed.length > 5 ? `<br>… và ${failed.length - 5} điểm sai khác` : ''}`;
  const blocked = list.find((c) => c.blockedReason);
  if (blocked) actual += `<br>BLOCKED: ${esc(blocked.blockedReason)}`;
  const shots = [...new Set(list.flatMap((c) => c.shots))].slice(0, 4).map(shotLink);
  const ev = list.flatMap((c) => c.evidence.map((e) => `${e.label}: ${cut(String(e.value ?? ''), 110)}`)).slice(0, 3);
  const sqlText = SQL[b] ? `<br>SQL: <code>${esc(cut(SQL[b], 420))}</code>` : '';
  const evidence = [shots.join(' '), ev.map((e) => `<code>${esc(e)}</code>`).join('<br>')].filter(Boolean).join('<br>') + sqlText;
  const widths = list.map((c) => (c.id.match(/-(390|1440)$/) ? c.id.match(/-(390|1440)$/)[1] : null)).filter(Boolean);
  const steps = esc(first.steps).replace(/\((390|1440)px\)/g, '') + (widths.length > 1 ? ` (chạy ở ${[...new Set(widths)].join(' và ')}px)` : '');
  rows.push(`| ${b} | ${esc(first.role)} | ${esc(first.journey)} | ${cut(steps, 380)} | ${cut(esc(first.expected), 520)} | ${actual} | ${evidence} | **${verdict}** |`);
  summary[verdict] += 1;
  if (verdict === 'FAIL') summary.fail.push({ id: b, why: failed.slice(0, 2).map((k) => k.name).join('; ') });
  if (verdict === 'BLOCKED') summary.blocked.push({ id: b, why: blocked?.blockedReason });
}

const header = '| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | PASS/FAIL/BLOCKED |\n|---|---|---|---|---|---|---|---|';
fs.writeFileSync(path.join(RESULTS, 'table.md'), `${header}\n${rows.join('\n')}\n`);
fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 2));
// Ghép vào báo cáo viết tay ../../U6-web-khach.md giữa các dấu <!-- U6-xxx:BEGIN --> ... <!-- U6-xxx:END -->.
const MD = path.join(HERE, '..', '..', 'U6-web-khach.md');
const splice = (text, tag, body) => text.replace(new RegExp(`(<!-- ${tag}:BEGIN -->)[\\s\\S]*?(<!-- ${tag}:END -->)`), (_m, a, b) => `${a}\n${body}\n${b}`);
if (fs.existsSync(MD)) {
  let md = fs.readFileSync(MD, 'utf8');
  md = splice(md, 'U6-TABLE', `${header}\n${rows.join('\n')}`);
  md = splice(md, 'U6-SUMMARY', `${rows.length} ca: **${summary.PASS} PASS / ${summary.FAIL} FAIL / ${summary.BLOCKED} BLOCKED**.${summary.fail.length ? ` FAIL: ${summary.fail.map((f) => f.id).join(', ')}.` : ''}`);
  const rq = path.join(RESULTS, 'reconcile-queries.json');
  if (fs.existsSync(rq)) {
    const out = JSON.parse(fs.readFileSync(rq, 'utf8'));
    const body = out
      .map((q, i) => `**R${i + 1}. ${q.title}**\n\n\`\`\`sql\n${q.query}${q.params?.length ? `\n-- $1 = ${JSON.stringify(q.params[0])}` : ''}\n\`\`\`\n\nKết quả (${q.rows.length} dòng${q.rows.length > 12 ? ', in 12 dòng đầu' : ''}):\n\n\`\`\`json\n${JSON.stringify(q.rows.slice(0, 12))}\n\`\`\``)
      .join('\n\n');
    md = splice(md, 'U6-RECON', body);
  }
  fs.writeFileSync(MD, md);
}
console.log(`ca: ${rows.length}  PASS ${summary.PASS} / FAIL ${summary.FAIL} / BLOCKED ${summary.BLOCKED}`);
for (const f of summary.fail) console.log(`  FAIL ${f.id}: ${f.why}`);
