// C12: bậc đại lý (DEALER_1/2/3/VIP): chiết khấu, hạn mức công nợ, kỳ hạn; giá riêng theo bậc (Variation.dealerPrices); trần chiết khấu dealer.max_discount_pct.
// Luật: prisma/seed.ts DEALER_TIERS (20% / 30% / 38% / 45%; hạn mức 0 / 20 / 50 / 150 triệu), dealer.service.ts unitPrice + dealerContext
// (chiết khấu = min(rule, dealer.max_discount_pct)). Persona dealer (SĐT 0901000006) được đổi bậc qua POST /admin/users/role rồi trả về DEALER_2.
// Chạy sau c5: node c12-dealer-tiers.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, check, done, sleep, varId, ensureAddress, idk } from './common.mjs';

const T = (title, step, expect) => ({ title, persona: 'dealer', size: 'API', journey: title, step, expect });
const PHONE = '0901000006';
const D = 'uat_dealer';
const setTier = async (tierId) => {
  const r = await call('admin', 'POST', '/admin/users/role', { phone: PHONE, role: 'DEALER', tierId });
  await sleep(6500);
  return r;
};
const priceOf = async (sku) => {
  const pl = await call('dealer', 'GET', '/dealer/pricelist');
  const rows = Array.isArray(pl.body) ? pl.body : pl.body?.items ?? pl.body?.products ?? pl.body?.rows ?? [];
  const flat = rows.flatMap((x) => (x.variations ? x.variations.map((v) => ({ ...v, sku: v.sku })) : [x]));
  const row = flat.find((x) => x.sku === sku);
  return { status: pl.status, row, price: row?.dealerPrice ?? row?.price ?? row?.unitPrice ?? row?.wholesalePrice };
};

const tiers = await sql(`SELECT id, "discountRules"->>'default' d, "creditLimit"::int c, "paymentTerms" t FROM dealer_tiers ORDER BY "minOrderVolume"`);
const [cfg] = await sql(`SELECT value FROM system_configs WHERE key='dealer.max_discount_pct'`).catch(() => [{ value: 0.45 }]);
const cap = Number(cfg?.value ?? 0.45);
const retail = Object.fromEntries((await sql(`SELECT sku, "retailPrice"::int p FROM variations WHERE sku IN ('SOK-CT-150','POLANG-SP-500')`)).map((r) => [r.sku, r.p]));
await ensureAddress('dealer');

try {
  for (const t of tiers) {
    const set = await setTier(t.id);
    const me = await call('dealer', 'GET', '/dealer/me');
    const disc = Math.min(Number(t.d), cap);
    const probs = [];
    if (!set.ok) probs.push(`đổi bậc ${set.status} ${short(set.body, 100)}`);
    if (me.body?.tier?.id !== t.id) probs.push(`tier.id=${me.body?.tier?.id}`);
    if (me.body?.tier?.creditLimit !== t.c) probs.push(`creditLimit=${me.body?.tier?.creditLimit} ≠ ${t.c}`);
    for (const sku of ['SOK-CT-150', 'POLANG-SP-500']) {
      const p = await priceOf(sku);
      const want = Math.round(retail[sku] * (1 - disc));
      if (p.price !== want) probs.push(`${sku}: giá ${p.price} ≠ ${want} (retail ${retail[sku]} × ${1 - disc})`);
    }
    check(`L6-V0${tiers.indexOf(t) + 1}`, T(`Bậc ${t.id}: chiết khấu ${Math.round(disc * 100)}%, hạn mức ${t.c.toLocaleString('vi-VN')}đ, kỳ hạn ${t.t}`, `POST /admin/users/role tierId=${t.id}; GET /dealer/me, /dealer/pricelist`, `tier.id=${t.id}; creditLimit=${t.c}; giá sỉ = round(giá lẻ × ${1 - disc}) cho SOK-CT-150 (${retail['SOK-CT-150']}) và POLANG-SP-500 (${retail['POLANG-SP-500']})`), probs.length === 0, probs.length ? probs.join(' | ') : `đúng: ${short({ tier: me.body.tier.id, limit: me.body.tier.creditLimit, terms: me.body.tier.paymentTerms })}`, 'API + SQL dealer_tiers');
  }

  // ---------- DEALER_1: hạn mức 0, chỉ trả trước ----------
  await setTier('DEALER_1');
  const addressId = await ensureAddress('dealer');
  const vid = await varId('SOK-CT-150');
  const credit = await call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: vid, quantity: 40 }], paymentMethod: 'CREDIT', addressId }, { 'idempotency-key': idk('l6v') });
  const [dOrders] = await sql(`SELECT count(*)::int n FROM orders WHERE "userId"=$1 AND "paymentMethod"::text='CREDIT' AND "createdAt" > now() - interval '1 minute'`, D);
  check('L6-V05', T('Đại lý Cấp 1 (hạn mức 0, trả trước): đặt đơn công nợ bị từ chối', 'POST /dealer/orders paymentMethod=CREDIT (40×SOK-CT-150 ≈ 3,17 triệu)', '400 nói rõ vượt hạn mức/không có công nợ; không tạo đơn CREDIT; sổ công nợ không đổi'), credit.status === 400 && dOrders.n === 0, `${credit.status} ${short(credit.body?.message ?? credit.body, 240)}; đơn CREDIT mới=${dOrders.n}`, 'API + SQL');
  const prepaid = await call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: vid, quantity: 40 }], paymentMethod: 'PREPAID', addressId }, { 'idempotency-key': idk('l6v') });
  const [po] = prepaid.body?.id ? await sql(`SELECT total::int t, status::text s FROM orders WHERE id=$1`, prepaid.body.id) : [];
  const want1 = Math.round(retail['SOK-CT-150'] * 0.8) * 40;
  check('L6-V06', T('Đại lý Cấp 1: đơn trả trước tính đúng giá bậc 20%', 'POST /dealer/orders PREPAID 40×SOK-CT-150', `201; tổng = 40 × round(99.000 × 0,8) = ${want1.toLocaleString('vi-VN')}đ (đơn ≥ 3 triệu, ≥ 5 triệu miễn phí giao nên cộng phí giao 19.000đ nếu < 5 triệu)`), prepaid.status === 201 && po && (po.t === want1 + 19_000 || po.t === want1), `${prepaid.status}; tổng=${po?.t}; giá trị hàng kỳ vọng ${want1}`, 'SQL');
  if (prepaid.body?.id) await call('admin', 'PUT', `/admin/orders/${prepaid.body.id}/status`, { status: 'CANCELLED', note: 'UAT dọn' }).catch(() => undefined);

  // ---------- giá riêng theo bậc ----------
  await setTier('DEALER_3');
  const prev = await call('admin', 'POST', '/admin/dealer-prices/import/preview', { tierId: 'DEALER_3', csv: 'SOK-CT-150,60000' });
  const badPrev = await call('admin', 'POST', '/admin/dealer-prices/import/preview', { tierId: 'DEALER_3', csv: 'SOK-CT-150,-5\nKHONG-CO-SKU,1000' });
  const imp = await call('admin', 'POST', '/admin/dealer-prices/import', { tierId: 'DEALER_3', csv: 'SOK-CT-150,60000' });
  await sleep(6500);
  const o3 = await priceOf('SOK-CT-150');
  const o3b = await priceOf('POLANG-SP-500');
  const hist = await call('admin', 'GET', '/admin/dealer-prices/history');
  check('L6-V07', T('Giá riêng theo bậc: nhập 60.000đ cho SOK-CT-150 bậc DEALER_3 → đại lý bậc đó thấy đúng giá, SP khác vẫn theo %; dòng sai bị chặn khi xem trước', 'POST /admin/dealer-prices/import/preview + import rồi GET /dealer/pricelist', 'preview hợp lệ canApply; preview giá âm/SKU lạ có lỗi chặn; sau import giá SOK-CT-150 = 60.000đ, POLANG-SP-500 vẫn = round(245.000 × 0,62); có dòng lịch sử'),
    prev.ok && prev.body?.canApply === true && badPrev.body?.blocking > 0 && badPrev.body?.canApply === false && imp.ok && o3.price === 60_000 && o3b.price === Math.round(retail['POLANG-SP-500'] * 0.62), `preview=${short({ ok: prev.body?.canApply, counts: prev.body?.counts })}; xấu=${short({ b: badPrev.body?.blocking, c: badPrev.body?.counts })}; import=${imp.status}; giá=${o3.price}/${o3b.price}; lịch sử=${short(hist.body?.items?.length ?? hist.body?.length ?? hist.status)}`, 'API');
  const order60 = await call('dealer', 'POST', '/dealer/orders', { items: [{ variationId: vid, quantity: 60 }], paymentMethod: 'PREPAID', addressId }, { 'idempotency-key': idk('l6v') });
  const [li] = order60.body?.id ? await sql(`SELECT "unitPrice"::int u, quantity::int q, total::int t FROM order_items WHERE "orderId"=$1`, order60.body.id) : [];
  check('L6-V08', T('Đơn đại lý dùng giá riêng theo bậc đã nhập', 'POST /dealer/orders 60×SOK-CT-150 (bậc DEALER_3 giá 60.000đ)', 'unitPrice=60.000đ, dòng = 3.600.000đ'), order60.status === 201 && li?.u === 60_000 && li.t === 3_600_000, `${order60.status} ${short(li)}`, 'SQL');
  if (order60.body?.id) await call('admin', 'PUT', `/admin/orders/${order60.body.id}/status`, { status: 'CANCELLED', note: 'UAT dọn' }).catch(() => undefined);
  await exec(`UPDATE variations SET "dealerPrices" = NULL WHERE sku='SOK-CT-150'`);

  // ---------- trần chiết khấu ----------
  await setTier('DEALER_VIP');
  const cfgSet = await call('admin', 'PUT', '/admin/config', { key: 'dealer.max_discount_pct', value: 0.4 });
  await sleep(6500);
  const capped = await priceOf('POLANG-SP-500');
  const cfgBad = await call('admin', 'PUT', '/admin/config', { key: 'dealer.max_discount_pct', value: 1.5 });
  await call('admin', 'PUT', '/admin/config', { key: 'dealer.max_discount_pct', value: cap });
  await sleep(6500);
  const back = await priceOf('POLANG-SP-500');
  check('L6-V09', T('Trần chiết khấu dealer.max_discount_pct: bậc VIP 45% bị kẹp về 40% khi trần hạ; giá trị ngoài khoảng 0-1 bị từ chối; trả trần về thì giá về cũ', 'PUT /admin/config dealer.max_discount_pct 0.4 rồi 1.5 rồi trả về', `giá POLANG-SP-500 bậc VIP: ${Math.round(retail['POLANG-SP-500'] * 0.6)} khi trần 0.4; ${Math.round(retail['POLANG-SP-500'] * (1 - cap))} khi trần ${cap}; 1.5 → 400`),
    cfgSet.ok && capped.price === Math.round(retail['POLANG-SP-500'] * 0.6) && cfgBad.status === 400 && back.price === Math.round(retail['POLANG-SP-500'] * (1 - cap)), `đặt 0.4 → ${cfgSet.status}; giá=${capped.price}; 1.5 → ${cfgBad.status} ${short(cfgBad.body?.message, 100)}; trả ${cap} → giá=${back.price}`, 'API');
} finally {
  await setTier('DEALER_2');
  await call('admin', 'PUT', '/admin/config', { key: 'dealer.max_discount_pct', value: cap }).catch(() => undefined);
  await exec(`UPDATE variations SET "dealerPrices" = NULL WHERE sku='SOK-CT-150'`).catch(() => undefined);
}
const me = await call('dealer', 'GET', '/dealer/me');
check('L6-V10', T('Trả persona đại lý về DEALER_2 sau khi thử bậc', 'POST /admin/users/role DEALER_2; GET /dealer/me', 'tier DEALER_2, hạn mức 20.000.000đ'), me.body?.tier?.id === 'DEALER_2' && me.body?.tier?.creditLimit === 20_000_000, short(me.body?.tier), 'API');
await done();
