#!/usr/bin/env node
// Dữ liệu bổ sung cho lane N (mặc định 5) qua API thật: giỏ, yêu thích, nhóm mua chung, bài cộng đồng, sự kiện, khoá học (pre);
// bật cờ chức năng, điểm nhận rác, yêu cầu đổi rác (post). In JSON các id vào tools/params.json.
// Dùng: node seed-data.mjs [--lane N] all   (hoặc từng pha: pre|post|bank|extra|flags on|off). Ghi params-lN.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, lane, sleep } from '../../2026-10-20-uat/tools/uat-harness/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const li = args.indexOf('--lane');
const LANE_N = li >= 0 ? Number(args[li + 1]) : 5;
if (li >= 0) args.splice(li, 2);
const PARAMS = path.join(HERE, `params-l${LANE_N}.json`);
const L = lane(LANE_N);
const phase = args[0];
const params = fs.existsSync(PARAMS) ? JSON.parse(fs.readFileSync(PARAMS, 'utf8')) : {};
const save = () => fs.writeFileSync(PARAMS, JSON.stringify(params, null, 2));
const call = async (user, method, p, body, headers) => {
  const r = await api(L, method, p, { user, body, headers });
  console.log(`${user} ${method} ${p} -> ${r.status}${r.ok ? '' : ' ' + JSON.stringify(r.body).slice(0, 300)}`);
  return r;
};

async function pre() {
  const prod = (await call('returning', 'GET', '/products/nuoc-rua-chen-fuwa3e')).body;
  const v1 = prod.variations[0].id;
  const prod2 = (await call('returning', 'GET', '/products/serum-duong-am-visante')).body;
  await call('returning', 'POST', '/cart/items', { variationId: v1, quantity: 2 });
  await call('returning', 'POST', '/cart/items', { variationId: prod2.variations[0].id, quantity: 1 });
  for (const id of [prod.id, prod2.id]) await call('returning', 'POST', '/me/wishlist', { productId: id });
  const g = await call('returning', 'POST', '/group-buy', { productId: prod.id });
  if (g.ok) params.groupBuyId = g.body.id ?? g.body.group?.id;
  const cats = (await call('returning', 'GET', '/feed/categories')).body;
  const post = await call('returning', 'POST', '/feed', { kind: 'QUESTION', categoryId: cats[0]?.id, title: 'Nước rửa chén Fuwa3e dùng có hại da tay không?', body: 'Mình có da nhạy cảm, muốn hỏi nước rửa chén Fuwa3e dùng hằng ngày có khô tay không ạ?' });
  if (post.ok) params.postId = post.body.id;
  if (post.ok) await call('new', 'POST', `/feed/${post.body.id}/comments`, { body: 'Mình dùng hơn 2 tháng, tay không bị khô nhé.' });
  const now = Date.now();
  const ev = await call('admin', 'POST', '/feed/events', { title: 'Khoe góc bếp xanh', description: 'Chụp góc bếp của bạn với sản phẩm Tubu Tree để nhận Điểm Xanh.', startAt: new Date(now - 864e5).toISOString(), endAt: new Date(now + 6 * 864e5).toISOString(), rewardPoints: 20000 });
  if (ev.ok) params.eventId = ev.body.id;
  const course = await call('admin', 'POST', '/admin/academy/courses', { title: 'Bán hàng tử tế cho CTV', description: 'Khoá mở đầu cho cộng tác viên mới.', isPublished: true });
  if (course.ok) {
    params.courseId = course.body.id;
    await call('admin', 'POST', `/admin/academy/courses/${course.body.id}/lessons`, { title: 'Giới thiệu Tubu Tree', contentType: 'ARTICLE', body: 'Tubu Tree là cửa hàng sản phẩm xanh...' });
  }
  save();
}

async function post() {
  const cfg = async (key, value) => call('admin', 'PUT', '/admin/config', { key, value });
  const probe = await call('admin', 'GET', '/admin/config?category=waste');
  console.log(JSON.stringify(probe.body).slice(0, 300));
  for (const [k, v] of Object.entries({ 'waste.enabled': true, 'chat.enabled': true, 'loyalty.marketplace_claim_enabled': true, 'waste.lane_pickup_enabled': true })) await cfg(k, v);
  await sleep(1500);
  const pt = await call('admin', 'POST', '/admin/waste/points', { kind: 'WAREHOUSE', name: 'Điểm nhận Tubu Quận 1', addressLine: '12 Nguyễn Huệ', provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh', communeCode: '26734', communeName: 'Phường Bến Nghé', status: 'ACTIVE', phone: '0901234567' });
  if (pt.ok) params.wastePointId = pt.body.id;
  if (!pt.ok) { const l = await call('admin', 'GET', '/admin/waste/points'); params.wastePointId = (l.body.data ?? l.body)[0]?.id; }
  await call('admin', 'POST', `/admin/waste/points/${params.wastePointId}/staff`, { userId: 'uat_staff', role: 'STAFF' });
  const items = (await call('returning', 'GET', '/waste/items')).body;
  const itemList = items.items ?? items.data ?? items;
  const itemId = itemList[0]?.id;
  console.log('waste item', itemId);
  const mk = async (qty) => {
    const lines = [{ itemId, declaredQty: qty }];
    const r = await call('returning', 'POST', '/waste/requests', { method: 'DROP_OFF', pointId: params.wastePointId, lines, consent: true }, { 'idempotency-key': `ux-waste-${qty}-${Date.now()}` });
    return r.ok ? (r.body.id ?? r.body.request?.id) : null;
  };
  params.wasteDoneId = await mk(10);
  if (params.wasteDoneId) {
    const c = await call('admin', 'POST', `/admin/waste/requests/${params.wasteDoneId}/confirm`, { lines: [{ itemId, declaredQty: 10, receivedQty: 10 }] });
    if (!c.ok) console.log('confirm lỗi, yêu cầu này vẫn mở');
  }
  params.wasteRequestId = await mk(5);
  save();
}

async function bank() {
  const cart = (await call('returning', 'GET', '/cart')).body;
  for (const it of cart.items ?? []) await call('returning', 'DELETE', `/cart/items/${it.id}`);
  const pr = (await call('returning', 'GET', '/products/nuoc-rua-chen-fuwa3e')).body;
  await call('returning', 'POST', '/cart/items', { variationId: pr.variations[0].id, quantity: 1 });
  const addrs = (await call('returning', 'GET', '/me/addresses')).body;
  const addressId = (Array.isArray(addrs) ? addrs : addrs.data ?? addrs.items ?? [])[0]?.id;
  const r = await call('returning', 'POST', '/checkout/place-order', { addressId, paymentMethod: 'BANK_TRANSFER' }, { 'idempotency-key': `ux-bank-${Date.now()}` });
  if (r.ok) params.bankOrderCode = r.body.code ?? r.body.order?.code;
  const prod = (await call('returning', 'GET', '/products/nuoc-giat-fuwa3e')).body;
  const prod2 = (await call('returning', 'GET', '/products/serum-duong-am-visante')).body;
  await call('returning', 'POST', '/cart/items', { variationId: prod.variations[0].id, quantity: 2 });
  await call('returning', 'POST', '/cart/items', { variationId: prod2.variations[0].id, quantity: 1 });
  save();
}

async function extra() {
  const items = (await call('returning', 'GET', '/waste/items')).body;
  const list = items.items ?? items.data ?? items;
  for (const it of list.slice(1)) {
    const r = await call('returning', 'POST', '/waste/requests', { method: 'DROP_OFF', pointId: params.wastePointId, lines: [{ itemId: it.id, declaredQty: 1 }], consent: true }, { 'idempotency-key': `ux-waste-x-${it.id}-${Date.now()}` });
    if (r.ok) { params.wasteRequestId = r.body.id ?? r.body.request?.id; break; }
  }
  const ol = (await call('returning', 'GET', '/orders')).body;
  const orders = Array.isArray(ol) ? ol : ol.data ?? ol.items ?? [];
  params.orderCode = (orders.find((o) => o.status === 'DELIVERED') ?? orders[0])?.code;
  save();
}

async function flags(onOff) {
  const v = onOff === 'on';
  for (const k of ['waste.enabled', 'chat.enabled', 'loyalty.marketplace_claim_enabled', 'waste.lane_pickup_enabled']) await call('admin', 'PUT', '/admin/config', { key: k, value: v });
  await sleep(8000);
}

if (phase === 'all') { await pre(); await post(); await bank(); await extra(); }
else if (phase === 'flags') await flags(args[1]);
else if (phase === 'extra') await extra();
else if (phase === 'bank') await bank();
else if (phase === 'pre') await pre();
else if (phase === 'post') await post();
else console.error('dùng: seed-data.mjs [--lane N] all|pre|post|bank|extra|flags on|off');
process.exit(0);
