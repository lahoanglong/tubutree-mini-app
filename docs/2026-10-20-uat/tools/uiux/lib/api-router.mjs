// Bộ định tuyến /api/** cho harness chụp màn hình. KHÔNG bao giờ gửi request ghi (POST/PUT/PATCH/DELETE)
// tới API thật; chỉ GET dữ liệu công khai (catalog/config) được chuyển tiếp tới API local :3001 (không
// kèm Authorization). Mọi thứ khác: dữ liệu giả dựng từ kiểu TypeScript (fabricate.mjs) hoặc fixture
// tay trong sessions.mjs. Request ra host ngoài local bị chặn.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFabricator } from './fabricate.mjs';
import { artUri } from './art.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// UAT: API thật lấy từ UIUX_API (mặc định API UAT 3221), chỉ GET công khai, không kèm Authorization.
const REAL_BASE = (process.env.UIUX_API ?? 'http://127.0.0.1:3221').replace(/\/+$/, '') + '/api';

/** GET công khai chuyển tiếp tới API thật (đọc-không-ghi). */
const REAL_GET = [
  '/products',
  '/products/:slug',
  '/products/:slug/related',
  '/products/:slug/reviews',
  '/categories',
  '/brands',
  '/config/public',
  '/cashback/merchants',
  '/game/leaderboard',
];

/** Trong chế độ lỗi/loading vẫn để các GET này chạy bình thường để cô lập dữ liệu chính của trang. */
const KEEP_OK = ['/me', '/config/public', '/orders/active-count'];

function compile(pattern) {
  const keys = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${src}/?$`), keys, literals: pattern.split('/').filter((s) => s && !s.startsWith(':')).length };
}

export function loadEndpoints(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(here, '..', 'generated', file), 'utf8'));
  const list = [];
  for (const e of raw) {
    const p = e.path.replace(/(?<!\/):p\d+$/, '').replace(/\/+$/, '') || '/'; // UAT: chỉ bỏ `:pN` dính đuôi (query nối biến), giữ `/:p0` là tham số path
    list.push({ ...e, path: p, ...compile(p) });
  }
  return list;
}

function patchImages(node, seed = 'x', key = '') {
  if (Array.isArray(node)) {
    if (/^images$/i.test(key) && node.length === 0) return [artUri(seed + '1'), artUri(seed + '2'), artUri(seed + '3')];
    return node.map((x, i) => patchImages(x, seed + i, key));
  }
  if (node && typeof node === 'object') {
    const label = node.name ?? node.title ?? node.slug ?? seed;
    for (const [k, v] of Object.entries(node)) {
      if (/(thumbnail|image|avatar|cover|photo|logo|banner)/i.test(k) && !/(alt|caption|count)/i.test(k) && (v === null || v === '')) {
        node[k] = artUri(String(label), /avatar|logo/i.test(k) ? 'avatar' : 'product');
      } else node[k] = patchImages(v, String(label), k);
    }
  }
  return node;
}

function cloneLong(arr, n = 28) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = arr[i % arr.length];
    const c = JSON.parse(JSON.stringify(src));
    if (i >= arr.length) {
      for (const k of ['id', 'slug', 'code']) if (typeof c[k] === 'string') c[k] = `${c[k]}-${i}`;
    }
    if (typeof c.name === 'string')
      c.name = c.name + (i % 3 === 0 ? ' – bộ quà tặng dung tích lớn, hương tự nhiên dịu nhẹ, kèm túi giấy tái chế và thiệp viết tay' : '');
    out.push(c);
  }
  return out;
}

function transformReal(json, state, pattern) {
  let out = JSON.parse(JSON.stringify(json));
  const isList = Array.isArray(out) || (out && Array.isArray(out.data));
  if (state === 'empty' && isList) {
    if (Array.isArray(out)) out = [];
    else {
      out.data = [];
      if (out.meta) out.meta.total = 0;
    }
  }
  if (state === 'long' && isList) {
    if (Array.isArray(out) && out.length) out = cloneLong(out);
    else if (out.data?.length) {
      out.data = cloneLong(out.data);
      if (out.meta) out.meta.total = out.data.length * 2;
    }
  }
  return patchImages(out, pattern);
}

export class ApiRouter {
  /**
   * @param {object} o
   * @param {'normal'|'empty'|'loading'|'error'|'long'} o.state
   * @param {object} o.session  { user, me } từ sessions.mjs
   * @param {Array} o.endpoints  loadEndpoints()
   * @param {(ctx)=>any} [o.curated]  fixture tay: trả undefined để rơi xuống bước sau
   * @param {boolean} [o.web]
   */
  constructor({ state, session, endpoints, curated, web = false, hostAllow = ['localhost', '127.0.0.1'], products = [] }) {
    this.products = products;
    this.state = state;
    this.session = session;
    this.endpoints = endpoints;
    this.curated = curated;
    this.web = web;
    this.hostAllow = new Set(hostAllow);
    this.calls = [];
    this.unmocked = new Set();
    this.pending = new Set();
    this.realCache = new Map();
  }

  match(method, p) {
    let best;
    for (const e of this.endpoints) {
      if (e.method !== method) continue;
      const m = e.regex.exec(p);
      if (m && (!best || e.literals >= best.e.literals)) best = { e, m };
    }
    return best;
  }

  async install(page) {
    await page.route(
      (url) => !this.hostAllow.has(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => this.handle(route),
    );
  }

  async realGet(p, search) {
    const key = p + search;
    if (this.realCache.has(key)) return this.realCache.get(key);
    const res = await fetch(REAL_BASE + p + search, { signal: AbortSignal.timeout(10_000) });
    const out = { status: res.status, json: res.status === 200 ? await res.json().catch(() => null) : null };
    this.realCache.set(key, out);
    return out;
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method().toUpperCase();
    const p = url.pathname.replace(/^\/api(?=\/)/, '');
    const origin = req.headers()['origin'];
    const cors = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? 'authorization,content-type,idempotency-key,x-client,x-client-platform,x-device-id',
          vary: 'Origin',
        }
      : {};
    const send = async (status, json, source) => {
      this.calls.push({ method, path: p, status, source });
      await route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
        body: status === 204 ? '' : JSON.stringify(json ?? null),
      }).catch(() => undefined);
    };

    if (method === 'OPTIONS') return void (await route.fulfill({ status: 204, headers: cors }).catch(() => undefined));

    // Phiên
    if (p.startsWith('/auth/')) {
      if (p === '/auth/logout') return send(204, null, 'auth');
      return send(200, { accessToken: 'uiux-access', refreshToken: this.web ? '' : 'uiux-refresh', user: this.session.user }, 'auth');
    }
    if (method === 'GET' && p === '/me') return send(200, this.session.me, 'session');

    const isReadKeep = KEEP_OK.some((k) => p === k);
    if (method === 'GET' && !isReadKeep) {
      if (this.state === 'error') return send(500, { statusCode: 500, message: 'Máy chủ đang bận, vui lòng thử lại sau.' }, 'forced-error');
      if (this.state === 'offline') {
        // Mất mạng sau khi vỏ app đã tải (Zalo giữ bundle): request dữ liệu không có response, navigator.onLine = false (init script).
        this.calls.push({ method, path: p, status: 0, source: 'offline' });
        return void (await route.abort('internetdisconnected').catch(() => undefined));
      }
      if (this.state === 'loading') {
        // Không bao giờ trả lời — trang ở trạng thái loading/skeleton. Dọn khi đóng context.
        this.calls.push({ method, path: p, status: 0, source: 'hang' });
        this.pending.add(route);
        return;
      }
    }

    // Ghi: chỉ trả giả (không bao giờ chạm API thật).
    if (method !== 'GET') {
      const hit = this.match(method, p);
      if (this.curated) {
        const c = this.curated({ method, path: p, params: hit ? this.params(hit) : {}, state: this.state, body: safeJson(req.postData()) });
        if (c !== undefined) return send(c.__status ?? 200, c.__status ? c.body : c, 'curated');
      }
      if (p === '/events') return send(204, null, 'events');
      if (hit && hit.e.schema.k !== 'any') {
        const { fab } = createFabricator({ state: 'normal', seed: method + p });
        return send(200, fab(hit.e.schema, '', { depth: 0, index: 0, parentKey: '', path: [] }), 'fab-write');
      }
      return send(200, { ok: true }, 'write-ok');
    }

    // GET
    const hit = this.match('GET', p);
    if (this.curated) {
      const c = this.curated({ method, path: p, params: hit ? this.params(hit) : {}, state: this.state, query: url.searchParams });
      if (c !== undefined) return send(c.__status ?? 200, c.__status ? c.body : c, 'curated');
    }
    const isDetail = /\/:[^/]+$/.test(hit?.e.path ?? '') && !/^\/(admin|feed\/admin)\/(payroll)/.test(p);
    if (this.state === 'empty' && isDetail && !REAL_GET.includes(hit.e.path)) {
      return send(404, { statusCode: 404, message: 'Không tìm thấy dữ liệu.' }, 'empty-detail');
    }
    if (hit && REAL_GET.includes(hit.e.path)) {
      try {
        const real = await this.realGet(p, url.search);
        if (real.status === 200 && real.json !== null) {
          if (this.state === 'empty' && isDetail) return send(404, { statusCode: 404, message: 'Không tìm thấy sản phẩm.' }, 'empty-detail');
          return send(200, transformReal(real.json, this.state, p), 'real');
        }
        if (real.status === 404) return send(404, { statusCode: 404, message: 'Không tìm thấy.' }, 'real-404');
      } catch {
        /* rơi xuống fabricate */
      }
    }
    if (hit && hit.e.schema.k !== 'any') {
      const { fab } = createFabricator({ state: this.state, seed: p });
      return send(200, realism(p, fab(hit.e.schema, '', { depth: 0, index: 0, parentKey: '', path: [] }), this.products), 'fab');
    }
    this.unmocked.add(`GET ${p}`);
    return send(404, { statusCode: 404, error: 'UIUX_UNMOCKED', message: `[uiux] chưa mock GET ${p}` }, 'unmocked');
  }

  params(hit) {
    const o = {};
    hit.e.keys.forEach((k, i) => (o[k] = decodeURIComponent(hit.m[i + 1] ?? '')));
    return o;
  }

  dispose() {
    for (const r of this.pending) r.abort('aborted').catch(() => undefined);
    this.pending.clear();
  }
}

// UAT: dữ liệu giả của đơn/thanh toán dựng theo kiểu TS cho ra tổ hợp không thể có (manualHandling luôn true, 68 món,
// "Nhãn xanh" là tên ngân hàng, mọi khối hoàn tiền cùng lúc) nên che mất nút "Thanh toán ngay" và làm rối chi tiết đơn.
// Sửa cho nhất quán theo luật đã chốt (tài khoản nhận Techcombank 8386790906) để chấm đúng các màn mua lõi.
const FUTURE = () => new Date(Date.now() + 20 * 3_600_000).toISOString();
function fixOrder(o, i, products) {
  const st = ['PENDING_PAYMENT', 'SHIPPING', 'DELIVERED', 'CANCELLED'][i % 4];
  const p0 = products[i % products.length];
  const p1 = products[(i + 1) % products.length];
  const items = [p0, p1].slice(0, i % 2 === 0 ? 2 : 1).map((p, k) => {
    const unit = p.salePrice ?? p.basePrice;
    const qty = k + 1;
    return { id: `oi-${i}-${k}`, variationId: `var-${p.id}`, productName: p.name, productSlug: p.slug, variationName: 'Chai 500ml', unitPrice: unit, quantity: qty, total: unit * qty, backorderedQty: 0, thumbnail: p.thumbnail, reviewable: st === 'DELIVERED' };
  });
  const subtotal = items.reduce((a, b) => a + b.total, 0);
  const ship = subtotal >= 199000 ? 0 : 19000;
  Object.assign(o, {
    type: 'RETAIL',
    status: st,
    paymentMethod: i === 0 ? 'BANK_TRANSFER' : 'COD',
    paymentStatus: st === 'DELIVERED' ? 'PAID' : 'UNPAID',
    manualHandling: false,
    paymentDeadline: st === 'PENDING_PAYMENT' ? FUTURE() : null,
    canCancel: st === 'PENDING_PAYMENT',
    items,
    subtotal,
    discount: 0, couponDiscount: 0, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0,
    couponCode: null, groupCouponCode: null,
    shippingFee: ship,
    total: subtotal + ship,
    pointsEarned: Math.floor(subtotal * 0.02 * 1.2),
    invoiceStatus: 'NOT_REQUESTED', invoiceUrl: null,
    siblings: [],
    fulfilment: { kind: 'TUBU', name: 'Tubu Tree', phone: '0984606774' },
    shippingPartner: st === 'SHIPPING' || st === 'DELIVERED' ? 'GHN' : null,
    shippingCode: st === 'SHIPPING' || st === 'DELIVERED' ? `GHN${7000 + i}` : null,
    shippingStatus: st === 'SHIPPING' ? 'delivering' : st === 'DELIVERED' ? 'delivered' : null,
    shippingHistory: st === 'SHIPPING' || st === 'DELIVERED' ? o.shippingHistory : [],
    deliveredAt: st === 'DELIVERED' ? o.deliveredAt : null,
    hasRecyclingPickup: false, recyclingNote: null, note: null,
    pointsReturnReversed: false,
  });
  return o;
}
export function realism(p, json, products) {
  if (!json || typeof json !== 'object' || !products?.length) return json;
  if (p === '/orders' && Array.isArray(json.data)) json.data.forEach((o, i) => fixOrder(o, i, products));
  else if (/^\/orders\/[^/]+$/.test(p) && json.code && Array.isArray(json.items)) fixOrder(json, 0, products);
  else if (/^\/payments\/bank-qr\//.test(p)) {
    Object.assign(json, { amount: 798000, paymentStatus: 'UNPAID', paymentDeadline: FUTURE(), memo: json.orderCode ?? 'TUBU26100901', bank: { bin: '970407', name: 'Techcombank', accountNo: '8386790906', accountName: 'CONG TY TNHH TUBU TREE' } });
  } else if (/^\/orders\/me\/(refunds|returns)$/.test(p)) return Array.isArray(json) ? [] : { ...json, data: [] };
  return json;
}

function safeJson(s) {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
