// Thư viện chung cho các ca UAT lane 6 (khách trên web). Mọi ca chạy trên lane 6: API 3261, web 3262, Mini App 3263, DB tubutree_uat_l6.
// Bật lane trước:  bash docs/2026-10-20-uat/tools/uat-harness/lane-up.sh 6 --web
// Chạy một nhóm ca: node docs/2026-10-20-uat/uat/scripts/U6-web-khach/<tên>.mjs ; chạy hết: node .../run-all.mjs
// Mỗi nhóm ghi kết quả JSON vào results/<nhóm>.json (ID ca, kỳ vọng, thực tế, bằng chứng, PASS/FAIL/BLOCKED).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UAT_DIR = path.resolve(HERE, '../..');
export const HARNESS_DIR = path.resolve(HERE, '../../../tools/uat-harness');
export const SHOTS = path.join(UAT_DIR, 'shots/U6-web-khach');
export const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

const h = (f) => import(path.join(HARNESS_DIR, f));
const libM = await h('lib.mjs');
const webM = await h('web-session.mjs');
const miniM = await h('miniapp-session.mjs');
const pancakeM = await h('pancake-webhook.mjs');

export const { api, apiOk, findUser, sleep, closePrisma, prismaFor, realLogin, mintAccessFor, laneEnv, playwright } = libM;
export const L = libM.lane(6);
/** Mở web thật đã đăng nhập (hoặc 'guest'); gắn thêm s.consoleErrors và s.failed (request web/API hỏng). */
// /auth/refresh (mỗi lần tải trang đầy đủ khi đã đăng nhập) bị giới hạn 30 lần/phút/IP và 10 lần/phút/refresh token (throttle.config.ts,
// đã biết C-005). Toàn bộ phiên UAT chung IP 127.0.0.1 nên phải tự giãn nhịp để không tự gây 429 giả.
const navLog = [];
export async function paceNav(maxPerMin = 16) {
  for (;;) {
    const now = Date.now();
    while (navLog.length && now - navLog[0] > 60_000) navLog.shift();
    if (navLog.length < maxPerMin) break;
    await new Promise((r) => setTimeout(r, 60_000 - (now - navLog[0]) + 200));
  }
  navLog.push(Date.now());
}

export async function openWeb(user, opts = {}) {
  await paceNav();
  const s = await webM.openWeb(6, user, opts);
  const origClose = s.close;
  s.close = () => Promise.race([origClose(), sleep(15_000)]);
  s.consoleErrors = [];
  s.failed = [];
  s.page.on('console', (m) => {
    if (m.type() === 'error') s.consoleErrors.push(m.text().slice(0, 300));
  });
  s.page.on('requestfailed', (r) => s.failed.push(`${r.method()} ${r.url().slice(0, 160)} ${r.failure()?.errorText}`));
  return s;
}

/** Đi tới đường dẫn web; trả {status, reqs (API mới), errs (lỗi trang mới), consoleErrs, url}. */
export async function nav(s, p, { wait = 1200 } = {}) {
  await paceNav();
  const r0 = s.requests.length;
  const e0 = s.errors.length;
  const c0 = s.consoleErrors.length;
  const resp = await s.page.goto(`${L.webUrl}${p}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await s.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await s.page.waitForTimeout(wait);
  return {
    status: resp?.status(),
    reqs: s.requests.slice(r0),
    errs: s.errors.slice(e0),
    consoleErrs: s.consoleErrors.slice(c0),
    url: s.page.url().replace(L.webUrl, ''),
  };
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText);
export const badReqs = (reqs) => reqs.filter((r) => r.status >= 400 || r.status === 0).map((r) => `${r.method} ${r.path} ${r.status}`);
export const openMini = (user, opts = {}) => miniM.open(6, user, opts);
export const sendOrderStatus = pancakeM.sendOrderStatus;
export const prisma = prismaFor(L);

const big = (_k, v) => (typeof v === 'bigint' ? Number(v) : v);
/** SQL thô trên DB lane 6; trả mảng dòng, BigInt thành số. */
export async function sql(q, ...params) {
  const rows = await prisma.$queryRawUnsafe(q, ...params);
  return JSON.parse(JSON.stringify(rows, big));
}

/** Gọi API lane bằng bí danh khách (token ký tại chỗ). */
export const call = (user, method, p, body) => api(L, method, p, { user, body });

/** Đặt số dư ví của khách thử và ghi một dòng sổ ADJUST bù chênh lệch, để walletBalance luôn bằng SUM(wallet_transactions). */
export async function seedWallet(userId, amount) {
  const cur = (await sql(`SELECT "walletBalance"::int AS w FROM users WHERE id = $1`, userId))[0].w;
  if (cur === amount) return;
  await sql(`UPDATE users SET "walletBalance" = $2::int WHERE id = $1`, userId, amount);
  await sql(
    `INSERT INTO wallet_transactions (id, "userId", delta, "balanceAfter", type, "refType", reason, "createdAt") VALUES (md5(random()::text), $1, $3::int, $2::int, 'ADJUST', 'UAT', 'UAT: đặt số dư ví thử', now())`,
    userId,
    amount,
    amount - cur,
  );
}

export const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const short = (v, n = 600) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, big);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};

export async function ledger(userId) {
  const [bal] = await sql(`SELECT "pointsBalance"::int AS balance FROM users WHERE id = $1`, userId);
  const [sum] = await sql(
    `SELECT COALESCE(SUM(delta),0)::int AS sum, COUNT(*)::int AS n FROM points_transactions WHERE "userId" = $1 AND lot = 'STANDARD'`,
    userId,
  );
  return { balance: bal.balance, ledgerSum: sum.sum, rows: sum.n };
}

export async function ledgerRows(userId, like = '%') {
  return sql(
    `SELECT delta::int, reason, lot, "createdAt" FROM points_transactions WHERE "userId" = $1 AND reason LIKE $2 ORDER BY "createdAt"`,
    userId,
    like,
  );
}

/** Dọn giỏ của khách bằng chính API giỏ để mỗi ca bắt đầu từ giỏ trống. */
export async function clearCart(user) {
  const cart = await call(user, 'GET', '/cart');
  for (const it of cart.body?.items ?? []) await call(user, 'DELETE', `/cart/items/${it.id}`);
  const c = await call(user, 'GET', '/cart');
  if (c.body?.couponCode) await call(user, 'DELETE', '/cart/coupon').catch(() => undefined);
}

export async function variantId(sku) {
  const [r] = await sql(`SELECT id FROM variations WHERE sku = $1`, sku);
  if (!r) throw new Error(`không có SKU ${sku}`);
  return r.id;
}

/** Ghi kết quả ca. verdict: PASS khi mọi kiểm tra đúng; FAIL khi có kiểm tra sai hoặc ca ném lỗi; BLOCKED khi gọi c.blocked(). */
export class Recorder {
  constructor(name) {
    this.name = name;
    this.cases = [];
    this.t0 = Date.now();
    // ONLY=U6-32,U6-33 chạy lại đúng các ca đó và giữ nguyên kết quả cũ của ca khác trong cùng file.
    this.only = process.env.ONLY ? process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean) : null;
    if (this.only) {
      try {
        this.cases = JSON.parse(fs.readFileSync(path.join(RESULTS, `${name}.json`), 'utf8')).cases ?? [];
      } catch {
        this.cases = [];
      }
    }
  }

  async run(id, meta, fn) {
    if (this.only && !this.only.some((o) => id === o || id.startsWith(`${o}-`))) return null;
    this.cases = this.cases.filter((x) => x.id !== id);
    const c = {
      id,
      ...meta,
      checks: [],
      evidence: [],
      shots: [],
      notes: [],
      blockedReason: null,
      bugs: [],
    };
    const ctx = {
      ok: (name, cond, detail) => {
        c.checks.push({ name, ok: Boolean(cond), detail: detail === undefined ? undefined : short(detail, 400) });
        console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${id} ${name}${detail !== undefined && !cond ? ` ${short(detail, 240)}` : ''}`);
        return Boolean(cond);
      },
      ev: (label, value) => {
        c.evidence.push({ label, value: short(value, 900) });
      },
      shot: async (page, label) => {
        const file = `${id}-${label}.png`;
        await page.screenshot({ path: path.join(SHOTS, file) }).catch((e) => console.log('  (không chụp được ảnh)', e.message));
        c.shots.push(`uat/shots/U6-web-khach/${file}`);
        return file;
      },
      note: (t) => c.notes.push(t),
      blocked: (reason) => {
        c.blockedReason = reason;
      },
      bug: (b) => c.bugs.push(b),
    };
    console.log(`\n[${((Date.now() - this.t0) / 1000).toFixed(0)}s] ${id} ${meta.journey ?? ''}`);
    try {
      await fn(ctx);
    } catch (e) {
      c.checks.push({ name: 'ca ném lỗi', ok: false, detail: short(String(e?.stack ?? e), 700) });
      console.log(`  FAIL ${id} ném lỗi: ${e?.message}`);
    }
    c.verdict = c.blockedReason ? 'BLOCKED' : c.checks.some((x) => !x.ok) ? 'FAIL' : 'PASS';
    console.log(`  => ${c.verdict}${c.blockedReason ? ` (${c.blockedReason})` : ''}`);
    this.cases.push(c);
    this.save();
    return c;
  }

  save() {
    fs.writeFileSync(path.join(RESULTS, `${this.name}.json`), JSON.stringify({ name: this.name, at: new Date().toISOString(), cases: this.cases }, big, 2));
  }

  summary() {
    const n = (v) => this.cases.filter((c) => c.verdict === v).length;
    return `${this.name}: PASS ${n('PASS')} / FAIL ${n('FAIL')} / BLOCKED ${n('BLOCKED')}`;
  }
}

/** Số dòng chữ hiển thị (innerText) của trang, cắt gọn, dùng làm bằng chứng. */
export async function pageText(page, n = 500) {
  return (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, n);
}

/** Cuộn ngang trang (trang không được tràn ngang). */
export async function overflowX(page) {
  // Điện thoại giả lập tự nới "viewport bố cục" khi nội dung tràn (innerWidth phình theo), nên so với screen.width (khổ máy thật).
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: Math.min(window.innerWidth, window.screen.width || window.innerWidth), layoutVw: window.innerWidth }));
}

export async function finish(rec) {
  await Promise.race([closePrisma(), sleep(5000)]);
  console.log(`\n${rec.summary()}`);
  // Kết thúc cứng: một trình duyệt/kết nối treo không được giữ tiến trình sống mãi.
  setTimeout(() => process.exit(0), 200);
}

/** Thêm sản phẩm vào giỏ bằng giao diện PDP (chọn biến thể, tăng số lượng, bấm Thêm vào giỏ). Trả {status, body}. */
export async function addViaPdp(s, slug, { qty = 1, variantRe = null } = {}) {
  await nav(s, `/san-pham/${slug}`, { wait: 800 });
  if (variantRe) await s.page.getByRole('button', { name: variantRe }).first().click();
  for (let i = 1; i < qty; i++) await s.page.getByRole('button', { name: 'Tăng số lượng' }).click();
  const respP = s.page.waitForResponse((r) => /\/cart\/items$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null);
  const addBtn = s.page.getByRole('button', { name: /Thêm vào giỏ/ }).first();
  try {
    await addBtn.click({ timeout: 8000 });
  } catch {
    // Trang phình rộng hơn màn hình (xem U6-B01) làm Playwright kiểm tra điểm bấm sai: bấm bằng DOM, ghi lại để báo cáo.
    s.domClickFallback = (s.domClickFallback ?? 0) + 1;
    await addBtn.evaluate((el) => el.click());
  }
  const resp = await respP;
  if (!resp) return { status: 0, body: null };
  return { status: resp.status(), body: await resp.json().catch(() => null) };
}

/** Giỏ hiện tại theo DB: [{sku, qty, price}] */
export async function cartRows(userId) {
  return sql(
    `SELECT v.sku, ci.quantity::int AS qty, v."retailPrice"::int AS retail, v."salePrice"::int AS sale FROM cart_items ci JOIN carts c ON c.id = ci."cartId" JOIN variations v ON v.id = ci."variationId" WHERE c."userId" = $1 ORDER BY v.sku`,
    userId,
  );
}

export const digits = (t) => Number(String(t).replace(/[^\d]/g, ''));
