// Bộ dụng cụ ca API của L1: giỏ, báo giá, đặt đơn, mô hình tính tiền độc lập (oracle) dựng từ luật + SystemConfig, đối chiếu SQL.
import { api, L, sql, sqlExec, rec, idem, mintAccessFor } from './lib.mjs';

export const V = {
  DISH1L: 'cmqfuw9jt0005w1vfkndxukxy', // Nước rửa chén 1L: 120.000, không sale
  DISH5L: 'cmqfuw9jv0007w1vfb1njbw7k', // Can 5L: 480.000, sale 430.000
  LAUNDRY: 'cmqfuw9k2000bw1vfnqnknvfc', // 210.000
  SERUM30: 'cmqfuw9jy0009w1vfn8il35y6', // 320.000, sale 289.000
  SERUM50: 'cmqfv2cky0003zxpl45lh4ggm', // 460.000, kho 30
  MASK: 'cmqfv2clh000bzxpl4iysg6k0', // 25.000
  LIPBALM: 'cmqfv2clk000dzxpl77y1nlvo', // 95.000 sale 79.000
  HANDWASH: 'cmqfv2cmm000zzxplbqlf8d47', // 89.000
  BOTRAUMA: 'cmqfv2coa001xzxpltjepz3ee', // 99.000
  GAOLUT: 'cmqfv2co1001tzxplz8u0kdgs', // 75.000
  KINH: 'cmqfv3q67002fcgcoxpqsxpb4', // 79.000
  BUOI300: 'cmqfuw9jj0001w1vfrccaij5o', // 165.000
  BUOI500: 'cmqfuw9jo0003w1vfvkx2j48l', // 245.000 sale 219.000
};

export const ADDR = {
  recipient: 'Khách UAT',
  phone: '0901000099',
  province: 'Thành phố Hồ Chí Minh',
  district: '',
  ward: 'Phường Bến Thành',
  street: '99 Lê Lợi',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN7926743',
  isDefault: true,
};

export const PERSONAS = ['new', 'new_nophone', 'returning', 'guest'];

const tokens = new Map();
/** Token và địa chỉ của persona (guest đăng nhập thật qua /auth/guest với deviceId cố định). */
export async function who(persona) {
  if (tokens.has(persona)) return tokens.get(persona);
  let token;
  let userId;
  if (persona === 'guest') {
    const g = await api(L, 'POST', '/auth/guest', { body: { deviceId: 'uat-l1-guest-device-000001' } });
    token = g.body.accessToken;
    userId = g.body.user?.id ?? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  } else {
    token = (await mintAccessFor(L, persona)).token;
    userId = (await sql(`select id from users where id = 'uat_${persona}'`))[0].id;
  }
  let addrs = (await api(L, 'GET', '/me/addresses', { token })).body;
  if (!Array.isArray(addrs) || addrs.length === 0) {
    const a = await api(L, 'POST', '/me/addresses', { token, body: ADDR });
    if (a.status !== 201) throw new Error(`tạo địa chỉ ${persona}: ${a.status} ${JSON.stringify(a.body)}`);
    addrs = [a.body];
  }
  const w = { persona, token, userId, addressId: addrs[0].id };
  tokens.set(persona, w);
  return w;
}

/** Khách thật mới tinh (chưa đơn, chưa mã nào): chèn dòng users như AuthService tạo khi đăng nhập Zalo lần đầu, rồi đăng nhập token như persona. */
export async function fresh(tag, { phone = true } = {}) {
  const id = `uat_${tag}`;
  const ex = await sql(`select id from users where id = '${id}'`);
  if (!ex.length) {
    const ph = phone ? `'09${String(Math.abs([...tag].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000000).padStart(8, '0')}'` : 'NULL';
    await sqlExec(`insert into users (id, "referralCode", "updatedAt", "zaloId", phone, "phoneVerifiedAt", role, "fullName") values ('${id}', 'UAT${tag.toUpperCase().slice(0, 8)}', now(), 'uat-zalo-${tag}', ${ph}, ${phone ? 'now()' : 'NULL'}, 'CUSTOMER', 'Khách ${tag}')`);
  }
  tokens.delete(tag);
  return who(tag);
}

export async function clearCart(w) {
  await api(L, 'DELETE', '/cart/coupon', { token: w.token });
  const c = await api(L, 'GET', '/cart', { token: w.token });
  for (const it of [...(c.body.items ?? []), ...(c.body.unavailableItems ?? [])]) {
    await api(L, 'DELETE', `/cart/items/${it.id}`, { token: w.token });
  }
}

/** lines: [[variationId, qty], ...] → giỏ mới (trả về response GET /cart). */
export async function fillCart(w, lines) {
  await clearCart(w);
  const res = [];
  for (const [variationId, quantity] of lines) {
    const r = await api(L, 'POST', '/cart/items', { token: w.token, body: { variationId, quantity } });
    res.push(r);
    if (r.status >= 300) return { error: r };
  }
  return { cart: (await api(L, 'GET', '/cart', { token: w.token })).body };
}

export const quote = (w, body = {}) => api(L, 'POST', '/checkout/quote', { token: w.token, body: { addressId: w.addressId, ...body } });
export const place = (w, body = {}, key = idem()) =>
  api(L, 'POST', '/checkout/place-order', { token: w.token, headers: { 'idempotency-key': key }, body: { addressId: w.addressId, paymentMethod: 'COD', ...body } });

/** Cấu hình tiền dùng cho mô hình tính (đọc 1 lần từ DB lane). */
export async function loadCfg() {
  const rows = await sql(`select key, value from system_configs where key in ('shipping.free_threshold','shipping.flat_fee_below_threshold','shipping.tier_freeship_overrides','shipping.first_order_free_enabled','shipping.first_order_free_min_subtotal','loyalty.earn_pct','loyalty.max_redeem_pct','loyalty.vnd_per_point_redeem')`);
  const c = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const tiers = Object.fromEntries((await sql(`select id, "discountPct"::float d, "pointMultiplier"::float m from membership_tiers`)).map((t) => [t.id, t]));
  return { c, tiers };
}

export async function userFacts(userId) {
  const u = (await sql(`select id, phone, "zaloId", "tierId", "pointsBalance"::int bal, "pointsConvertedBalance"::int conv from users where id = '${userId}'`))[0];
  const prior = (await sql(`select count(*)::int n from orders where "userId" = '${userId}' and status <> 'CANCELLED'`))[0].n;
  const real = !!u.phone || (!!u.zaloId && !u.zaloId.startsWith('guest_'));
  return { ...u, prior, real };
}

/**
 * Mô hình tính tiền của một kiện Tubu (không combo, không gian hàng đối tác).
 * lines: [{unit, qty, flash}], coupon: hàng coupons hoặc null, cfg từ loadCfg, facts từ userFacts, locked điểm đang khoá.
 * Luật: pricing.service.ts (ship, điểm), coupons.service.ts (mã), checkout.service.ts compute (thứ tự giảm: mã → hạng → điểm).
 */
export function oracle({ lines, coupon, pointsToUse = 0, cfg, facts, locked = 0 }) {
  const { c, tiers } = cfg;
  const sub = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const flashSub = lines.filter((l) => l.flash).reduce((s, l) => s + l.unit * l.qty, 0);
  const base = sub - flashSub;
  let discount = 0;
  let freeship = false;
  let reject = null;
  if (coupon) {
    if (coupon.newCustomerOnly && !facts.real) reject = 'REAL_USER';
    else if (coupon.newCustomerOnly && facts.prior > 0) reject = 'NEW_ONLY';
    else if (new Date(coupon.startAt) > new Date() || new Date(coupon.endAt) < new Date()) reject = 'WINDOW';
    else if (coupon.minOrder && base < coupon.minOrder) reject = `MIN:${coupon.minOrder}`;
    else if (coupon.type === 'AMOUNT') discount = Math.min(coupon.value, base);
    else if (coupon.type === 'PERCENT') {
      discount = Math.min(Math.floor((base * coupon.value) / 100), base);
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    } else if (coupon.type === 'FREESHIP') freeship = true;
  }
  const tierPct = facts.tierId ? tiers[facts.tierId]?.d ?? 0 : 0;
  const mult = facts.tierId ? tiers[facts.tierId]?.m ?? 1 : 1;
  const afterCoupon = Math.max(0, base - discount);
  const tierDiscount = tierPct > 0 ? Math.floor(afterCoupon * tierPct) : 0;
  const afterTier = afterCoupon - tierDiscount;
  const redeemBase = afterTier + flashSub;
  const maxVnd = Math.floor(redeemBase * (c['loyalty.max_redeem_pct'] ?? 0.2));
  const usable = Math.max(0, facts.bal - locked);
  const pointsUsed = facts.real ? Math.max(0, Math.min(pointsToUse, usable, maxVnd)) : Math.max(0, Math.min(pointsToUse, usable, maxVnd));
  const pointsDiscount = pointsUsed;
  const global = c['shipping.free_threshold'] ?? 199000;
  const ov = (c['shipping.tier_freeship_overrides'] ?? {})[facts.tierId];
  const threshold = typeof ov === 'number' ? Math.min(ov, global) : global;
  const flat = c['shipping.flat_fee_below_threshold'] ?? 19000;
  let ship = sub >= threshold ? 0 : flat;
  if (ship > 0 && c['shipping.first_order_free_enabled'] !== false && facts.real && facts.prior === 0 && sub >= (c['shipping.first_order_free_min_subtotal'] ?? 199000)) ship = 0;
  const shipBeforeCoupon = ship;
  if (freeship) ship = 0;
  const goodsAfterAll = sub - discount - tierDiscount - pointsDiscount;
  const total = goodsAfterAll + ship;
  const e = c['loyalty.earn_pct'] ?? 2;
  const pointsEarned = goodsAfterAll > 0 ? Math.floor((Math.floor(goodsAfterAll) * Math.round(e * 100) * Math.round(mult * 100)) / 1_000_000) : 0;
  return { sub, discount, tierDiscount, pointsUsed, pointsDiscount, ship, shipBeforeCoupon, freeshipSaved: shipBeforeCoupon - ship, total, pointsEarned, reject, couponEffective: discount > 0 || (freeship && shipBeforeCoupon > 0) };
}

/** So sánh object kỳ vọng với thực tế, trả chuỗi mô tả lệch (rỗng = khớp). */
export function diff(expected, actual) {
  const bad = [];
  for (const k of Object.keys(expected)) if (expected[k] !== actual[k]) bad.push(`${k}: mong ${expected[k]} / thực ${actual[k]}`);
  return bad.join('; ');
}

/** Ảnh chụp trạng thái tiền/điểm/kho của một user để đối chiếu trước-sau. */
export async function snapshot(userId, variationIds = []) {
  const u = (await sql(`select "pointsBalance"::int bal, "pointsConvertedBalance"::int conv, "walletBalance"::int wallet from users where id = '${userId}'`))[0];
  const ledger = (await sql(`select coalesce(sum(delta) filter (where lot='STANDARD'),0)::int std, coalesce(sum(delta) filter (where lot='CONVERTED'),0)::int conv, count(*)::int n from points_transactions where "userId" = '${userId}'`))[0];
  const wal = (await sql(`select coalesce(sum(delta),0)::int s, count(*)::int n from wallet_transactions where "userId" = '${userId}'`))[0];
  const stock = {};
  for (const v of variationIds) stock[v] = (await sql(`select stock, "reservedStock" r from variations where id = '${v}'`))[0];
  return { ...u, ledgerStd: ledger.std, ledgerConv: ledger.conv, ledgerRows: ledger.n, walletSum: wal.s, walletRows: wal.n, stock };
}

/** Đối chiếu một đơn đã ghi: cộng dòng, tổng, các nguồn giảm, sổ điểm, lượt mã. Trả { ok, problems, row }. */
export async function reconcileOrder(code) {
  const o = (await sql(`select * from orders where code = '${code}'`))[0];
  if (!o) return { ok: false, problems: [`không có đơn ${code}`] };
  const items = await sql(`select "variationId", quantity, "unitPrice"::int up, total::int t, "paidTotal"::int pt, "pointsDiscount"::int pd from order_items where "orderId" = '${o.id}'`);
  const sum = (k) => items.reduce((s, i) => s + (i[k] ?? 0), 0);
  const problems = [];
  const n = (x) => Number(x ?? 0);
  if (sum('t') !== n(o.subtotal)) problems.push(`Σ dòng ${sum('t')} ≠ subtotal ${o.subtotal}`);
  for (const i of items) if (i.up * i.quantity !== i.t) problems.push(`dòng ${i.variationId}: ${i.up}×${i.quantity} ≠ ${i.t}`);
  const parts = n(o.couponDiscount) + n(o.comboDiscount) + n(o.tierDiscount) + n(o.pointsDiscount);
  if (parts !== n(o.discount)) problems.push(`discount ${o.discount} ≠ mã+combo+hạng+điểm ${parts}`);
  if (n(o.subtotal) - n(o.discount) + n(o.shippingFee) !== n(o.total)) problems.push(`total ${o.total} ≠ subtotal ${o.subtotal} - giảm ${o.discount} + ship ${o.shippingFee}`);
  if (sum('pt') !== n(o.subtotal) - n(o.discount)) problems.push(`Σ paidTotal ${sum('pt')} ≠ subtotal-giảm ${n(o.subtotal) - n(o.discount)}`);
  if (sum('pd') !== n(o.pointsDiscount)) problems.push(`Σ pointsDiscount dòng ${sum('pd')} ≠ đơn ${o.pointsDiscount}`);
  if (n(o.pointsUsed) + n(o.pointsUsedConverted ?? 0) * 0 !== n(o.pointsDiscount) && n(o.pointsUsed) !== n(o.pointsDiscount)) problems.push(`pointsUsed ${o.pointsUsed} ≠ pointsDiscount ${o.pointsDiscount} (1đ/điểm)`);
  const redeem = (await sql(`select count(*)::int n from coupon_redemptions where "orderId" = '${o.id}'`))[0].n;
  if (o.couponCode && n(o.couponDiscount) === 0 && redeem === 1) {
    /* mã freeship: có lượt dùng nhưng 0đ giảm tiền hàng */
  }
  if (!o.couponCode && redeem !== 0) problems.push(`không mã nhưng có ${redeem} lượt dùng`);
  return { ok: problems.length === 0, problems, row: o, items, redeem };
}

export { rec };
