// A2b: (bản nối A2: đơn 5L thực tế giá 430.000đ nên đơn 42×/105× chưa đủ mốc; đặt thêm để vượt mốc)  lên hạng theo chi tiêu 12 tháng (Lộc Biếc 1,5tr, Đại Thụ 20tr, Cổ Thụ 50tr), hệ số điểm + ưu đãi từng hạng, thông báo lên hạng.
import { A, makeRec, place, codeOf, deliver, job, sql, sql1, pointsLedger, bankWebhook, done, L } from './lib3.mjs';
const { rec, check } = makeRec('a2b-tiers');
const J = 'Điểm Xanh: lên hạng và hệ số';
// Tồn kho đủ cho đơn lớn (dữ liệu thử, không phải luật).
await sql(`UPDATE variations SET stock=5000, "reservedStock"=0 WHERE sku IN ('FUWA-DW-5L','FUWA-DW-1L','FUWA-GL-500') RETURNING id`);

async function bigOrder(persona, qty, tag) {
  const p = await place(persona, [{ slug: 'nuoc-rua-chen-fuwa3e', qty, vid: undefined }], { payment: 'BANK_TRANSFER', tag });
  const code = codeOf(p.order);
  if (!code) return { p, code: null };
  const total = p.order?.total ?? p.quote?.total;
  const b = bankWebhook(code, total, `${code} thanh toan`);
  return { p, code, total, bank: b };
}
// variations[0] của sản phẩm là bản 1L (120.000đ): dùng bản 5L (480.000đ) cho đơn lớn
const v5 = (await sql1(`SELECT v.id FROM variations v WHERE v.sku='FUWA-DW-5L'`)).id;
const big = async (persona, qty, tag) => {
  const pl = await place(persona, [{ vid: v5, qty }], { payment: 'BANK_TRANSFER', tag });
  const code = codeOf(pl.order);
  if (!code) return { pl, code: null };
  const total = pl.order?.total ?? pl.quote?.total;
  const b = bankWebhook(code, total, `${code} thanh toan`);
  const st = await sql1(`SELECT status, "paymentStatus" ps FROM orders WHERE code=$1`, code);
  return { pl, code, total, bank: b?.error ?? b?.orderAfter?.status, st };
};
const ladder = [
    { persona: 'brand', qty: 5, expect: 'DAI_THU', mult: 1.5, minSpend: 20000000 },
  { persona: 'kho', qty: 12, expect: 'CO_THU', mult: 2, minSpend: 50000000 },
];
for (const [i, s] of ladder.entries()) {
  const tag = `A2${'bc'[i]}2`;
  const uid = `uat_${s.persona}`;
  const tierBefore = (await sql1(`SELECT "tierId" t FROM users WHERE id=$1`, uid)).t;
  const o = await big(s.persona, s.qty, tag);
  check(`${tag}-1`, s.persona, 'API', J, `đặt đơn lớn ${s.qty}×5L chuyển khoản, trả đủ bằng webhook ngân hàng giả`, 'BANK_TRANSFER PAID khi Pancake đối soát (bank-webhook)', !!o.code && o.st?.ps === 'PAID', `code=${o.code} total=${o.total} order=${JSON.stringify(o.st)} place=${o.pl.placeStatus} ${o.pl.placeStatus !== 201 ? JSON.stringify(o.pl.raw).slice(0, 200) : ''}`);
  if (!o.code) continue;
  const before = await pointsLedger(uid);
  const d = await deliver(o.code);
  job('DeliveredEffectsResyncCron.resyncPending');
  const u = await sql1(`SELECT "tierId" t FROM users WHERE id=$1`, uid);
  const spent = (await sql1(`SELECT COALESCE(SUM(total),0)::int s FROM orders WHERE "userId"=$1 AND status='DELIVERED'`, uid)).s;
  check(`${tag}-2`, s.persona, 'API', J, `giao xong: lên hạng ${s.expect} (chi tiêu 12 tháng ≥ ${s.minSpend})`, `membership_tiers.minSpending=${s.minSpend}`, u.t === s.expect, `SQL users.tierId trước=${tierBefore} sau=${u.t}; tổng đơn giao=${spent}`);
  const noti = await sql(`SELECT template, "createdAt" FROM notification_logs WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 20`, uid).catch((e) => [{ err: String(e).slice(0, 100) }]);
  const nfeed = (await A(s.persona, 'GET', '/me/notifications')).body;
  const items = nfeed?.items ?? nfeed?.data ?? (Array.isArray(nfeed) ? nfeed : []);
  const tierNoti = items.find((n) => /TIER_UPGRADED|lên hạng/i.test(JSON.stringify(n)));
  check(`${tag}-3`, s.persona, 'API', J, 'khách nhận thông báo trong app khi lên hạng', 'notifyTierUpgrade (loyalty.service.ts:396)', !!tierNoti, `GET /me/notifications: ${tierNoti ? JSON.stringify(tierNoti).slice(0, 300) : `không thấy; ${items.length} tin; mẫu=${JSON.stringify(items[0] ?? null).slice(0, 200)}`}`);
  // Hệ số + ưu đãi ở đơn kế
  const small = await place(s.persona, [{ vid: v5, qty: 1 }], { payment: 'BANK_TRANSFER', tag: tag + 'm' });
  const q = small.quote;
  const base = q.subtotal - (q.discount ?? 0) - (q.tierDiscount ?? 0);
  const exp = Math.floor(base * 2 / 100 * s.mult);
  check(`${tag}-4`, s.persona, 'API', J, `đơn kế: điểm tích = tiền hàng sau giảm × 2% × ${s.mult}`, `membership_tiers.pointMultiplier=${s.mult}`, q.pointsEarned === exp, `quote=${JSON.stringify({ subtotal: q.subtotal, discount: q.discount, tierDiscount: q.tierDiscount, shippingFee: q.shippingFee, total: q.total, pointsEarned: q.pointsEarned })} kỳ vọng ${exp}`);
  if (s.expect === 'CO_THU') check(`${tag}-5`, s.persona, 'API', J, 'Cổ Thụ giảm 5% mọi đơn', 'membership_tiers.discountPct=0.05', Math.abs((q.tierDiscount ?? q.discount) - Math.round(q.subtotal * 0.05)) <= 1, `tierDiscount=${q.tierDiscount} discount=${q.discount} subtotal=${q.subtotal}`);
  if (small.order) await A(s.persona, 'POST', `/orders/${codeOf(small.order)}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
  // Miễn phí giao: đơn nhỏ 79k (dưới 99k)
  const vGl = (await sql1(`SELECT id FROM variations WHERE sku='FUWA-GL-500'`)).id;
  const tiny = await place(s.persona, [{ vid: vGl, qty: 1 }], { payment: 'BANK_TRANSFER', tag: tag + 's' });
  const shipExp = s.expect === 'LOC_BIEC' ? 19000 : 0;
  check(`${tag}-6`, s.persona, 'API', J, `phí giao đơn 79.000đ (dưới 99k) ở hạng ${s.expect}`, s.expect === 'LOC_BIEC' ? 'Lộc Biếc: miễn phí giao từ 99k => đơn 79k còn phí' : 'Đại Thụ/Cổ Thụ: miễn phí giao mọi đơn', tiny.quote.shippingFee === shipExp, `quote.shippingFee=${tiny.quote.shippingFee} subtotal=${tiny.quote.subtotal} kỳ vọng ${shipExp}`);
  if (tiny.order) await A(s.persona, 'POST', `/orders/${codeOf(tiny.order)}/cancel`, { cancelReasonCode: 'CHANGED_MIND' });
  const lo = (await A(s.persona, 'GET', '/me/loyalty')).body;
  check(`${tag}-7`, s.persona, 'API', J, '/me/loyalty khớp hạng & hệ số', 'earnMultiplier theo hạng', lo.tier?.id === s.expect && lo.earnMultiplier === s.mult, `tier=${lo.tier?.id} earnMultiplier=${lo.earnMultiplier} nextTier=${JSON.stringify(lo.nextTier)}`);
}
await done();
