#!/usr/bin/env node
// Giả Pancake POS Open API cho một lane: node fake-pancake.mjs <lane>  (cổng 32{N}8, tiền tố /api/v1 như PANCAKE_BASE_URL).
// Phục vụ đúng các lời gọi của apps/api/src/modules/integrations/pancake/pancake.client.ts:
//   GET  /geo/provinces, /geo/communes?province_id=         (form địa chỉ)
//   GET  /shops/:shop/products, /shops/:shop/categories     (đồng bộ danh mục: trả rỗng để không đụng catalog seed)
//   POST /shops/:shop/orders                                (đẩy đơn app; lưu vào app-orders.json, cấp id)
//   GET  /shops/:shop/orders/:id, PUT /shops/:shop/orders/:id
//   GET  /shops/:shop/orders?search=...                     (tra theo mã đơn Tubu / SĐT / mã vận đơn / mã đơn sàn)
//   GET  /shops/:shop/orders?updateStatus=updated_at&startDateTime=&order_sources[]=  (kéo dự phòng đơn sàn)
// Đơn ngoài app (sàn/chat) đọc từ platform-orders.json mỗi request — sửa file là có hiệu lực ngay.
// Cổng phụ cho bộ khung (không phải API Pancake): /__uat/state, /__uat/find?code=, /__uat/app-orders/:id (POST đổi trường), /__uat/requests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS, lane, laneEnv } from './lib.mjs';
import { makePlatformOrders } from './fixtures/platform-orders.mjs';

const L = lane(process.argv[2]);
const env = laneEnv(L);
const KEY = env.PANCAKE_API_KEY;
const SHOP = env.PANCAKE_SHOP_ID;
fs.mkdirSync(L.pancakeDir, { recursive: true });
const APP_FILE = path.join(L.pancakeDir, 'app-orders.json');
const PLATFORM_FILE = path.join(L.pancakeDir, 'platform-orders.json');
const LOG_FILE = path.join(L.pancakeDir, 'requests.jsonl');
const GEO = JSON.parse(fs.readFileSync(path.join(HARNESS, 'fixtures/geo.json'), 'utf8'));

if (!fs.existsSync(PLATFORM_FILE)) fs.writeFileSync(PLATFORM_FILE, `${JSON.stringify(makePlatformOrders(), null, 2)}\n`);
if (!fs.existsSync(APP_FILE)) fs.writeFileSync(APP_FILE, `${JSON.stringify({ nextId: 9_100_001 + L.n * 100_000, orders: {} }, null, 2)}\n`);

const readJson = (f, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return dflt;
  }
};
const appStore = () => readJson(APP_FILE, { nextId: 9_100_001, orders: {} });
const saveApp = (s) => fs.writeFileSync(APP_FILE, `${JSON.stringify(s, null, 2)}\n`);
const platformOrders = () => readJson(PLATFORM_FILE, []);

function vnNow() {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19);
}

const STATUS_NAME = { 0: 'Mới', 1: 'Đã xác nhận', 2: 'Đã gửi hàng', 3: 'Đã nhận', 4: 'Đang hoàn', 5: 'Đã hoàn', 6: 'Đã hủy', 7: 'Đã xóa', 8: 'Đang đóng hàng', 9: 'Chờ chuyển hàng', 12: 'Chờ in', 13: 'Đã in', 15: 'Hoàn một phần', 16: 'Đã thu tiền', 17: 'Chờ xác nhận', 20: 'Đã đặt hàng' };

function codeOf(o) {
  if (o.custom_id) return o.custom_id;
  if (o.extension?.external_order_id) return o.extension.external_order_id;
  const m = typeof o.note === 'string' ? o.note.match(/Order code:\s*([A-Z]+\d+)/) : null;
  return m ? m[1] : null;
}

const norm = (s) => String(s ?? '').toUpperCase().replace(/[\s_-]+/g, '');

function matchesSearch(o, text) {
  const t = String(text).trim();
  if (!t) return true;
  const n = norm(t);
  const hay = [
    codeOf(o),
    o.note,
    o.bill_phone_number,
    o.shipping_address?.phone_number,
    o.partner?.extend_code,
    o.tracking_number,
    o.order_number_vtp,
    ...(Array.isArray(o.invoice_info_list) ? o.invoice_info_list.map((i) => i?.order_sn) : []),
    o.bill_full_name,
  ].filter(Boolean);
  return hay.some((h) => norm(h).includes(n) || String(h).includes(t));
}

function buildAppOrder(id, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const totalPrice = items.reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.variation_info?.retail_price ?? 0), 0);
  const eachDiscount = items.reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.discount_each_product ?? 0), 0);
  const totalDiscount = Number(body.total_discount ?? 0);
  const now = vnNow();
  return {
    ...body,
    id,
    status: 0,
    status_name: STATUS_NAME[0],
    total_price: totalPrice,
    total_discount: totalDiscount + eachDiscount,
    total_price_after_sub_discount: totalPrice - totalDiscount - eachDiscount,
    shipping_fee: Number(body.shipping_fee ?? 0),
    prepaid: Number(body.transfer_money ?? 0),
    bank_payment: 0,
    inserted_at: now,
    updated_at: now,
    status_history: [{ status: 0, updated_at: now }],
  };
}

function applyUpdate(o, patch) {
  const next = { ...o, ...patch, updated_at: vnNow() };
  if (patch.status !== undefined && Number(patch.status) !== Number(o.status)) {
    next.status = Number(patch.status);
    next.status_name = STATUS_NAME[next.status] ?? String(next.status);
    next.status_history = [...(o.status_history ?? []), { status: next.status, updated_at: next.updated_at }];
  }
  if (patch.transfer_money !== undefined) next.prepaid = Number(patch.transfer_money);
  return next;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function log(entry) {
  fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${L.pancakePort}`);
  const p = url.pathname;
  const body = req.method === 'GET' ? undefined : await readBody(req);
  let status = 200;
  let out;
  try {
    if (p.startsWith('/__uat/')) {
      [status, out] = uat(req.method, p, url, body);
    } else if (p.startsWith('/gomdon-disabled')) {
      [status, out] = [503, { success: false, message: 'Gomdon tắt trong lane UAT' }];
    } else if (!p.startsWith('/api/v1/')) {
      [status, out] = [404, { success: false, message: 'not found' }];
    } else if (url.searchParams.get('api_key') !== KEY) {
      [status, out] = [401, { success: false, error: 'invalid_api_key', message: 'api_key không đúng' }];
    } else {
      [status, out] = pancake(req.method, p.slice('/api/v1'.length), url, body);
    }
  } catch (err) {
    [status, out] = [500, { success: false, message: String(err?.message ?? err) }];
  }
  log({ method: req.method, path: p, query: Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'api_key')), body, status });
  send(res, status, out);
});

function pancake(method, p, url, body) {
  if (method === 'GET' && p === '/geo/provinces') return [200, { success: true, data: GEO.provinces }];
  if (method === 'GET' && p === '/geo/communes') {
    const pid = url.searchParams.get('province_id');
    return [200, { success: true, data: (GEO.communes[pid] ?? []).map((c) => ({ ...c, province_id: pid, district_id: null })) }];
  }
  const shop = p.match(/^\/shops\/([^/]+)(\/.*)$/);
  if (!shop) return [404, { success: false, message: 'not found' }];
  if (shop[1] !== SHOP) return [404, { success: false, error: 'shop_not_found', message: `shop ${shop[1]} không tồn tại` }];
  const rest = shop[2];
  if (method === 'GET' && rest === '/products') return [200, { success: true, data: [] }];
  if (method === 'GET' && rest === '/categories') return [200, { success: true, data: [] }];
  if (method === 'POST' && rest === '/orders') {
    const s = appStore();
    const id = String(s.nextId++);
    s.orders[id] = buildAppOrder(id, body ?? {});
    saveApp(s);
    return [200, { success: true, data: s.orders[id] }];
  }
  if (method === 'GET' && rest === '/orders') {
    const all = [...Object.values(appStore().orders), ...platformOrders()];
    if (url.searchParams.get('updateStatus') === 'updated_at') {
      const since = Number(url.searchParams.get('startDateTime') ?? 0) * 1000;
      const sources = url.searchParams.getAll('order_sources[]').map(String);
      const size = Number(url.searchParams.get('page_size') ?? 50);
      const page = Number(url.searchParams.get('page_number') ?? 1);
      const hit = platformOrders().filter(
        (o) => (sources.length === 0 || sources.includes(String(o.order_sources))) && new Date(`${o.updated_at}+07:00`).getTime() >= since,
      );
      return [200, { success: true, data: hit.slice((page - 1) * size, page * size) }];
    }
    const text = url.searchParams.get('search') ?? '';
    return [200, { success: true, data: all.filter((o) => matchesSearch(o, text)).slice(0, 50) }];
  }
  const one = rest.match(/^\/orders\/([^/]+)$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    const s = appStore();
    const plat = platformOrders().find((o) => String(o.id) === id);
    const o = s.orders[id] ?? plat;
    if (!o) return [404, { success: false, error: 'order_not_found', message: 'Không tìm thấy đơn' }];
    if (method === 'GET') return [200, { success: true, data: o }];
    if (method === 'PUT') {
      if (!s.orders[id]) return [400, { success: false, message: 'Bộ khung chỉ cho sửa đơn app qua PUT' }];
      s.orders[id] = applyUpdate(s.orders[id], body ?? {});
      saveApp(s);
      return [200, { success: true, data: s.orders[id] }];
    }
  }
  return [404, { success: false, message: `chưa giả ${method} ${p}` }];
}

function uat(method, p, url, body) {
  if (p === '/__uat/state') return [200, { appOrders: appStore().orders, platformOrders: platformOrders() }];
  if (p === '/__uat/find') {
    const code = url.searchParams.get('code') ?? '';
    const app = Object.values(appStore().orders).find((o) => codeOf(o) === code || String(o.id) === code);
    if (app) return [200, { kind: 'app', order: app }];
    const plat = platformOrders().find((o) => String(o.id) === code || matchesSearch(o, code));
    return plat ? [200, { kind: 'platform', order: plat }] : [404, { message: `không thấy ${code}` }];
  }
  const m = p.match(/^\/__uat\/app-orders\/([^/]+)$/);
  if (m && method === 'POST') {
    const s = appStore();
    const o = s.orders[m[1]];
    if (!o) return [404, { message: 'không thấy đơn app' }];
    s.orders[m[1]] = applyUpdate(o, body ?? {});
    saveApp(s);
    return [200, s.orders[m[1]]];
  }
  if (m && method === 'PUT') {
    const s = appStore();
    s.orders[m[1]] = body;
    saveApp(s);
    return [200, body];
  }
  if (p === '/__uat/requests') {
    const n = Number(url.searchParams.get('n') ?? 30);
    const lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n') : [];
    return [200, lines.slice(-n).map((l) => JSON.parse(l))];
  }
  return [404, { message: 'không có' }];
}

server.listen(L.pancakePort, '127.0.0.1', () => {
  console.log(`giả Pancake lane ${L.n} nghe 127.0.0.1:${L.pancakePort} (shop ${SHOP}); dữ liệu ${L.pancakeDir}`);
});
