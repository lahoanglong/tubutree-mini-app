import fs from 'fs';
import path from 'path';
import { createHmac } from 'crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * UAT quản trị vòng 3 ở hai khung 1440x900 và 768x1024, API và DB thật (chạy qua scripts/web-gate.sh, E2E_SCOPE=web).
 * Các màn: Giờ vàng, Mã giảm giá, Báo cáo (kể cả kỳ trống), Tổng quan chỉ số, Hoa hồng & giá sỉ, Thuế TNCN hoa hồng, Chiến dịch và Combo (ô ngày, ô %).
 * Chỉ /auth/refresh được giả (phiên ADMIN ký bằng đúng JWT_ACCESS_SECRET của API). Mọi mốc ngày tính từ một lần đọc đồng hồ lúc seed, theo lịch Việt Nam;
 * mỗi khung chạy trong một múi giờ trình duyệt khác nhau để ngày đọc theo giờ máy lộ ra. Số tổng trên màn so với API đọc ngay lúc kiểm (tải lại màn và đọc lại nếu spec khác ghi vào cùng DB giữa chừng);
 * phần của spec trong số tổng đọc thẳng từ DB theo mã đơn `E2EW13-` và người dùng `e2e-w13-*`.
 * Ảnh chụp (fullPage) ghi vào W13_SCREENS_DIR nếu đặt, tên `NN-<khung>-<màn>-<bước>.png`.
 */

const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
const W13 = 'e2e-w13-';
const ADMIN_ID = `${W13}admin`;
const dbUrl = process.env.DATABASE_URL ?? '';
const secret = process.env.JWT_ACCESS_SECRET ?? '';
const runnable = process.env.E2E_SCOPE === 'web' && GATE_DB.test(dbUrl) && secret.length >= 16;
const SCREENS = process.env.W13_SCREENS_DIR;
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3001'}/api`;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const VN_OFFSET_MS = 7 * HOUR_MS;
const p2 = (n: number) => String(n).padStart(2, '0');

/** Mốc "bây giờ" chốt một lần lúc seed: mọi ngày tính từ đây, để chạy qua nửa đêm giờ VN không làm lệch kỳ vọng giữa chừng. */
const CLOCK = { at: Date.now() };

function vnDay(days: number): { y: string; m: string; d: string } {
  const t = new Date(CLOCK.at + VN_OFFSET_MS + days * DAY_MS);
  return { y: String(t.getUTCFullYear()), m: p2(t.getUTCMonth() + 1), d: p2(t.getUTCDate()) };
}
const ymd = (days: number): string => { const { y, m, d } = vnDay(days); return `${y}-${m}-${d}`; };
const dmy = (days: number): string => { const { y, m, d } = vnDay(days); return `${d}/${m}/${y}`; };
/** Gõ liền chữ số như người dùng: "07112026". */
const dmyDigits = (days: number): string => dmy(days).replace(/\//g, '');
const vnAt = (days: number, hhmm: string): Date => new Date(`${ymd(days)}T${hhmm}:00+07:00`);
const vnClock = (d: Date): string => {
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  return `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())} ${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
};
/** "1.234.567đ", tự ghép để không phụ thuộc ICU của máy chạy test. */
const vnd = (n: number): string => `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Khung và múi giờ trình duyệt: 23:30 giờ VN chỉ lệch ngày ở múi giờ phía đông (Auckland), 00:30 chỉ lệch ở phía tây (Los Angeles). */
const FRAMES = [
  { w: 1440, h: 900, tz: 'America/Los_Angeles' },
  { w: 768, h: 1024, tz: 'Pacific/Auckland' },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prismaClient(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client'));
  return new PrismaClient({ datasources: { db: { url: dbUrl } } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withDb(fn: (prisma: any) => Promise<any>): Promise<any> {
  const prisma = prismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
function adminToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', zaloId: `${W13}admin-zalo`, iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

let shotNo = 0;
async function shot(page: Page, flow: string, step: string, modal = false): Promise<void> {
  if (!SCREENS) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  shotNo += 1;
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SCREENS, `r3-${String(shotNo).padStart(2, '0')}-${vp?.width ?? 0}-${flow}-${step}.png`), fullPage: !modal });
}

/** Điều thấy được mà chưa phải lỗi: đi vào báo cáo của lần chạy (stdout và phần chú thích của ca test). */
function note(flow: string, text: string): void {
  const line = `[W13 ${flow}] ${text}`;
  test.info().annotations.push({ type: 'quan-sat', description: line });
  console.log(line);
}

interface Watch {
  pageErrors: string[];
  consoleErrors: string[];
  api: { status: number; method: string; path: string; from: string }[];
  posts: string[];
}

function watch(page: Page): Watch {
  const w: Watch = { pageErrors: [], consoleErrors: [], api: [], posts: [] };
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) w.consoleErrors.push(m.text());
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.method() !== 'GET') w.posts.push(`${r.method()} ${u.pathname}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) w.api.push({ status: r.status(), method: r.request().method(), path: u.pathname, from: new URL(page.url()).pathname + new URL(page.url()).search });
  });
  return w;
}

function expectCleanWatch(flow: string, w: Watch, allowed: { status: number; path: RegExp; why: string }[] = []): void {
  const unexpected = w.api.filter((a) => !allowed.some((x) => (x.status === 0 ? a.status >= 400 : x.status === a.status) && x.path.test(a.path)));
  expect.soft(unexpected, `${flow}: phản hồi 4xx/5xx ngoài dự kiến`).toEqual([]);
  expect.soft(w.pageErrors, `${flow}: pageerror`).toEqual([]);
  expect.soft(w.consoleErrors, `${flow}: console error`).toEqual([]);
}

/** Dán như người dùng (qua bàn phím trình duyệt): maxLength của ô được tôn trọng, khác với fill() ghi thẳng giá trị. */
async function paste(loc: Locator, text: string): Promise<void> {
  await loc.focus();
  await loc.press('ControlOrMeta+a');
  if (text === '') await loc.press('Backspace');
  else await loc.page().keyboard.insertText(text);
}

async function openAdmin(page: Page, url = '/admin'): Promise<void> {
  await page.route('**/api/auth/refresh', async (route) => {
    const origin = route.request().headers()['origin'] ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({
        accessToken: adminToken(),
        refreshToken: '',
        user: { id: ADMIN_ID, role: 'ADMIN', fullName: 'W13 Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'E2EW13AD1' },
      }),
    });
  });
  await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
  await page.goto(url);
  await expect(page.getByRole('navigation', { name: /^Mục quản trị/ }).or(page.getByRole('button', { name: /Đổi mục/ })).first()).toBeVisible();
}

/** Bấm một mục của menu: ô "Tìm mục quản trị" ở khung rộng (menu trái), qua nút "Đổi mục" và ngăn kéo ở khung hẹp (dưới 1024). */
async function gotoNav(page: Page, label: string): Promise<void> {
  const narrow = (page.viewportSize()?.width ?? 1440) < 1024;
  if (narrow) await page.getByRole('button', { name: /Đổi mục/ }).click();
  const nav = page.getByRole('navigation', { name: narrow ? 'Mục quản trị (điện thoại)' : 'Mục quản trị', exact: true });
  await nav.getByRole('searchbox', { name: 'Tìm mục quản trị' }).fill(label);
  await nav.getByRole('button', { name: new RegExp(`^${escapeRe(label)}\\s*(,|$)`) }).first().click();
}

interface ApiResult { status: number; json: any; text: string } // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', urlPath: string, body?: unknown): Promise<ApiResult> {
  const r = await fetch(`${API}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${adminToken()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, json, text };
}

async function apiJson(urlPath: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api('GET', urlPath);
  if (r.status >= 400) throw new Error(`${urlPath}: HTTP ${r.status}`);
  return r.json;
}

async function submitAndRead(page: Page, trigger: () => Promise<void>, urlPath: RegExp, method = 'POST'): Promise<{ status: number; body: string }> {
  const wait = page.waitForResponse((r) => urlPath.test(new URL(r.url()).pathname) && r.request().method() === method);
  await trigger();
  const r = await wait;
  return { status: r.status(), body: (await r.text()).slice(0, 300) };
}

/** Lời báo của API dạng một chuỗi (mảng thì nối bằng " | "). */
const messageOf = (r: ApiResult): string => {
  const m = r.json?.message;
  return Array.isArray(m) ? m.join(' | ') : String(m ?? r.text);
};

/** Lời báo hiện cho người dùng phải là tiếng Việt, không lộ tên trường hay chữ của framework. */
const TECHNICAL = /should not|must be|must not|should be|is not|is required|property .* should|Bad Request|Internal Server|undefined|\[object|flashPrice|variationId|perUserLimit|usageLimit|maxDiscount|minOrder|startAt|endAt|isActive|affiliateRate|\bquota\b/i;

interface ProbeResult {
  docOverflow: number;
  offenders: string[];
  money: string[];
  junk: string[];
  rawNumbers: string[];
}

/**
 * Quét màn đang mở: tràn ngang trang, phần tử thò ra ngoài khung nhìn mà không nằm trong khung cuộn riêng, mọi chữ tiền sai dạng `1.234.567đ`,
 * chữ rác (NaN, undefined, [object, Invalid Date, null, ISO thô, AM/PM, GMT) và ngày sai dạng dd/mm/yyyy. Số nguyên ≥ 4 chữ số không có dấu chấm đứng riêng
 * trả về `rawNumbers` để người chạy xem (có thể là số đếm chưa định dạng, cũng có thể là mã).
 */
async function probe(page: Page): Promise<ProbeResult> {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const clipsX = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= w + 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
      if (el.closest('[aria-hidden="true"], [inert], .sr-only')) continue;
      if (clipsX(el)) continue;
      offenders.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join('.')} right=${Math.round(r.right)} «${(el.textContent ?? '').trim().slice(0, 40)}»`);
      if (offenders.length >= 8) break;
    }
    const text = document.body.innerText;
    const money = Array.from(text.matchAll(/\d[\d.,]*\s*(?:đ|₫|VND|VNĐ|vnđ)(?![\p{L}])/giu)).map((m) => m[0]).filter((t) => !/^\d{1,3}(\.\d{3})*đ$/.test(t));
    const junk: string[] = [];
    const bad: [RegExp, string][] = [
      [/\bNaN\b/, 'NaN'],
      [/\bundefined\b/, 'undefined'],
      [/\[object /, '[object'],
      [/Invalid Date/, 'Invalid Date'],
      [/\bnull\b/, 'null'],
      [/\bInfinity\b/, 'Infinity'],
      [/\d{4}-\d{2}-\d{2}(T|\s\d)/, 'ISO thô'],
      [/\b\d{1,2}:\d{2}:\d{2}\b/, 'giờ có giây'],
      [/\b[AP]M\b/, 'AM/PM'],
      [/\b(GMT|UTC)\b/, 'GMT/UTC'],
      [/(?<![\d/])(\d\/\d{1,2}|\d{1,2}\/\d)\/\d{4}/, 'ngày thiếu số 0'],
    ];
    for (const [re, label] of bad) {
      const m = re.exec(text);
      if (m) junk.push(`${label}: «${text.slice(Math.max(0, m.index - 25), m.index + 35).replace(/\s+/g, ' ')}»`);
    }
    const rawNumbers = Array.from(text.matchAll(/(?<![\w.,/:#+\-])\d{4,}(?![\w.,/:])/g)).filter((m) => !/^0\d{8,10}$/.test(m[0])).map((m) => `${m[0]} «${text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 14).replace(/\s+/g, ' ')}»`);
    return { docOverflow: document.documentElement.scrollWidth - w, offenders, money, junk, rawNumbers: rawNumbers.slice(0, 12) };
  });
}

/** Mọi bảng rộng hơn khung nhìn phải nằm trong một khung cuộn riêng (không kéo cả trang). */
async function expectTablesScrollInOwnFrame(page: Page, flow: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const w = window.innerWidth;
    return Array.from(document.querySelectorAll('table'))
      .filter((t) => t.getBoundingClientRect().width > 0 && t.getClientRects().length > 0)
      .filter((t) => {
        let scroller = false;
        for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll') scroller = true;
        }
        return t.getBoundingClientRect().right > w + 1 && !scroller;
      })
      .map((t) => `table cột đầu «${(t.querySelector('th')?.textContent ?? '').trim()}»`);
  });
  expect(bad, `${flow}: bảng thò ra ngoài khung nhìn mà không có khung cuộn riêng`).toEqual([]);
}

/** Quét xong thì khoá: không tràn trang, không chữ rác, mọi số tiền đúng dạng. Số nguyên thô chỉ ghi nhận. */
async function expectCleanScreen(page: Page, flow: string, opts: { allowJunk?: RegExp } = {}): Promise<ProbeResult> {
  const r = await probe(page);
  const vp = page.viewportSize()?.width ?? 0;
  expect.soft(r.docOverflow, `${flow}@${vp}: trang tràn ngang ${r.docOverflow}px`).toBeLessThanOrEqual(0);
  expect.soft(r.offenders, `${flow}@${vp}: phần tử thò ra ngoài khung nhìn`).toEqual([]);
  expect.soft(r.money, `${flow}@${vp}: số tiền sai dạng 1.234.567đ`).toEqual([]);
  expect.soft(opts.allowJunk ? r.junk.filter((j) => !opts.allowJunk!.test(j)) : r.junk, `${flow}@${vp}: chữ rác hoặc ngày giờ sai dạng`).toEqual([]);
  if (r.rawNumbers.length) note(flow, `số nguyên thô: ${r.rawNumbers.join(' | ')}`);
  await expectTablesScrollInOwnFrame(page, `${flow}@${vp}`);
  return r;
}

// ───────────────────────────── Dữ liệu seed ─────────────────────────────

const CUSTOMER = { id: `${W13}cust`, name: 'W13 Khách Hàng', phone: '0900013001' };
const CTV_A = { id: `${W13}ctv-a`, name: 'W13 CTV Có MST', phone: '0900013002', taxId: '8123456789' };
const CTV_B = { id: `${W13}ctv-b`, name: 'W13 CTV Thiếu MST', phone: '0900013003' };
const PRODUCT = { id: `${W13}prod`, name: 'W13 Sản phẩm thử', slug: 'e2e-w13-san-pham-thu' };
const VAR1 = { id: `${W13}var-1`, sku: 'E2EW13-V1', name: 'Hộp lẻ', retail: 100_000, stock: 50 };
const VAR2 = { id: `${W13}var-2`, sku: 'E2EW13-V2', name: 'Hộp đôi', retail: 200_000, sale: 150_000, stock: 3 };
const PRODUCT2 = { id: `${W13}prod-2`, name: 'W13 Sản phẩm kèm', slug: 'e2e-w13-san-pham-kem' };
const VAR3 = { id: `${W13}var-3`, sku: 'E2EW13-V3', name: 'Gói nhỏ', retail: 80_000, stock: 20 };
const TIER = { id: `${W13}tier`, name: 'W13 Bậc thử', price: 90_000 };

interface SeedOrder { code: string; day: number; at: string; status: string; method: string; pay: string; total: number }
const ORDERS: readonly SeedOrder[] = [
  { code: 'E2EW13-A', day: -2, at: '12:00', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 1_500_000 },
  { code: 'E2EW13-B', day: -20, at: '09:30', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 2_000_000 },
  { code: 'E2EW13-C', day: -50, at: '15:00', status: 'DELIVERED', method: 'COD', pay: 'PAID', total: 750_000 },
  { code: 'E2EW13-D', day: -1, at: '10:00', status: 'CANCELLED', method: 'COD', pay: 'UNPAID', total: 400_000 },
];
const sum = (xs: readonly { total: number }[]) => xs.reduce((s, o) => s + o.total, 0);
const PAID = ORDERS.filter((o) => o.pay === 'PAID' && o.status === 'DELIVERED');
const GMV = ORDERS.filter((o) => ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'].includes(o.status));

const RANGES = { r7: [-6, 0], r30: [-29, 0], r90: [-89, 0] } as const;
type RangeKey = keyof typeof RANGES;
/** Khoảng ngày chắc chắn không có đơn nào (tháng 3/2019), để kiểm kỳ trống. */
const EMPTY = { from: '2019-03-01', to: '2019-03-07', typedFrom: '01032019', typedTo: '07032019' };
interface RangeTotals { revenue: number; gmv: number; orders: number; cancelled: number; partialRefund: number; newUsers: number }

async function readRange(from: string, to: string): Promise<RangeTotals> {
  const t = (await apiJson(`/admin/reports/revenue?from=${from}&to=${to}`)).totals;
  return { revenue: Number(t.revenue), gmv: Number(t.gmv), orders: Number(t.orders), cancelled: Number(t.cancelled), partialRefund: Number(t.partialRefund), newUsers: Number(t.newUsers) };
}
async function readStats(): Promise<{ totalRevenue: number; gmv: number; codPendingValue: number; totalOrders: number }> {
  const j = await apiJson('/admin/dashboard/stats');
  return { totalRevenue: Number(j.totalRevenue), gmv: Number(j.gmv), codPendingValue: Number(j.codPendingValue), totalOrders: Number(j.totalOrders) };
}
const inRange = (key: RangeKey): readonly SeedOrder[] => ORDERS.filter((o) => o.day >= RANGES[key][0] && o.day <= RANGES[key][1]);

interface OrderPart { orders: number; cancelled: number; revenue: number; gmv: number }
const partOf = (xs: readonly SeedOrder[]): OrderPart => ({ orders: xs.length, cancelled: xs.filter((o) => o.status === 'CANCELLED').length, revenue: sum(xs.filter((o) => PAID.includes(o))), gmv: sum(xs.filter((o) => GMV.includes(o))) });
const vnKey = (d: Date): string => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/** Phần của spec trong số tổng, đọc thẳng từ DB theo mã đơn `E2EW13-` (ngày theo giờ VN, để null thì không chặn đầu đó): không phụ thuộc đơn của spec khác chạy cùng DB. */
async function ownOrders(fromKey: string | null, toKey: string | null): Promise<OrderPart> {
  const rows: { status: string; paymentStatus: string; total: unknown; createdAt: Date }[] = await withDb((prisma) =>
    prisma.order.findMany({ where: { code: { startsWith: 'E2EW13-' } }, select: { status: true, paymentStatus: true, total: true, createdAt: true } }),
  );
  const inside = rows.filter((r) => (fromKey === null || vnKey(r.createdAt) >= fromKey) && (toKey === null || vnKey(r.createdAt) <= toKey));
  const money = (xs: typeof rows) => xs.reduce((n, r) => n + Number(r.total), 0);
  return {
    orders: inside.length,
    cancelled: inside.filter((r) => r.status === 'CANCELLED').length,
    revenue: money(inside.filter((r) => r.status === 'DELIVERED' && r.paymentStatus === 'PAID')),
    gmv: money(inside.filter((r) => ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'].includes(r.status))),
  };
}

/**
 * So số trên màn với API đọc ngay lúc kiểm. Spec khác ghi vào cùng DB (đơn, người dùng, lệnh chi) nên API có thể đổi giữa lúc màn tải và lúc đọc:
 * lệch thì tải lại màn, mở lại màn đang kiểm và đọc lại API, thử tới khi hai bên khớp. Trả về kết quả của lần đọc khớp.
 */
async function expectMatchesApi<T>(page: Page, reopen: () => Promise<void>, check: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let last!: T;
  await expect(async () => {
    if (attempt++ > 0) {
      await page.reload();
      await reopen();
    }
    last = await check();
  }).toPass({ timeout: 90_000, intervals: [500, 1_000, 2_000, 4_000] });
  return last;
}

/** Tháng của báo cáo thuế: 3/2026 theo giờ VN. Lệnh 00:30 ngày 01/03 giờ VN còn là 28/02 theo giờ UTC, lệnh 23:30 ngày 28/02 giờ VN thì ngược lại. */
const PIT_MONTH = '2026-03';
const PIT_FEB = '2026-02';
const nextMonth = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${p2(m + 1)}`;
};
const readPit = async (month: string) => {
  const j = await apiJson(`/admin/payouts/pit-report?month=${month}`);
  return { rows: Number(j.totals.recipients), gross: Number(j.totals.grossAmount), tax: Number(j.totals.taxWithheld), net: Number(j.totals.netAmount), json: j };
};

/** Phần của spec trong báo cáo thuế một tháng giờ VN: lệnh chi hoa hồng đã chi của người dùng `e2e-w13-*`, đọc thẳng từ DB. */
async function ownPit(ym: string): Promise<{ rows: number; gross: number; tax: number; net: number }> {
  const list: { userId: string; grossAmount: unknown; taxWithheld: unknown; amount: unknown }[] = await withDb((prisma) =>
    prisma.payout.findMany({
      where: { userId: { startsWith: W13 }, status: 'PAID', paidAt: { gte: new Date(`${ym}-01T00:00:00+07:00`), lt: new Date(`${nextMonth(ym)}-01T00:00:00+07:00`) } },
      select: { userId: true, grossAmount: true, taxWithheld: true, amount: true },
    }),
  );
  const add = (pick: (r: (typeof list)[number]) => unknown) => list.reduce((n, r) => n + Number(pick(r)), 0);
  return { rows: new Set(list.map((r) => r.userId)).size, gross: add((r) => r.grossAmount), tax: add((r) => r.taxWithheld), net: add((r) => r.amount) };
}

/**
 * Gỡ mọi dòng của spec, chỉ theo tiền tố riêng (`W13 ` ở tên, `E2EW13` ở mã, `e2e-w13-` ở id), theo thứ tự khoá ngoại: bảng con của đơn trước đơn
 * (OrderItem, PaymentAttempt, GomdonAlert tự xoá theo đơn), rồi lệnh chi, biến thể, bậc đại lý, sản phẩm, cuối cùng người dùng.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purgeData(prisma: any, withUsers: boolean): Promise<void> {
  const flashIds: string[] = (await prisma.flashSale.findMany({ where: { title: { startsWith: 'W13 ' } }, select: { id: true } })).map((x: { id: string }) => x.id);
  if (flashIds.length) await prisma.flashSaleItem.deleteMany({ where: { flashSaleId: { in: flashIds } } });
  await prisma.flashSale.deleteMany({ where: { title: { startsWith: 'W13 ' } } });
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code: { startsWith: 'E2EW13' } } } });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: 'E2EW13' } } });
  await prisma.campaign.deleteMany({ where: { title: { startsWith: 'W13 ' } } });
  await prisma.bundle.deleteMany({ where: { title: { startsWith: 'W13 ' } } });
  const orderIds: string[] = (await prisma.order.findMany({ where: { code: { startsWith: 'E2EW13-' } }, select: { id: true } })).map((o: { id: string }) => o.id);
  if (orderIds.length) {
    const byOrder = { orderId: { in: orderIds } };
    await prisma.orderStatusHistory.deleteMany({ where: byOrder });
    await prisma.commission.deleteMany({ where: byOrder });
    await prisma.orderCustomerRefund.deleteMany({ where: byOrder });
    await prisma.merchantPayoutLine.deleteMany({ where: byOrder });
  }
  await prisma.order.deleteMany({ where: { code: { startsWith: 'E2EW13-' } } });
  await prisma.payout.deleteMany({ where: { userId: { startsWith: W13 } } });
  await prisma.variation.deleteMany({ where: { id: { startsWith: W13 } } });
  await prisma.dealerTier.deleteMany({ where: { id: { startsWith: W13 } } });
  await prisma.product.deleteMany({ where: { id: { startsWith: W13 } } });
  if (withUsers) await prisma.user.deleteMany({ where: { id: { startsWith: W13 } } });
}

async function seedAll(): Promise<void> {
  CLOCK.at = Date.now();
  await withDb(async (prisma) => {
    await purgeData(prisma, false);

    const user = (id: string, zalo: string, fullName: string, phone: string | null, refCode: string, role = 'CUSTOMER', extra: Record<string, unknown> = {}) =>
      prisma.user.upsert({
        where: { id },
        update: { role, isBlocked: false, blockedReason: null, fullName, phone, ...extra },
        create: { id, zaloId: zalo, role, fullName, phone, referralCode: refCode, ...extra },
      });
    await user(ADMIN_ID, `${W13}admin-zalo`, 'W13 Admin', null, 'E2EW13AD1', 'ADMIN');
    await user(CUSTOMER.id, `${W13}cust-zalo`, CUSTOMER.name, CUSTOMER.phone, 'E2EW13CU1');
    await user(CTV_A.id, `${W13}ctv-a-zalo`, CTV_A.name, CTV_A.phone, 'E2EW13CA1', 'CUSTOMER', { personalTaxId: CTV_A.taxId });
    await user(CTV_B.id, `${W13}ctv-b-zalo`, CTV_B.name, CTV_B.phone, 'E2EW13CB1');

    for (const o of ORDERS) {
      await prisma.order.create({
        data: {
          code: o.code,
          userId: CUSTOMER.id,
          type: 'RETAIL',
          status: o.status,
          subtotal: o.total,
          total: o.total,
          paymentMethod: o.method,
          paymentStatus: o.pay,
          source: 'checkout',
          platform: 'web',
          createdAt: vnAt(o.day, o.at),
          shippingAddress: { recipient: CUSTOMER.name, phone: CUSTOMER.phone, line1: '12 Đường Thử, Quận 1', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
        },
      });
    }

    await prisma.product.create({
      data: {
        id: PRODUCT.id, slug: PRODUCT.slug, name: PRODUCT.name, brand: 'W13', description: 'Sản phẩm thử của UAT vòng 3', images: [], tags: [], categoryIds: [], forSegment: [], certifications: [],
        basePrice: VAR1.retail,
      },
    });
    await prisma.product.create({
      data: { id: PRODUCT2.id, slug: PRODUCT2.slug, name: PRODUCT2.name, brand: 'W13', description: 'Sản phẩm kèm của UAT vòng 3', images: [], tags: [], categoryIds: [], forSegment: [], certifications: [], basePrice: VAR3.retail },
    });
    await prisma.variation.create({ data: { id: VAR3.id, productId: PRODUCT2.id, sku: VAR3.sku, name: VAR3.name, attributes: {}, retailPrice: VAR3.retail, stock: VAR3.stock } });
    await prisma.dealerTier.create({ data: { id: TIER.id, name: TIER.name, minOrderVolume: 0, discountRules: {} } });
    await prisma.variation.create({ data: { id: VAR1.id, productId: PRODUCT.id, sku: VAR1.sku, name: VAR1.name, attributes: {}, retailPrice: VAR1.retail, stock: VAR1.stock, dealerPrices: { [TIER.id]: TIER.price } } });
    await prisma.variation.create({ data: { id: VAR2.id, productId: PRODUCT.id, sku: VAR2.sku, name: VAR2.name, attributes: {}, retailPrice: VAR2.retail, salePrice: VAR2.sale, stock: VAR2.stock } });

    // Giờ vàng: đang chạy (cả sang hôm sau), sắp chạy, đã kết thúc, đang tắt.
    const sale = (title: string, startAt: Date, endAt: Date, isActive = true) => prisma.flashSale.create({ data: { title, startAt, endAt, isActive, createdBy: ADMIN_ID } });
    await sale('W13 Đợt đang chạy', new Date(CLOCK.at - HOUR_MS), new Date(CLOCK.at + 5 * HOUR_MS));
    await sale('W13 Đợt sắp chạy', vnAt(2, '09:00'), vnAt(2, '11:00'));
    await sale('W13 Đợt đã kết thúc', vnAt(-3, '09:00'), vnAt(-3, '11:00'));
    await sale('W13 Đợt đang tắt', vnAt(4, '09:00'), vnAt(4, '11:00'), false);

    // Mã giảm giá: đủ năm trạng thái theo ngày.
    const coupon = (code: string, over: Record<string, unknown>) =>
      prisma.coupon.create({ data: { code, type: 'PERCENT', value: 10, maxDiscount: 30_000, minOrder: 100_000, startAt: vnAt(-5, '00:00'), endAt: vnAt(5, '23:59'), usageLimit: 100, perUserLimit: 1, scope: 'PUBLIC', isActive: true, ...over } });
    await coupon('E2EW13RUN', {});
    await coupon('E2EW13SOON', { startAt: vnAt(3, '00:00'), endAt: vnAt(10, '23:59'), type: 'AMOUNT', value: 20_000, maxDiscount: null });
    await coupon('E2EW13OLD', { startAt: vnAt(-20, '00:00'), endAt: vnAt(-10, '23:59') });
    await coupon('E2EW13OFF', { isActive: false });
    const full = await coupon('E2EW13FULL', { usageLimit: 1, usedCount: 1, perUserLimit: 0 });
    await prisma.couponRedemption.create({ data: { couponId: full.id, userId: CUSTOMER.id } });

    // Lệnh chi hoa hồng đã chi: một lệnh cuối tháng 2, một lệnh ngay sau nửa đêm 01/03 giờ VN (A, có MST), một lệnh tháng 3 của B (khấu trừ nhưng chưa khai MST); một lệnh rút cũ đang chờ.
    const paid = (userId: string, paidAt: Date, gross: number, tax: number, taxId: string | null) =>
      prisma.payout.create({ data: { userId, amount: gross - tax, grossAmount: gross, taxWithheld: tax, taxId, method: 'WALLET_BALANCE', status: 'PAID', requestedAt: paidAt, paidAt } });
    await paid(CTV_A.id, new Date('2026-02-28T23:30:00+07:00'), 3_000_000, 0, CTV_A.taxId);
    await paid(CTV_A.id, new Date('2026-03-01T00:30:00+07:00'), 6_000_000, 600_000, CTV_A.taxId);
    await paid(CTV_B.id, new Date('2026-03-15T10:00:00+07:00'), 7_500_000, 750_000, null);
    await prisma.payout.create({ data: { userId: CTV_A.id, amount: 500_000, fee: 0, method: 'BANK', status: 'REQUESTED', bankInfo: { bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'NGUYEN VAN A' } } });
  });
}

/** Gỡ toàn bộ dữ liệu của spec khỏi DB dùng chung (spec không đổi cấu hình hệ thống nào). */
async function cleanupAll(): Promise<void> {
  await withDb((prisma) => purgeData(prisma, true));
}

// Hai khung dùng chung dữ liệu seed `e2e-w13-*` (beforeAll xoá rồi tạo lại): cấu hình cấp tệp để cả hai khung chạy nối nhau trong một worker, không song song.
test.describe.configure({ mode: 'serial' });

for (const frame of FRAMES) {
  test.describe(`Admin UAT vòng 3 ${frame.w}x${frame.h} với API và DB thật`, () => {
    test.skip(!runnable, 'Cần web-gate.sh (API + DB tạm thật)');
    test.use({ viewport: { width: frame.w, height: frame.h }, timezoneId: frame.tz });

    test.beforeAll(async () => {
      await seedAll();
    });

    test.afterAll(async () => {
      await cleanupAll();
    });

    test('1. Giờ vàng: danh sách theo trạng thái, tạo và sửa đợt, ngày bắt đầu/kết thúc, giá, số lượng, chồng giờ', async ({ page }) => {
      test.setTimeout(300_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Giờ vàng');
      await expect(page.getByRole('heading', { name: 'Tạo đợt giờ vàng' })).toBeVisible();
      const row = (title: string) => page.locator('[data-flash-sale-row]').filter({ hasText: title });
      const setWhen = async (label: string, days: number, hh: string, mm: string) => {
        await paste(page.getByRole('textbox', { name: `${label}: ngày`, exact: true }), dmyDigits(days));
        await page.getByRole('combobox', { name: `${label}: giờ`, exact: true }).selectOption(hh);
        await page.getByRole('combobox', { name: `${label}: phút`, exact: true }).selectOption(mm);
      };

      // Danh sách: bốn trạng thái, giờ-ngày theo giờ Việt Nam không lệch theo múi giờ trình duyệt.
      await expect(row('W13 Đợt đang chạy')).toContainText('Đang chạy');
      await expect(row('W13 Đợt đang chạy')).toContainText(`${vnClock(new Date(CLOCK.at - HOUR_MS))} → ${vnClock(new Date(CLOCK.at + 5 * HOUR_MS))}`);
      await expect(row('W13 Đợt sắp chạy')).toContainText('Sắp chạy');
      await expect(row('W13 Đợt sắp chạy')).toContainText(`09:00 ${dmy(2)} → 11:00 ${dmy(2)}`);
      await expect(row('W13 Đợt đang tắt')).toContainText('Đang tắt');
      await expect(row('W13 Đợt đã kết thúc'), 'bộ lọc mặc định là Chưa kết thúc').toHaveCount(0);
      await page.getByRole('button', { name: 'Đã kết thúc', exact: true }).click();
      await expect(row('W13 Đợt đã kết thúc')).toContainText('Đã kết thúc');
      await expect(row('W13 Đợt đang chạy')).toHaveCount(0);
      await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
      await expect(row('W13 Đợt đã kết thúc')).toBeVisible();
      await expect(row('W13 Đợt đang chạy')).toBeVisible();
      await page.getByRole('button', { name: 'Chưa kết thúc', exact: true }).click();
      await expectCleanScreen(page, 'gio-vang');
      await shot(page, 'gio-vang', 'danh-sach');

      // API chặn khi gọi thẳng: ngày, tên, độ dài đợt; lời báo tiếng Việt, không có đợt nào bị tạo.
      const baseSale = { title: 'W13 API', startAt: vnAt(20, '09:00').toISOString(), endAt: vnAt(20, '11:00').toISOString() };
      const badSale = async (why: string, over: Record<string, unknown>, re: RegExp) => {
        const r = await api('POST', '/admin/flash-sales', { ...baseSale, ...over });
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await badSale('bắt đầu bằng kết thúc', { endAt: baseSale.startAt }, /bắt đầu phải trước/);
      await badSale('bắt đầu sau kết thúc', { startAt: baseSale.endAt, endAt: baseSale.startAt }, /bắt đầu phải trước/);
      await badSale('kết thúc đã qua', { startAt: vnAt(-5, '09:00').toISOString(), endAt: vnAt(-4, '09:00').toISOString() }, /ở tương lai/);
      await badSale('dài quá 31 ngày', { endAt: vnAt(60, '11:00').toISOString() }, /tối đa 31 ngày/);
      await badSale('ngày không đọc được', { startAt: 'không phải ngày' }, /.+/);
      await badSale('thiếu giờ kết thúc', { endAt: undefined }, /.+/);
      await badSale('tên rỗng', { title: '' }, /.+/);
      await badSale('tên toàn khoảng trắng', { title: '    ' }, /.+/);
      await badSale('tên quá 200 ký tự', { title: `W13 ${'x'.repeat(200)}` }, /.+/);
      expect(await withDb((prisma) => prisma.flashSale.count({ where: { title: { startsWith: 'W13 API' } } })), 'đợt bị từ chối thì không được tạo').toBe(0);

      // Mục sản phẩm qua API: giá, số lượng, tồn kho, chồng giờ.
      const made = await api('POST', '/admin/flash-sales', { ...baseSale, title: 'W13 API đợt gốc' });
      expect(made.status, made.text).toBe(201);
      const saleId: string = made.json.id;
      const badItem = async (why: string, over: Record<string, unknown>, re: RegExp) => {
        const r = await api('POST', `/admin/flash-sales/${saleId}/items`, { variationId: VAR1.id, flashPrice: 80_000, quota: 10, ...over });
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await badItem('giá giờ vàng bằng giá gốc', { flashPrice: VAR1.retail }, /thấp hơn giá đang bán/);
      await badItem('giá giờ vàng cao hơn giá gốc', { flashPrice: VAR1.retail + 1 }, /thấp hơn giá đang bán/);
      await badItem('giá giờ vàng cao hơn giá khuyến mãi của biến thể', { variationId: VAR2.id, flashPrice: VAR2.sale!, quota: 1 }, /thấp hơn giá đang bán/);
      await badItem('giảm quá trần', { flashPrice: 5_000 }, /giảm quá 90%/);
      await badItem('giá bằng 0', { flashPrice: 0 }, /.+/);
      await badItem('giá âm', { flashPrice: -80_000 }, /.+/);
      await badItem('giá lẻ', { flashPrice: 79_999.5 }, /.+/);
      await badItem('số lượng bằng 0', { quota: 0 }, /.+/);
      await badItem('số lượng âm', { quota: -3 }, /.+/);
      await badItem('mỗi khách bằng 0', { perUserLimit: 0 }, /.+/);
      await badItem('số lượng vượt tồn kho', { variationId: VAR2.id, flashPrice: 100_000, quota: VAR2.stock + 1 }, /tồn kho/);
      await badItem('biến thể không có thật', { variationId: `${W13}khong-co` }, /.+/);
      const okItem = await api('POST', `/admin/flash-sales/${saleId}/items`, { variationId: VAR1.id, flashPrice: 80_000, quota: 10, perUserLimit: 2 });
      expect(okItem.status, okItem.text).toBe(201);
      const second = await api('POST', '/admin/flash-sales', { ...baseSale, title: 'W13 API đợt chồng giờ', startAt: vnAt(20, '10:00').toISOString(), endAt: vnAt(20, '12:00').toISOString() });
      expect(second.status, second.text).toBe(201);
      const clash = await api('POST', `/admin/flash-sales/${second.json.id}/items`, { variationId: VAR1.id, flashPrice: 70_000, quota: 5 });
      expect(clash.status, clash.text).toBe(400);
      expect(messageOf(clash), 'đợt chồng giờ cùng sản phẩm bị chặn').toMatch(/đã có trong đợt/);
      expect(messageOf(clash)).not.toMatch(TECHNICAL);
      const patchBad = await api('PATCH', `/admin/flash-sales/${saleId}`, { endAt: baseSale.startAt });
      expect(patchBad.status, 'sửa giờ kết thúc bằng giờ bắt đầu').toBe(400);
      expect(messageOf(patchBad)).toMatch(/bắt đầu phải trước/);
      expect((await api('DELETE', `/admin/flash-sales/${second.json.id}`)).status).toBe(200);

      // Tạo đợt bằng giao diện: ô trống khoá nút; bắt đầu = kết thúc và kết thúc trước bắt đầu bị chặn trước khi gửi; hợp lệ thì tạo được.
      const create = page.getByRole('button', { name: 'Tạo đợt', exact: true });
      const nameBox = page.getByRole('textbox', { name: 'Tên đợt', exact: true });
      await expect(create, 'form trống: nút Tạo khoá').toBeDisabled();
      await paste(nameBox, 'W13 Đợt tạo từ form');
      await expect(create, 'chưa có giờ: nút Tạo khoá').toBeDisabled();
      await setWhen('Giờ vàng bắt đầu lúc', 10, '09', '00');
      await setWhen('Giờ vàng kết thúc lúc', 10, '09', '00');
      const postsBefore = w.posts.length;
      await expect(page.locator('[aria-live="polite"]').filter({ hasText: /Giờ kết thúc phải sau giờ bắt đầu/ }), 'bắt đầu bằng kết thúc: báo ngay trên form').toBeVisible();
      await expect(create, 'bắt đầu bằng kết thúc: nút Tạo khoá').toBeDisabled();
      await setWhen('Giờ vàng kết thúc lúc', 9, '23', '45');
      await expect(page.locator('[aria-live="polite"]').filter({ hasText: /Giờ kết thúc phải sau giờ bắt đầu/ }), 'kết thúc trước bắt đầu: báo ngay trên form').toBeVisible();
      await expect(create).toBeDisabled();
      await expectCleanScreen(page, 'gio-vang-loi-gio');
      await shot(page, 'gio-vang', 'form-loi-gio', true);
      expect(w.posts.slice(postsBefore).filter((p) => /flash-sales/.test(p)), 'UI chặn trước khi gửi: không có lệnh ghi nào tới máy chủ').toEqual([]);
      await setWhen('Giờ vàng kết thúc lúc', 10, '11', '00');
      await expect(page.locator('[aria-live="polite"]').filter({ hasText: /Giờ kết thúc phải sau giờ bắt đầu/ })).toHaveCount(0);
      await expect(create).toBeEnabled();
      await create.click();
      await expect(page.getByText('Đã tạo đợt giờ vàng!')).toBeVisible();
      const mine = row('W13 Đợt tạo từ form');
      await expect(mine).toContainText('Sắp chạy');
      await expect(mine, 'giờ đã chọn lưu rồi đọc lại đúng giờ VN').toContainText(`09:00 ${dmy(10)} → 11:00 ${dmy(10)}`);

      // Sửa đợt: tên, giờ kết thúc ngược bị chặn, hợp lệ thì lưu.
      await mine.getByRole('button', { name: 'Sửa đợt', exact: true }).click();
      const save = mine.getByRole('button', { name: 'Lưu thay đổi', exact: true });
      await expect(save, 'chưa đổi gì: nút Lưu khoá').toBeDisabled();
      await paste(mine.getByRole('textbox', { name: 'Tên đợt (sửa)', exact: true }), 'W13 Đợt tạo từ form (đã sửa)');
      await paste(mine.getByRole('textbox', { name: 'Giờ vàng kết thúc lúc (sửa): ngày', exact: true }), dmyDigits(9));
      await expect(mine.locator('[aria-live="polite"]').filter({ hasText: /Giờ kết thúc phải sau giờ bắt đầu/ }), 'sửa kết thúc về trước bắt đầu: báo ngay').toBeVisible();
      await expect(save).toBeDisabled();
      await shot(page, 'gio-vang', 'sua-loi-gio', true);
      await paste(mine.getByRole('textbox', { name: 'Giờ vàng kết thúc lúc (sửa): ngày', exact: true }), dmyDigits(10));
      await mine.getByRole('combobox', { name: 'Giờ vàng kết thúc lúc (sửa): giờ', exact: true }).selectOption('12');
      await save.click();
      const edited = row('W13 Đợt tạo từ form (đã sửa)');
      await expect(edited).toContainText(`09:00 ${dmy(10)} → 12:00 ${dmy(10)}`);
      // Đợt đang chạy: không đổi được giờ bắt đầu, có câu giải thích.
      const live = row('W13 Đợt đang chạy');
      await live.getByRole('button', { name: 'Sửa đợt', exact: true }).click();
      await expect(live.getByRole('textbox', { name: 'Giờ vàng bắt đầu lúc (sửa): ngày', exact: true })).toBeDisabled();
      await expect(live).toContainText('không đổi được giờ bắt đầu');
      await live.getByRole('button', { name: 'Huỷ sửa', exact: true }).click();

      // Sản phẩm trong đợt: giá, số lượng, tồn kho, trùng sản phẩm, qua giao diện.
      await edited.getByRole('button', { name: /^Xem sản phẩm/ }).click();
      const pick = async (sku: string) => {
        await edited.getByRole('searchbox', { name: 'Chọn biến thể sản phẩm cho đợt giờ vàng' }).fill(sku);
        await edited.getByRole('option', { name: new RegExp(escapeRe(sku)) }).click();
      };
      const price = edited.getByRole('spinbutton', { name: 'Giá flash (đ)' });
      const quota = edited.getByRole('spinbutton', { name: /^Số lượng bán/ });
      const perUser = edited.getByRole('spinbutton', { name: 'Giới hạn mỗi khách' });
      const add = edited.getByRole('button', { name: 'Thêm SP', exact: true });
      await pick(VAR1.sku);
      await expect(add, 'chưa nhập giá và số lượng: nút khoá').toBeDisabled();
      for (const bad of ['0', '-5', '-80000']) {
        await paste(price, bad);
        await paste(quota, '10');
        await expect(add, `giá ${bad}: nút Thêm khoá`).toBeDisabled();
      }
      await paste(price, '80000');
      for (const bad of ['0', '-1']) {
        await paste(quota, bad);
        await expect(add, `số lượng ${bad}: nút Thêm khoá`).toBeDisabled();
      }
      const errText = async () => (await edited.locator('p.text-danger-fg').last().innerText()).trim();
      const tryAdd = async (p: string, q: string, why: string, re: RegExp) => {
        await paste(price, p);
        await paste(quota, q);
        await add.click();
        await expect(edited.locator('p.text-danger-fg').last(), why).toHaveText(re);
        expect(await errText(), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await tryAdd(String(VAR1.retail), '10', 'giá bằng giá gốc', /thấp hơn giá đang bán/);
      await tryAdd('5000', '10', 'giảm quá trần', /giảm quá 90%/);
      await tryAdd('79999.5', '10', 'giá lẻ', /.+/);
      await shot(page, 'gio-vang', 'form-loi-gia', true);
      await paste(price, '80000');
      await paste(quota, '10');
      await paste(perUser, '2');
      await add.click();
      await expect(edited).toContainText(`${VAR1.name} (${VAR1.sku}) · ${vnd(80_000)} · đã bán 0/10 · giới hạn 2/khách`);
      await pick(VAR1.sku);
      await tryAdd('70000', '5', 'cùng sản phẩm hai lần trong một đợt', /đã có trong đợt/);
      await edited.getByRole('button', { name: /^Đổi lựa chọn/ }).click();
      await pick(VAR2.sku);
      await paste(price, '100000');
      await tryAdd('100000', String(VAR2.stock + 1), 'số lượng vượt tồn kho', /vượt tồn kho/);
      await expectCleanScreen(page, 'gio-vang-san-pham');
      await shot(page, 'gio-vang', 'san-pham');
      expectCleanWatch('gio-vang', w, [
        { status: 400, path: /\/admin\/flash-sales/, why: 'thử giá và số lượng sai' },
      ]);
    });

    test('2. Mã giảm giá: trạng thái theo ngày, mã %, mã giảm tiền, đơn tối thiểu, lượt dùng, ngày bắt đầu/kết thúc', async ({ page }) => {
      test.setTimeout(300_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Mã giảm giá');
      const list = page.getByRole('region', { name: 'Mã đã tạo' });
      const item = (code: string) => list.locator('li').filter({ hasText: code });
      const chip = (name: string) => page.getByRole('group', { name: 'Lọc trạng thái mã' }).getByRole('button', { name, exact: true });
      const search = list.getByRole('searchbox', { name: 'Tìm mã' });
      await search.fill('E2EW13');

      // Năm trạng thái theo ngày; mỗi dòng có giá trị, đơn tối thiểu, ngày, lượt dùng.
      await expect(item('E2EW13RUN')).toContainText('Đang chạy');
      await expect(item('E2EW13RUN')).toContainText('Giảm 10%, tối đa 30.000đ · đơn từ 100.000đ');
      await expect(item('E2EW13RUN')).toContainText(`${dmy(-5)} – ${dmy(5)}`);
      await expect(item('E2EW13RUN')).toContainText('Đã dùng 0/100 lượt · 1 lượt/khách');
      await expect(item('E2EW13SOON')).toContainText('Sắp diễn ra');
      await expect(item('E2EW13SOON')).toContainText('Giảm 20.000đ');
      await expect(item('E2EW13SOON')).toContainText(`${dmy(3)} – ${dmy(10)}`);
      await expect(item('E2EW13OLD')).toContainText('Đã hết hạn');
      await expect(item('E2EW13OLD')).toContainText(`${dmy(-20)} – ${dmy(-10)}`);
      await expect(item('E2EW13OFF')).toContainText('Đã tắt');
      await expect(item('E2EW13FULL')).toContainText('Hết lượt');
      await expect(item('E2EW13FULL')).toContainText('Đã dùng 1/1 lượt · không giới hạn/khách');
      await expectCleanScreen(page, 'ma-giam-gia');
      await shot(page, 'ma-giam-gia', 'danh-sach');

      // Bộ lọc theo trạng thái khớp với nhãn của từng dòng: không dòng nào mang nhãn khác bộ lọc đang chọn.
      const badgeOf = async (code: string) => (await item(code).locator('span').filter({ hasText: /^(Đang chạy|Sắp diễn ra|Đã hết hạn|Đã tắt|Hết lượt)$/ }).first().innerText()).trim();
      const expectFilter = async (name: string, label: string, present: string[], absent: string[]) => {
        await chip(name).click();
        await expect(chip(name)).toHaveAttribute('aria-pressed', 'true');
        for (const code of present) await expect(item(code), `${name}: có ${code}`).toBeVisible();
        for (const code of absent) await expect(item(code), `${name}: không có ${code}`).toHaveCount(0);
        for (const code of present) expect(await badgeOf(code), `${name}: nhãn của ${code} khớp bộ lọc`).toBe(label);
      };
      await expectFilter('Đang chạy', 'Đang chạy', ['E2EW13RUN'], ['E2EW13SOON', 'E2EW13OLD', 'E2EW13OFF']);
      await expectFilter('Sắp diễn ra', 'Sắp diễn ra', ['E2EW13SOON'], ['E2EW13RUN', 'E2EW13OLD', 'E2EW13OFF']);
      await expectFilter('Đã hết hạn', 'Đã hết hạn', ['E2EW13OLD'], ['E2EW13RUN', 'E2EW13SOON']);
      await expectFilter('Đã tắt', 'Đã tắt', ['E2EW13OFF'], ['E2EW13RUN', 'E2EW13SOON', 'E2EW13OLD']);
      await chip('Tất cả').click();
      await search.fill('');

      // API chặn khi gọi thẳng: số âm, % quá 100, mức giảm bằng đơn tối thiểu, tổng lượt, ngày; lời báo tiếng Việt.
      const baseCoupon = { code: 'E2EW13API', type: 'PERCENT', value: 10, maxDiscount: 30_000, minOrder: 100_000, usageLimit: 50, perUserLimit: 1, scope: 'PUBLIC', startAt: vnAt(1, '00:00').toISOString(), endAt: vnAt(9, '23:59').toISOString() };
      const badCoupon = async (why: string, over: Record<string, unknown>, re: RegExp) => {
        const r = await api('POST', '/admin/coupons', { ...baseCoupon, ...over });
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await badCoupon('% quá 100', { value: 101 }, /100/);
      await badCoupon('% bằng 0', { value: 0 }, /lớn hơn 0/);
      await badCoupon('giá trị âm', { value: -10 }, /.+/);
      await badCoupon('% lẻ', { value: 12.5 }, /.+/);
      await badCoupon('% từ 50 mà không có trần giảm', { value: 60, maxDiscount: undefined }, /Giảm tối đa/);
      await badCoupon('trần giảm âm', { maxDiscount: -1 }, /không được âm/);
      await badCoupon('đơn tối thiểu âm', { minOrder: -1 }, /không được âm/);
      await badCoupon('giảm tiền bằng đơn tối thiểu', { type: 'AMOUNT', value: 100_000, maxDiscount: undefined }, /nhỏ hơn đơn tối thiểu/);
      await badCoupon('giảm tiền lớn hơn đơn tối thiểu', { type: 'AMOUNT', value: 150_000, maxDiscount: undefined }, /nhỏ hơn đơn tối thiểu/);
      await badCoupon('tổng lượt bằng 0', { usageLimit: 0 }, /từ 1 trở lên/);
      await badCoupon('tổng lượt âm', { usageLimit: -5 }, /.+/);
      await badCoupon('lượt mỗi khách âm', { perUserLimit: -1 }, /.+/);
      await badCoupon('kết thúc bằng bắt đầu', { endAt: baseCoupon.startAt }, /sau ngày bắt đầu/);
      await badCoupon('kết thúc trước bắt đầu', { startAt: baseCoupon.endAt, endAt: baseCoupon.startAt }, /sau ngày bắt đầu/);
      await badCoupon('hết hạn đã qua', { startAt: vnAt(-9, '00:00').toISOString(), endAt: vnAt(-2, '23:59').toISOString() }, /đã qua/);
      await badCoupon('ngày không đọc được', { endAt: 'không phải ngày' }, /.+/);
      await badCoupon('mã có khoảng trắng và ký tự lạ', { code: 'E2E W13 !' }, /.+/);
      await badCoupon('mã rỗng', { code: '' }, /.+/);
      expect(await withDb((prisma) => prisma.coupon.count({ where: { code: { startsWith: 'E2EW13API' } } })), 'mã bị từ chối thì không được tạo').toBe(0);

      // Tạo bằng giao diện.
      await page.getByRole('group', { name: 'Mục mã giảm giá' }).getByRole('button', { name: 'Tạo mã mới', exact: true }).click();
      const form = page.getByTestId('coupon-create-form');
      const code = form.getByRole('textbox', { name: 'Mã giảm giá', exact: true });
      const type = form.getByRole('combobox', { name: 'Loại mã giảm giá' });
      const value = form.getByRole('spinbutton', { name: 'Giá trị' });
      const minOrder = form.getByRole('spinbutton', { name: 'Đơn tối thiểu (đ)' });
      const maxDiscount = form.getByRole('spinbutton', { name: 'Giảm tối đa (đ)' });
      const usage = form.getByRole('spinbutton', { name: 'Tổng lượt dùng' });
      const perUser = form.getByRole('spinbutton', { name: 'Lượt / khách' });
      const startDay = form.getByRole('textbox', { name: 'Mã giảm giá bắt đầu từ ngày', exact: true });
      const endDay = form.getByRole('textbox', { name: 'Mã giảm giá hết hạn ngày', exact: true });
      const submit = form.getByRole('button', { name: 'Tạo mã giảm giá', exact: true });
      await expect(submit, 'form trống: nút Tạo khoá').toBeDisabled();
      await paste(code, 'e2e w13 pct');
      await expect(code, 'mã tự đổi sang chữ HOA không khoảng trắng').toHaveValue('E2EW13PCT');
      await paste(value, '20');
      await paste(minOrder, '200000');
      await paste(maxDiscount, '50000');
      await paste(usage, '100');
      await paste(perUser, '2');
      await paste(startDay, dmyDigits(1));
      await paste(endDay, dmyDigits(15));
      await expect(submit).toBeEnabled();
      await expectCleanScreen(page, 'ma-giam-gia-form');
      await shot(page, 'ma-giam-gia', 'form-tao');
      await submit.click();
      await expect(form.getByText('Đã tạo mã giảm giá!')).toBeVisible();

      // Ngày hết hạn sớm hơn ngày bắt đầu, ngày hết hạn đã qua: báo ngay, khoá nút, không gửi gì.
      await paste(code, 'E2EW13LATE');
      await paste(startDay, dmyDigits(5));
      await paste(endDay, dmyDigits(2));
      const postsBefore = w.posts.length;
      await expect(form.getByRole('alert').filter({ hasText: /không được sớm hơn ngày bắt đầu/ })).toBeVisible();
      await expect(submit).toBeDisabled();
      await paste(startDay, '');
      await paste(endDay, dmyDigits(-2));
      await expect(form.getByRole('alert').filter({ hasText: /đã qua/ })).toBeVisible();
      await expect(submit).toBeDisabled();
      await shot(page, 'ma-giam-gia', 'form-loi-ngay', true);
      expect(w.posts.slice(postsBefore).filter((p) => /coupons/.test(p)), 'UI chặn trước khi gửi: không có lệnh ghi nào').toEqual([]);

      // Mã giảm tiền cố định, đơn tối thiểu, không giới hạn lượt; ngày bắt đầu bỏ trống = hiệu lực ngay.
      await paste(code, 'E2EW13AMT');
      await type.selectOption('AMOUNT');
      await paste(value, '30000');
      await paste(minOrder, '100000');
      await paste(maxDiscount, '');
      await paste(usage, '');
      await paste(perUser, '1');
      await paste(endDay, dmyDigits(10));
      await submit.click();
      await expect(form.getByText('Đã tạo mã giảm giá!')).toBeVisible();

      // Lỗi từ máy chủ hiện bằng tiếng Việt ngay dưới nút: % quá 100, số âm, thiếu trần, trùng mã.
      const tryBad = async (why: string, fill: () => Promise<void>, re: RegExp) => {
        await fill();
        await expect(submit, `${why}: nút Tạo mở để máy chủ trả lời`).toBeEnabled();
        const r = await submitAndRead(page, () => submit.click(), /\/admin\/coupons$/);
        expect(r.status, `${why}: ${r.body}`).toBe(400);
        const text = (await form.locator('p.text-danger-fg').last().innerText()).trim();
        expect(text, why).toMatch(re);
        expect(text, `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await paste(code, 'E2EW13BAD');
      await paste(endDay, dmyDigits(10));
      await type.selectOption('PERCENT');
      await paste(minOrder, '');
      await paste(usage, '10');
      await tryBad('% quá 100', async () => { await paste(value, '150'); }, /100/);
      await tryBad('% bằng 0', async () => { await paste(value, '0'); }, /lớn hơn 0/);
      await tryBad('% âm', async () => { await paste(value, '-5'); }, /.+/);
      await tryBad('% từ 50 không có trần', async () => { await paste(value, '60'); await paste(maxDiscount, ''); }, /Giảm tối đa/);
      await tryBad('trần giảm âm', async () => { await paste(value, '10'); await paste(maxDiscount, '-1'); }, /không được âm/);
      await tryBad('tổng lượt bằng 0', async () => { await paste(maxDiscount, '20000'); await paste(usage, '0'); }, /từ 1 trở lên/);
      await tryBad('đơn tối thiểu âm', async () => { await paste(usage, '10'); await paste(minOrder, '-100'); }, /không được âm/);
      await shot(page, 'ma-giam-gia', 'form-loi-may-chu', true);
      await paste(minOrder, '');
      await paste(code, 'E2EW13PCT');
      await paste(value, '10');
      await paste(maxDiscount, '20000');
      await submit.click();
      await expect(form.locator('p.text-danger-fg').last()).toContainText('đã tồn tại');

      // Danh sách sau khi tạo: giá trị, trần giảm, đơn tối thiểu, lượt dùng, ngày; trạng thái đúng theo ngày.
      await page.getByRole('group', { name: 'Mục mã giảm giá' }).getByRole('button', { name: 'Mã đã tạo', exact: true }).click();
      await search.fill('E2EW13PCT');
      await expect(item('E2EW13PCT')).toContainText('Sắp diễn ra');
      await expect(item('E2EW13PCT')).toContainText('Giảm 20%, tối đa 50.000đ · đơn từ 200.000đ');
      await expect(item('E2EW13PCT')).toContainText(`${dmy(1)} – ${dmy(15)}`);
      await expect(item('E2EW13PCT')).toContainText('Đã dùng 0/100 lượt · 2 lượt/khách');
      await search.fill('E2EW13AMT');
      await expect(item('E2EW13AMT')).toContainText('Đang chạy');
      await expect(item('E2EW13AMT')).toContainText('Giảm 30.000đ · đơn từ 100.000đ');
      await expect(item('E2EW13AMT')).toContainText(`${dmy(0)} – ${dmy(10)}`);
      await expect(item('E2EW13AMT')).toContainText('Đã dùng 0 lượt');
      await expect(item('E2EW13AMT')).toContainText('1 lượt/khách');
      await expect(item('E2EW13LATE')).toHaveCount(0);
      await expect(item('E2EW13BAD')).toHaveCount(0);
      expect(await withDb((prisma) => prisma.coupon.count({ where: { code: { in: ['E2EW13LATE', 'E2EW13BAD'] } } })), 'mã bị chặn thì không được tạo').toBe(0);

      // Gia hạn và tắt/bật: ngày hết hạn theo giờ VN, tắt đổi nhãn.
      const amt = item('E2EW13AMT');
      await amt.getByRole('textbox', { name: 'Đổi ngày hết hạn mã E2EW13AMT' }).fill(dmyDigits(20));
      await amt.getByRole('button', { name: 'Lưu hạn', exact: true }).click();
      await expect(page.getByText(`Đã đổi hạn mã E2EW13AMT đến hết ${dmy(20)}.`)).toBeVisible();
      await expect(amt).toContainText(`${dmy(0)} – ${dmy(20)}`);
      await amt.getByRole('button', { name: 'Tắt mã', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Tắt mã', exact: true }).click();
      await expect(amt).toContainText('Đã tắt');
      await expect(amt.getByRole('button', { name: 'Bật lại', exact: true })).toBeVisible();
      await expectCleanScreen(page, 'ma-giam-gia-sau-tao');
      await shot(page, 'ma-giam-gia', 'sau-khi-tao');
      expectCleanWatch('ma-giam-gia', w, [{ status: 400, path: /\/admin\/coupons/, why: 'thử số âm, % quá 100' }, { status: 409, path: /\/admin\/coupons/, why: 'thử mã trùng' }]);
    });

    test('3. Tổng quan chỉ số và Báo cáo: bộ lọc 7 ngày, 30 ngày, tuỳ chọn; ngày sai; kỳ trống không NaN', async ({ page }) => {
      test.setTimeout(300_000);
      const w = watch(page);
      await openAdmin(page);

      // Tổng quan chỉ số: số trên thẻ bằng số của API đọc ngay lúc kiểm; phần đơn của spec (đọc từ DB theo mã E2EW13-) nằm trong số tổng.
      const openStats = () => gotoNav(page, 'Tổng quan chỉ số');
      await openStats();
      const mineAll = await ownOrders(null, null);
      expect(mineAll, 'DB có đủ đơn seed của spec').toEqual(partOf(ORDERS));
      const revenueCard = page.locator('div.shadow-card').filter({ hasText: 'Doanh thu đã thu' }).first();
      await expectMatchesApi(page, openStats, async () => {
        const stats = await readStats();
        await expect(revenueCard.locator('.text-2xl')).toHaveText(vnd(stats.totalRevenue));
        await expect(page.locator('div.shadow-card').filter({ hasText: 'Tổng đơn hàng' }).first().locator('.text-2xl')).toHaveText(String(stats.totalOrders));
        expect(stats.totalRevenue, 'doanh thu đã thu gồm đơn đã giao đã thanh toán của spec').toBeGreaterThanOrEqual(mineAll.revenue);
        expect(stats.gmv, 'giá trị đơn gồm đơn đã xác nhận trở đi của spec').toBeGreaterThanOrEqual(mineAll.gmv);
        expect(stats.totalOrders, 'tổng đơn gồm đơn của spec').toBeGreaterThanOrEqual(mineAll.orders);
      });
      await expectCleanScreen(page, 'tong-quan');
      await shot(page, 'tong-quan', 'the-so');

      const openReports = async () => {
        await gotoNav(page, 'Báo cáo');
        await expect(page.getByRole('heading', { name: 'Doanh thu theo ngày và kênh' })).toBeVisible();
      };
      await openReports();
      const tile = (label: string) => page.locator(`[data-kpi="${label}"] dd`);
      const preset = (name: string) => page.getByRole('button', { name, exact: true });
      const from = page.getByRole('textbox', { name: 'Từ ngày', exact: true });
      const to = page.getByRole('textbox', { name: 'Đến ngày', exact: true });
      /** Mọi ô số liệu của màn bằng số của API cho khoảng đó, đọc ngay lúc kiểm; lệch thì mở lại Báo cáo, chọn lại khoảng (`pick`) và đọc lại. */
      const expectTiles = (fromKey: string, toKey: string, why: string, pick: () => Promise<void>) =>
        expectMatchesApi(page, async () => { await openReports(); await pick(); }, async () => {
          const t = await readRange(fromKey, toKey);
          await expect(tile('Doanh thu (đã thu)'), why).toHaveText(vnd(t.revenue));
          await expect(tile('Tổng giá trị đơn đặt'), why).toHaveText(vnd(t.gmv));
          await expect(tile('Đơn đặt'), why).toHaveText(String(t.orders));
          await expect(tile('Đơn huỷ / trả'), why).toHaveText(String(t.cancelled));
          await expect(tile('Đã hoàn một phần'), why).toHaveText(vnd(t.partialRefund));
          await expect(tile('Khách mới'), why).toHaveText(String(t.newUsers));
          return t;
        });

      // Mặc định 30 ngày; các mốc nhanh 7, 30, 90 ngày: số bằng API và gồm đơn của spec (đọc từ DB theo mã E2EW13- và ngày giờ VN); dòng chú thích nói đúng ngày và số ngày.
      for (const [key, name, days] of [['r7', '7 ngày', 7], ['r30', '30 ngày', 30], ['r90', '90 ngày', 90]] as const) {
        const pickPreset = async () => {
          await preset(name).click();
          await expect(preset(name)).toHaveAttribute('aria-pressed', 'true');
        };
        await pickPreset();
        const fromKey = ymd(RANGES[key][0]);
        const toKey = ymd(RANGES[key][1]);
        const mine = await ownOrders(fromKey, toKey);
        expect(mine, `${name}: DB có đúng đơn seed của spec trong khoảng`).toEqual(partOf(inRange(key)));
        const t = await expectTiles(fromKey, toKey, name, pickPreset);
        expect(t.revenue, `${name}: doanh thu gồm đơn của spec`).toBeGreaterThanOrEqual(mine.revenue);
        expect(t.gmv, `${name}: giá trị đơn gồm đơn của spec`).toBeGreaterThanOrEqual(mine.gmv);
        expect(t.orders, `${name}: số đơn gồm đơn của spec`).toBeGreaterThanOrEqual(mine.orders);
        expect(t.cancelled, `${name}: đơn huỷ gồm đơn của spec`).toBeGreaterThanOrEqual(mine.cancelled);
        await expect(page.getByText(new RegExp(`${escapeRe(dmy(RANGES[key][0]))} – ${escapeRe(dmy(0))} \\(${days} ngày\\)`))).toBeVisible();
        await expect(from).toHaveValue(dmy(RANGES[key][0]));
        await expect(to).toHaveValue(dmy(0));
        await expectCleanScreen(page, `bao-cao-${name}`);
        if (key === 'r7') await shot(page, 'bao-cao', '7-ngay');
      }
      await shot(page, 'bao-cao', '90-ngay');

      // Tuỳ chọn: một ngày có đơn (đơn A, ngày -2) cho đúng số tiền của đơn.
      const pickDay = async () => {
        await paste(from, dmyDigits(-2));
        await paste(to, dmyDigits(-2));
        await expect(from).toHaveValue(dmy(-2));
        await expect(to).toHaveValue(dmy(-2));
        await expect(preset('7 ngày')).toHaveAttribute('aria-pressed', 'false');
      };
      await pickDay();
      const one = await expectTiles(ymd(-2), ymd(-2), 'một ngày tuỳ chọn', pickDay);
      await expect(page.locator(`tr[data-day="${ymd(-2)}"]`)).toContainText(dmy(-2));
      expect(one.revenue, 'ngày -2: doanh thu không nhỏ hơn đơn A của spec').toBeGreaterThanOrEqual(ORDERS[0]!.total);
      await shot(page, 'bao-cao', 'tuy-chon-mot-ngay');

      // Từ ngày sau Đến ngày: báo đúng một câu rõ ràng, không gọi API tính số.
      await paste(from, dmyDigits(0));
      await paste(to, dmyDigits(-5));
      await to.blur();
      const rangeAlerts = page.getByRole('alert');
      await expect(rangeAlerts.filter({ hasText: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' }).first()).toBeVisible();
      const alertTexts = (await rangeAlerts.allInnerTexts()).map((t) => t.trim());
      note('bao-cao', `Từ ngày sau Đến ngày báo: ${JSON.stringify(alertTexts)}`);
      expect(alertTexts.filter((t) => /Ngày nằm ngoài khoảng cho phép/.test(t)), 'không báo thêm câu chung chung "ngoài khoảng cho phép" bên cạnh câu rõ ràng').toEqual([]);
      await expect(page.getByRole('button', { name: 'Xuất CSV đơn hàng' }), 'khoảng ngày sai: không còn nút xuất cho khoảng không tính được').toHaveCount(0);
      await expect(page.locator('[data-kpi="Doanh thu (đã thu)"]'), 'khoảng ngày sai: không hiện số của khoảng cũ').toHaveCount(0);
      await expectCleanScreen(page, 'bao-cao-tu-sau-den');
      await shot(page, 'bao-cao', 'tu-sau-den');

      // Gõ dở, ngày không có thật, thiếu ngày, quá năm.
      await paste(from, '31/02/2026');
      await from.blur();
      await expect(page.getByRole('alert').filter({ hasText: /Ngày không có thật/ })).toBeVisible();
      await paste(from, '');
      await paste(to, '');
      await expect(page.getByRole('alert').filter({ hasText: 'Chọn đủ ngày bắt đầu và ngày kết thúc.' })).toBeVisible();
      await paste(from, ymd(-1000).split('-').reverse().join('/'));
      await paste(to, dmyDigits(0));
      await to.blur();
      const longAlert = page.getByRole('alert').filter({ hasText: /Khoảng ngày tối đa 366 ngày\./ });
      await expect(longAlert.first()).toBeVisible();
      expect((await longAlert.first().innerText()).trim()).not.toMatch(/undefined|NaN|\[object|REVENUE_MAX/);
      await shot(page, 'bao-cao', 'qua-nam');

      // Kỳ trống: một tuần năm 2019 không có đơn nào. Mọi ô là 0, có câu "Không có đơn", không NaN, không chia cho 0.
      const pickEmpty = async () => {
        await paste(from, EMPTY.typedFrom);
        await paste(to, EMPTY.typedTo);
        await expect(from).toHaveValue('01/03/2019');
      };
      await pickEmpty();
      const empty = await expectTiles(EMPTY.from, EMPTY.to, 'kỳ trống', pickEmpty);
      expect([empty.revenue, empty.gmv, empty.orders, empty.cancelled, empty.partialRefund], 'kỳ trống: API trả toàn số 0').toEqual([0, 0, 0, 0, 0]);
      await expect(page.getByText('Không có đơn nào trong khoảng ngày này.')).toBeVisible();
      await expect(page.locator('tr[data-day]'), 'kỳ trống: không có dòng ngày nào').toHaveCount(0);
      await expect(page.getByText('Không có khách mới nào trong khoảng ngày này.')).toBeVisible();
      await expectCleanScreen(page, 'bao-cao-ky-trong');
      await shot(page, 'bao-cao', 'ky-trong');
      const dl = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      await page.getByRole('button', { name: 'Xuất CSV đơn hàng' }).click();
      const file = await dl;
      const status = (await page.getByRole('status').filter({ hasText: /Đã tải|Không/ }).allInnerTexts()).map((t) => t.trim()).join(' | ');
      note('bao-cao', `xuất CSV đơn của kỳ trống: ${file ? file.suggestedFilename() : 'không có file'}; thông báo: ${status || '(không có)'}`);
      expect(status, 'xuất kỳ trống không lộ lỗi kỹ thuật').not.toMatch(TECHNICAL);

      // Bảng top sản phẩm bán chạy và biểu đồ doanh thu: màn Báo cáo chỉ có KPI và bảng ngày × kênh.
      const bestSeller = await page.getByText(/bán chạy|top sản phẩm/i).count();
      note('bao-cao', `chữ "bán chạy" hoặc "top sản phẩm" trên màn Báo cáo: ${bestSeller} chỗ (không có bảng top sản phẩm, không có biểu đồ)`);
      expectCleanWatch('bao-cao', w);
    });

    test('4. Hoa hồng & giá sỉ: tiền và giá sỉ, form sửa %, đặt cả sản phẩm, về mặc định, nhập CSV xem trước', async ({ page }) => {
      test.setTimeout(300_000);
      const w = watch(page);
      const pct = (n: number) => `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
      const listJson = await apiJson('/admin/commission-rates?q=E2EW13');
      const maxRate = Number(listJson.maxRate);
      const defRate = Number(listJson.defaultRate);
      const rateOf = async (id: string): Promise<number | null> => {
        const row = await withDb((prisma) => prisma.variation.findUnique({ where: { id }, select: { affiliateRate: true } }));
        return row.affiliateRate === null ? null : Number(row.affiliateRate);
      };

      // API chặn khi gọi thẳng: số âm, thập phân, vượt trần, chữ, thiếu giá trị; lời báo tiếng Việt, DB không đổi.
      const putRate = (id: string, body: unknown) => api('PUT', `/admin/commission-rates/variations/${id}`, body);
      const badApi = async (why: string, body: unknown, re: RegExp) => {
        const r = await putRate(VAR1.id, body);
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ chữ kỹ thuật`).not.toMatch(TECHNICAL);
      };
      await badApi('% âm', { rate: -1 }, /không được âm/);
      await badApi('% thập phân', { rate: 7.5 }, /số nguyên/);
      await badApi('% vượt trần', { rate: maxRate + 1 }, new RegExp(`${maxRate}%`));
      await badApi('% là chữ', { rate: 'abc' }, /.+/);
      await badApi('thiếu %', {}, /.+/);
      note('hoa-hong', `API vượt trần trả: ${messageOf(await putRate(VAR1.id, { rate: maxRate + 1 }))}`);
      expect(await rateOf(VAR1.id), 'lệnh bị chặn thì DB không đổi').toBeNull();
      expect((await putRate(`${W13}khong-co`, { rate: 5 })).status, 'biến thể không có thật').toBe(404);

      await openAdmin(page);
      await gotoNav(page, 'Hoa hồng & giá sỉ');
      await expect(page.getByRole('heading', { name: 'Hoa hồng & giá sỉ', level: 2 })).toBeVisible();
      await expect(page.getByText(`Mức mặc định khi để trống: ${pct(defRate)}`)).toBeVisible();
      await expect(page.getByText(`Trần mỗi biến thể: ${pct(maxRate)}`)).toBeVisible();
      await page.getByRole('searchbox', { name: 'Tìm theo tên sản phẩm hoặc SKU' }).fill('E2EW13');
      const card = page.locator('[data-commission-product]').filter({ hasText: PRODUCT.name });
      await expect(card).toHaveCount(1);
      const vrow = (sku: string) => card.locator('[data-commission-variation]').filter({ hasText: sku });
      const nullLine = (price: number) => `Giá ${vnd(price)} · Mặc định ${pct(defRate)}${defRate > 0 ? ` ≈ ${vnd(Math.floor((price * defRate) / 100))}/sp` : ''}`;
      await expect(vrow(VAR1.sku)).toContainText(nullLine(VAR1.retail));
      await expect(vrow(VAR2.sku), 'giá hiện là giá khuyến mãi khi có').toContainText(nullLine(VAR2.sale));
      await expect(vrow(VAR1.sku)).toContainText(`Giá sỉ: ${TIER.name} ${vnd(TIER.price)}`);
      await expectCleanScreen(page, 'hoa-hong');
      await shot(page, 'hoa-hong', 'danh-sach');

      // Ô % của từng biến thể: sai định dạng báo ngay dưới ô, nút Lưu khoá, không gọi máy chủ.
      const rateBox = (sku: string) => page.getByRole('textbox', { name: `% hoa hồng ${sku}`, exact: true });
      const save = (sku: string) => vrow(sku).getByRole('button', { name: 'Lưu', exact: true });
      const postsBefore = w.posts.length;
      const bad: [string, RegExp][] = [
        ['abc', /Chỉ nhập số/],
        ['-5', /Không được âm/],
        ['7,5', /Không phải số nguyên/],
        ['1e2', /Chỉ nhập số/],
        ['12abc', /Chỉ nhập số/],
        [String(maxRate + 1), new RegExp(`Tối đa ${maxRate}%`)],
      ];
      for (const [text, re] of bad) {
        await paste(rateBox(VAR2.sku), text);
        const alert = vrow(VAR2.sku).getByRole('alert');
        await expect(alert, `gõ "${text}"`).toContainText(re);
        expect((await alert.innerText()).trim(), `gõ "${text}": không lộ chữ kỹ thuật`).not.toMatch(TECHNICAL);
        await expect(save(VAR2.sku), `gõ "${text}": nút Lưu khoá`).toBeDisabled();
        await expect(rateBox(VAR2.sku)).toHaveAttribute('aria-invalid', 'true');
      }
      await shot(page, 'hoa-hong', 'o-sai');
      expect(w.posts.slice(postsBefore).filter((p) => /commission-rates/.test(p)), 'ô sai: không có lệnh ghi nào').toEqual([]);

      // Lưu %: nhận "12", "12 %" và "0"; dòng hiện mức mới kèm số tiền ước tính theo giá đang bán, DB đúng.
      await paste(rateBox(VAR2.sku), '12');
      await expect(save(VAR2.sku)).toBeEnabled();
      const saved = await submitAndRead(page, () => save(VAR2.sku).click(), new RegExp(`/admin/commission-rates/variations/${VAR2.id}$`), 'PUT');
      expect(saved.status, saved.body).toBe(200);
      await expect(vrow(VAR2.sku)).toContainText('Đã lưu 12%.');
      await expect(vrow(VAR2.sku)).toContainText(`Giá ${vnd(VAR2.sale)} · 12% ≈ ${vnd(Math.floor((VAR2.sale * 12) / 100))}/sp`);
      expect(await rateOf(VAR2.id)).toBe(12);
      await paste(rateBox(VAR2.sku), '0 %');
      await save(VAR2.sku).click();
      await expect(vrow(VAR2.sku)).toContainText('Đã lưu 0%.');
      await expect(vrow(VAR2.sku), '0% là mức đã đặt, không có số tiền ước tính').not.toContainText('≈');
      expect(await rateOf(VAR2.id), '0 là mức đã đặt, khác chưa đặt').toBe(0);
      await paste(rateBox(VAR1.sku), String(maxRate));
      await save(VAR1.sku).click();
      await expect(vrow(VAR1.sku)).toContainText(`Đã lưu ${pct(maxRate)}.`);
      expect(await rateOf(VAR1.id), 'đúng bằng trần thì được').toBe(maxRate);

      // Đặt cho cả sản phẩm: quá trần bị chặn ở ô, hợp lệ thì hỏi xác nhận rồi đổi mọi biến thể đang bán.
      const allBox = page.getByRole('textbox', { name: `% cho mọi biến thể đang bán của ${PRODUCT.name}`, exact: true });
      const allBtn = card.getByRole('button', { name: 'Đặt cho cả SP', exact: true });
      await paste(allBox, String(maxRate + 1));
      await allBtn.click();
      await expect(card.getByRole('alert').first()).toContainText(`Tối đa ${pct(maxRate)}`);
      await paste(allBox, '20');
      await allBtn.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(`Đặt 20% cho 2 biến thể đang bán của "${PRODUCT.name}"`);
      await shot(page, 'hoa-hong', 'xac-nhan-ca-sp', true);
      await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
      expect([await rateOf(VAR1.id), await rateOf(VAR2.id)], 'huỷ thì không đổi').toEqual([maxRate, 0]);
      await allBtn.click();
      const bulk = await submitAndRead(page, () => dialog.getByRole('button', { name: 'Đặt 20%', exact: true }).click(), new RegExp(`/admin/commission-rates/products/${PRODUCT.id}$`), 'PUT');
      expect(bulk.status, bulk.body).toBe(200);
      await expect(card).toContainText('Đã đặt 20% cho 2 biến thể đang bán.');
      expect([await rateOf(VAR1.id), await rateOf(VAR2.id)]).toEqual([20, 20]);
      await expect(rateBox(VAR1.sku)).toHaveValue('20');

      // Về mức mặc định: hỏi xác nhận, nói rõ mức sẽ tính, đặt lại NULL.
      await vrow(VAR1.sku).getByRole('button', { name: `Về mặc định ${VAR1.sku}`, exact: true }).click();
      await expect(dialog).toContainText(`Xoá 20% riêng của ${VAR1.sku}`);
      await expect(dialog).toContainText(`sẽ trả ${pct(defRate)} mặc định`);
      await dialog.getByRole('button', { name: 'Về mặc định', exact: true }).click();
      await expect(vrow(VAR1.sku)).toContainText('Đã về mức mặc định.');
      await expect(vrow(VAR1.sku)).toContainText(nullLine(VAR1.retail));
      expect(await rateOf(VAR1.id)).toBeNull();
      await expectCleanScreen(page, 'hoa-hong-sau-luu');
      await shot(page, 'hoa-hong', 'sau-khi-luu');

      // Áp một mức cho mọi biến thể chưa có %: chỉ kiểm ô và hộp xác nhận, bấm Huỷ để không đổi biến thể nào của DB dùng chung.
      const fillBox = page.getByRole('textbox', { name: '% áp cho biến thể chưa có %', exact: true });
      if (await fillBox.count()) {
        const fillBtn = page.getByRole('button', { name: 'Áp dụng', exact: true }).first();
        await paste(fillBox, 'abc');
        await fillBtn.click();
        await expect(page.getByRole('alert').filter({ hasText: /Chỉ nhập số/ }).first()).toBeVisible();
        await paste(fillBox, '-3');
        await fillBtn.click();
        await expect(page.getByRole('alert').filter({ hasText: /Không được âm/ }).first()).toBeVisible();
        await paste(fillBox, String(maxRate + 1));
        await fillBtn.click();
        await expect(page.getByRole('alert').filter({ hasText: new RegExp(`Tối đa ${maxRate}%`) }).first()).toBeVisible();
        await paste(fillBox, '10');
        await fillBtn.click();
        await expect(dialog).toContainText('Đặt 10% cho');
        await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
        expect(w.posts.filter((p) => /fill-missing/.test(p)), 'huỷ thì không gửi lệnh áp hàng loạt').toEqual([]);
      } else note('hoa-hong', 'không còn biến thể hàng Tubu thiếu %: ô áp hàng loạt không hiện');

      // Nhập CSV: chỉ xem trước (không bấm Áp dụng). Mỗi dòng một trạng thái, lời báo tiếng Việt.
      const csv = [`${VAR1.sku},15`, `${VAR2.sku},${maxRate + 5}`, 'E2EW13-KHONGCO,5', `${VAR1.sku},16`, 'E2EW13-V9,abc', `${VAR2.sku},mặc định`].join('\n');
      await page.getByRole('textbox', { name: 'Nội dung CSV sku,% hoa hồng', exact: true }).fill(csv);
      await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
      const importRow = (status: string) => page.locator(`[data-import-row="${status}"]`);
      await expect(importRow('OVER_CAP')).toHaveCount(1);
      await expect(importRow('DUPLICATE'), 'hai dòng của V1 và dòng thứ hai của V2').toHaveCount(3);
      await expect(importRow('NOT_FOUND')).toHaveCount(1);
      await expect(importRow('INVALID')).toHaveCount(1);
      const previewText = (await page.locator('[data-import-row]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
      note('hoa-hong', `CSV xem trước: ${previewText}`);
      expect(previewText, 'CSV: không lộ chữ kỹ thuật').not.toMatch(TECHNICAL);
      await expect(page.getByText(/Còn \d+ dòng lỗi/)).toBeVisible();
      await expect(page.getByRole('button', { name: /^Áp dụng \d+ dòng$/ }), 'còn dòng lỗi thì không áp được').toBeDisabled();
      await shot(page, 'hoa-hong', 'csv-xem-truoc');
      expect([await rateOf(VAR1.id), await rateOf(VAR2.id)], 'xem trước không ghi DB').toEqual([null, 20]);
      expect(w.posts.filter((p) => /import\/apply/.test(p)), 'xem trước không gửi lệnh áp').toEqual([]);
      await expectCleanScreen(page, 'hoa-hong-csv');
      expectCleanWatch('hoa-hong', w);
    });

    test('5. Thuế TNCN hoa hồng: tổng theo tháng giờ Việt Nam, MST/CCCD, tiền, tháng trống, lệnh rút cũ', async ({ page }) => {
      test.setTimeout(300_000);
      const w = watch(page);
      const cur = new Date(CLOCK.at + VN_OFFSET_MS).toISOString().slice(0, 7);
      const summary = (ym: string, t: { rows: number; gross: number; tax: number; net: number }) => {
        const [y, m] = ym.split('-');
        return `Tổng tháng ${m}/${y}: ${t.rows} người nhận · thu nhập ${vnd(t.gross)} · thuế đã khấu trừ ${vnd(t.tax)} · thực chi ${vnd(t.net)}`;
      };
      const pickMonth = async (ym: string) => {
        const [y, m] = ym.split('-');
        await page.getByLabel('Tháng báo cáo: năm', { exact: true }).selectOption(y!);
        await page.getByLabel('Tháng báo cáo: tháng', { exact: true }).selectOption(m!);
      };
      const taxRow = (name: string) => page.locator('table tbody tr').filter({ hasText: name });

      // API: tháng sai dạng bị chặn bằng câu tiếng Việt.
      for (const bad of ['2026-13', '2026-3', 'abc', '']) {
        const r = await api('GET', `/admin/payouts/pit-report?month=${encodeURIComponent(bad)}`);
        expect(r.status, `tháng "${bad}": ${r.text}`).toBe(400);
        expect(messageOf(r), `tháng "${bad}"`).toMatch(/YYYY-MM|tháng/i);
        expect(messageOf(r), `tháng "${bad}": không lộ chữ kỹ thuật`).not.toMatch(TECHNICAL);
      }

      await openAdmin(page);
      const openTax = async () => {
        await gotoNav(page, 'Thuế TNCN hoa hồng');
        await expect(page.getByRole('heading', { name: 'Thuế TNCN hoa hồng', level: 2 })).toBeVisible();
      };
      await openTax();
      /** Tổng của tháng `ym` trên màn bằng số của API đọc ngay lúc kiểm; lệch (spec khác vừa ghi lệnh chi) thì mở lại màn, chọn lại tháng và đọc lại. */
      const expectSummary = (ym: string) => expectMatchesApi(page, async () => { await openTax(); if (ym !== cur) await pickMonth(ym); }, async () => {
        const t = await readPit(ym);
        await expect(page.getByText(summary(ym, t))).toBeVisible();
        return t;
      });
      await expect(page.getByLabel('Tháng báo cáo: tháng', { exact: true }), 'mặc định là tháng hiện tại giờ Việt Nam').toHaveValue(cur.slice(5));
      await expectSummary(cur);

      // Tháng 3/2026: lệnh 00:30 ngày 01/03 giờ VN (còn 28/02 theo UTC) tính vào tháng 3; lệnh 23:30 ngày 28/02 giờ VN tính vào tháng 2.
      const ownMar = await ownPit(PIT_MONTH);
      expect(ownMar, 'tháng 3: DB có đúng hai lệnh chi của spec (theo người dùng e2e-w13-*)').toEqual({ rows: 2, gross: 13_500_000, tax: 1_350_000, net: 12_150_000 });
      await pickMonth(PIT_MONTH);
      const mar = await expectSummary(PIT_MONTH);
      expect(mar.rows, 'tháng 3: tổng gồm người nhận của spec').toBeGreaterThanOrEqual(ownMar.rows);
      expect(mar.gross, 'tháng 3: thu nhập gồm lệnh chi của spec').toBeGreaterThanOrEqual(ownMar.gross);
      expect(mar.tax, 'tháng 3: thuế gồm khoản khấu trừ của spec').toBeGreaterThanOrEqual(ownMar.tax);
      expect(mar.net, 'tháng 3: thực chi gồm lệnh chi của spec').toBeGreaterThanOrEqual(ownMar.net);
      await expect(taxRow(CTV_A.name).locator('td')).toHaveText([new RegExp(`${CTV_A.name}\\s*${CTV_A.phone}`), CTV_A.taxId, '1', vnd(6_000_000), vnd(600_000), vnd(5_400_000)]);
      await expect(taxRow(CTV_B.name).locator('td')).toHaveText([new RegExp(`${CTV_B.name}\\s*${CTV_B.phone}`), 'Thiếu MST/CCCD', '1', vnd(7_500_000), vnd(750_000), vnd(6_750_000)]);
      await expect(taxRow(CTV_A.name), 'lệnh 23:30 ngày 28/02 không lọt vào tháng 3').not.toContainText(vnd(9_000_000));
      for (const r of mar.json.rows.filter((x: { userId: string }) => x.userId.startsWith(W13))) {
        expect(r.grossAmount, `${r.fullName}: thu nhập = thuế + thực nhận`).toBe(r.taxWithheld + r.netAmount);
      }
      await expectCleanScreen(page, 'thue-tncn-thang-3');
      await shot(page, 'thue-tncn', 'thang-3');

      expect(await ownPit(PIT_FEB), 'tháng 2: DB có đúng một lệnh chi của spec').toEqual({ rows: 1, gross: 3_000_000, tax: 0, net: 3_000_000 });
      await pickMonth(PIT_FEB);
      await expectSummary(PIT_FEB);
      await expect(taxRow(CTV_A.name).locator('td')).toHaveText([new RegExp(`${CTV_A.name}\\s*${CTV_A.phone}`), CTV_A.taxId, '1', vnd(3_000_000), vnd(0), vnd(3_000_000)]);
      await expect(taxRow(CTV_B.name), 'CTV B không có lệnh chi nào trong tháng 2').toHaveCount(0);
      await expectCleanScreen(page, 'thue-tncn-thang-2');
      await shot(page, 'thue-tncn', 'thang-2');

      // Tháng không có lần chi nào: lời báo, tổng toàn 0, không có bảng.
      const quiet = await readPit('2022-01');
      if (quiet.rows === 0) {
        await pickMonth('2022-01');
        await expect(page.getByText(summary('2022-01', quiet))).toBeVisible();
        await expect(page.getByText('Không có lần chi hoa hồng nào trong tháng này.')).toBeVisible();
        await expect(page.locator('table')).toHaveCount(0);
        await expectCleanScreen(page, 'thue-tncn-thang-trong');
        await shot(page, 'thue-tncn', 'thang-trong');
      } else note('thue-tncn', 'tháng 01/2022 của DB gate đã có dữ liệu: bỏ qua ca tháng trống');

      // Bỏ trống ô tháng: không báo lỗi lạ, không giữ số của tháng trước.
      await page.getByLabel('Tháng báo cáo: tháng', { exact: true }).selectOption('');
      const afterBlank = (await page.getByRole('heading', { name: 'Khấu trừ thuế TNCN theo tháng' }).locator('xpath=ancestor::section[1]').innerText()).replace(/\s+/g, ' ');
      note('thue-tncn', `bỏ trống ô tháng, vùng báo cáo hiện: ${afterBlank}`);
      expect(afterBlank, 'bỏ trống tháng: không NaN/undefined').not.toMatch(/NaN|undefined|Invalid|\[object/);
      expect(afterBlank, 'bỏ trống tháng: không giữ số của tháng trước').not.toContain('Tổng tháng');
      expect(afterBlank, 'bỏ trống tháng: nói cần chọn đủ').toContain('Chọn đủ tháng và năm để xem báo cáo.');
      await shot(page, 'thue-tncn', 'bo-trong-thang');

      // Lệnh rút ngân hàng cũ: lệnh chờ duyệt hiện người nhận, số tiền, ngân hàng, giờ VN; từ chối không lý do bị chặn trước khi gửi.
      const legacy = page.getByRole('heading', { name: 'Lệnh rút ngân hàng cũ' }).locator('xpath=ancestor::section[1]');
      await expect(legacy.getByRole('tab', { name: 'Đang chờ duyệt', exact: true })).toHaveAttribute('aria-selected', 'true');
      const order = legacy.locator('div.rounded-card').filter({ hasText: 'Vietcombank' }).filter({ hasText: CTV_A.name });
      await expect(order).toHaveCount(1);
      await expect(order).toContainText(vnd(500_000));
      await expect(order).toContainText(`CTV: ${CTV_A.name} · mã E2EW13CA1`);
      await expect(order).toContainText('Vietcombank · STK 0123456789 · NGUYEN VAN A');
      await expect(order).toContainText(/\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/);
      const postsBefore = w.posts.length;
      await order.getByRole('button', { name: 'Từ chối (hoàn tiền)', exact: true }).click();
      await expect(order.getByRole('alert')).toContainText('Nhập lý do từ chối');
      await expect(page.getByRole('alertdialog'), 'thiếu lý do thì chưa hỏi xác nhận').toHaveCount(0);
      await order.getByRole('textbox').first().fill('Thử lý do');
      await order.getByRole('button', { name: 'Từ chối (hoàn tiền)', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText(`Từ chối lệnh rút ${vnd(500_000)}`);
      await shot(page, 'thue-tncn', 'xac-nhan-tu-choi', true);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Không từ chối', exact: true }).click();
      expect(w.posts.slice(postsBefore).filter((p) => /payouts/.test(p)), 'không từ chối: không gửi lệnh ghi nào').toEqual([]);
      await expect(order).toContainText('Đang chờ duyệt');
      await expectCleanScreen(page, 'thue-tncn-lenh-cu');
      await shot(page, 'thue-tncn', 'lenh-rut-cu');

      // Đã chuyển khoản: giờ chi hiện theo giờ Việt Nam bất kể múi giờ trình duyệt, tiền thuế đi kèm.
      await legacy.getByRole('tab', { name: 'Đã chuyển khoản', exact: true }).click();
      const paidRow = legacy.locator('div.rounded-card').filter({ hasText: CTV_A.name }).filter({ hasText: vnd(5_400_000) });
      await expect(legacy.getByText(/Đã chuyển khoản lúc/).first()).toBeVisible();
      for (let i = 0; i < 6 && (await paidRow.count()) === 0; i += 1) {
        const next = legacy.getByRole('button', { name: 'Sau →', exact: true });
        if ((await next.count()) === 0 || (await next.isDisabled())) break;
        await next.click();
      }
      if ((await paidRow.count()) === 0) note('thue-tncn', `không thấy lệnh đã chi của CTV A, vùng lệnh cũ hiện: ${(await legacy.innerText()).replace(/\s+/g, ' ').slice(0, 1500)}`);
      await expect(paidRow).toHaveCount(1);
      await expect(paidRow).toContainText(`Hoa hồng ${vnd(6_000_000)} · khấu trừ thuế TNCN ${vnd(600_000)} · MST/CCCD ${CTV_A.taxId}`);
      await expect(paidRow).toContainText('Đã chuyển khoản lúc: 00:30 01/03/2026');
      await expect(paidRow, 'lệnh chuyển hoa hồng vào Ví không nhầm với lệnh ngân hàng').toContainText('Chuyển vào Ví Tubu');
      await expectCleanScreen(page, 'thue-tncn-da-chi');
      await shot(page, 'thue-tncn', 'lenh-da-chi');
      expectCleanWatch('thue-tncn', w);
    });

    test('6. Chiến dịch và Combo và mua kèm: ngày bắt đầu/kết thúc, % giảm, thứ tự, lời báo, trạng thái', async ({ page }) => {
      test.setTimeout(420_000);
      const w = watch(page);
      const BANNER = 'https://cdn.w13.test/banner.svg';
      await page.route('https://cdn.w13.test/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600"><rect width="1500" height="600" fill="#cfe8d5"/></svg>' }),
      );
      const setWhen = async (scope: Locator, label: string, days: number, hh: string, mm: string) => {
        await paste(scope.getByRole('textbox', { name: `${label}: ngày`, exact: true }), dmyDigits(days));
        await scope.getByRole('combobox', { name: `${label}: giờ`, exact: true }).selectOption(hh);
        await scope.getByRole('combobox', { name: `${label}: phút`, exact: true }).selectOption(mm);
      };

      // Chiến dịch qua API: thời gian, ảnh, thứ tự, đích bấm; lời báo tiếng Việt, không có chiến dịch nào bị tạo.
      const camp = { title: 'W13 Chiến dịch API', placement: 'HOME_TOP', image: BANNER, linkType: 'CAMPAIGN_PAGE', audience: 'ALL', startAt: vnAt(5, '09:00').toISOString(), endAt: vnAt(6, '09:00').toISOString(), sortOrder: 0, isActive: false };
      const badCamp = async (why: string, over: Record<string, unknown>, re: RegExp) => {
        const r = await api('POST', '/admin/campaigns', { ...camp, ...over });
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await badCamp('kết thúc bằng bắt đầu', { endAt: camp.startAt }, /sau|bắt đầu/i);
      await badCamp('kết thúc trước bắt đầu', { endAt: vnAt(4, '09:00').toISOString() }, /sau|bắt đầu/i);
      await badCamp('ảnh không phải https', { image: 'http://cdn.w13.test/a.jpg' }, /.+/);
      await badCamp('thiếu ảnh', { image: '' }, /.+/);
      await badCamp('tên rỗng', { title: '   ' }, /.+/);
      await badCamp('thứ tự âm', { sortOrder: -1 }, /.+/);
      await badCamp('thứ tự quá 9999', { sortOrder: 10_000 }, /.+/);
      await badCamp('thứ tự thập phân', { sortOrder: 1.5 }, /.+/);
      await badCamp('đích Sản phẩm thiếu slug', { linkType: 'PRODUCT' }, /.+/);
      await badCamp('ngày sai dạng', { startAt: 'ngày mai' }, /.+/);
      expect(await withDb((prisma) => prisma.campaign.count({ where: { title: { startsWith: 'W13 Chiến dịch API' } } })), 'lệnh bị chặn thì không tạo chiến dịch').toBe(0);

      // Combo và mua kèm qua API: % ngoài 1–100, số lượng, trùng sản phẩm, ngày; rồi tạo đủ bốn trạng thái.
      const bundle = { kind: 'BUNDLE_PCT', title: 'W13 Combo API', pct: 15, startAt: vnAt(5, '09:00').toISOString(), endAt: vnAt(6, '09:00').toISOString(), isActive: true, sortOrder: 0, items: [{ productId: PRODUCT.id, maxQty: 1 }, { productId: PRODUCT2.id, maxQty: 1 }] };
      const badBundle = async (why: string, over: Record<string, unknown>, re: RegExp) => {
        const r = await api('POST', '/admin/bundles', { ...bundle, ...over });
        expect(r.status, `${why}: ${r.text}`).toBe(400);
        expect(messageOf(r), why).toMatch(re);
        expect(messageOf(r), `${why}: không lộ tên trường hay chữ của framework`).not.toMatch(TECHNICAL);
      };
      await badBundle('% bằng 0', { pct: 0 }, /.+/);
      await badBundle('% âm', { pct: -5 }, /.+/);
      await badBundle('% quá 100', { pct: 101 }, /.+/);
      await badBundle('% thập phân', { pct: 12.5 }, /.+/);
      await badBundle('kết thúc bằng bắt đầu', { endAt: bundle.startAt }, /sau|bắt đầu/i);
      await badBundle('một sản phẩm', { items: [{ productId: PRODUCT.id, maxQty: 1 }] }, /từ 2 đến|2 sản phẩm|ít nhất/);
      await badBundle('trùng sản phẩm', { items: [{ productId: PRODUCT.id, maxQty: 1 }, { productId: PRODUCT.id, maxQty: 1 }] }, /.+/);
      await badBundle('số lượng 0', { items: [{ productId: PRODUCT.id, maxQty: 0 }, { productId: PRODUCT2.id, maxQty: 1 }] }, /.+/);
      await badBundle('số lượng âm', { items: [{ productId: PRODUCT.id, maxQty: -1 }, { productId: PRODUCT2.id, maxQty: 1 }] }, /.+/);
      await badBundle('sản phẩm không có thật', { items: [{ productId: PRODUCT.id, maxQty: 1 }, { productId: `${W13}khong-co`, maxQty: 1 }] }, /.+/);
      note('combo', `% quá 100 qua API: ${messageOf(await api('POST', '/admin/bundles', { ...bundle, pct: 101 }))}`);
      expect(await withDb((prisma) => prisma.bundle.count({ where: { title: { startsWith: 'W13 Combo API' } } })), 'lệnh bị chặn thì không tạo bộ').toBe(0);
      const made = async (title: string, over: Record<string, unknown>) => {
        const r = await api('POST', '/admin/bundles', { ...bundle, title, ...over });
        note('combo', `tạo "${title}": ${r.status} ${r.status === 201 ? '' : r.text.slice(0, 200)}`);
        return r.status;
      };
      expect(await made('W13 Combo đang chạy', { startAt: new Date(CLOCK.at - HOUR_MS).toISOString(), endAt: new Date(CLOCK.at + 5 * HOUR_MS).toISOString() })).toBe(201);
      expect(await made('W13 Combo sắp chạy', { startAt: vnAt(3, '09:00').toISOString(), endAt: vnAt(4, '09:00').toISOString() })).toBe(201);
      expect(await made('W13 Combo đang tắt', { isActive: false })).toBe(201);
      const endedStatus = await made('W13 Combo đã kết thúc', { startAt: vnAt(-5, '09:00').toISOString(), endAt: vnAt(-3, '09:00').toISOString() });

      await openAdmin(page);
      await gotoNav(page, 'Combo và mua kèm');
      const brow = (title: string) => page.locator('div.rounded-card').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: `Sửa bộ ${title}`, exact: true }) });
      await expect(brow('W13 Combo đang chạy')).toContainText('Đang chạy');
      await expect(brow('W13 Combo sắp chạy')).toContainText('Sắp chạy');
      await expect(brow('W13 Combo đang tắt')).toContainText('Đang tắt');
      if (endedStatus === 201) await expect(brow('W13 Combo đã kết thúc')).toContainText('Đã kết thúc');
      await page.getByRole('group', { name: 'Lọc theo trạng thái' }).getByRole('button', { name: 'Đang tắt', exact: true }).click();
      await expect(brow('W13 Combo đang tắt')).toBeVisible();
      await expect(brow('W13 Combo đang chạy')).toHaveCount(0);
      await page.getByRole('group', { name: 'Lọc theo trạng thái' }).getByRole('button', { name: 'Tất cả', exact: true }).click();
      await expectCleanScreen(page, 'combo-danh-sach');
      await shot(page, 'combo', 'danh-sach');

      // Form combo: mỗi lỗi hiện một câu tiếng Việt khi bấm Lưu bộ, không gửi gì lên máy chủ.
      await page.getByRole('button', { name: 'Tạo combo hoặc mua kèm', exact: true }).click();
      const bform = page.getByRole('form', { name: 'Tạo bộ combo và mua kèm' });
      const bsave = bform.getByRole('button', { name: 'Lưu bộ', exact: true });
      const berr = bform.getByRole('alert');
      await expect(bsave, 'chưa có tên và ngày: nút Lưu khoá').toBeDisabled();
      await paste(bform.getByRole('textbox', { name: 'Tên bộ', exact: true }), 'W13 Combo form');
      await setWhen(bform, 'Bắt đầu', 4, '09', '00');
      await setWhen(bform, 'Kết thúc', 4, '09', '00');
      const bpost = w.posts.length;
      await bsave.click();
      await expect(berr).toContainText('Giờ kết thúc phải sau giờ bắt đầu.');
      await setWhen(bform, 'Kết thúc', 6, '09', '00');
      await bsave.click();
      await expect(berr).toContainText('Combo cần ít nhất 2 sản phẩm khác nhau.');
      const addProd = async (name: string) => {
        await bform.getByRole('searchbox', { name: 'Thêm sản phẩm', exact: true }).fill(name);
        await bform.getByRole('option', { name: new RegExp(escapeRe(name)) }).first().click();
      };
      await addProd(PRODUCT.name);
      await addProd(PRODUCT2.name);
      await expect(bform.getByTestId('bundle-item')).toHaveCount(2);
      const pctBox = bform.getByRole('spinbutton', { name: '% giảm mỗi món', exact: true });
      await expect(bform.getByRole('listbox'), 'chọn xong thì danh sách kết quả biến mất ngay').toHaveCount(0);
      for (const bad of ['150', '101', '0', '-5', '12.5', '']) {
        await paste(pctBox, bad);
        await bsave.click();
        await expect(berr, `% giảm "${bad}"`).toContainText('Nhập % giảm là số nguyên từ 1 đến 100.');
      }
      await paste(pctBox, '15');
      const qty = bform.getByRole('spinbutton', { name: `Số lượng ưu đãi ${PRODUCT.name}`, exact: true });
      for (const bad of ['0', '-1', '999']) {
        await paste(qty, bad);
        await bsave.click();
        await expect(berr, `số lượng "${bad}"`).toContainText('Số lượng được ưu đãi mỗi đơn của từng món từ 1 đến');
      }
      await paste(qty, '1');
      const sortBox = bform.getByRole('spinbutton', { name: 'Thứ tự hiển thị', exact: true });
      await paste(sortBox, '-1');
      await bsave.click();
      await expect(berr).toContainText('Thứ tự là số nguyên từ 0 đến 9999.');
      await paste(sortBox, '10000');
      await bsave.click();
      await expect(berr).toContainText('Thứ tự là số nguyên từ 0 đến 9999.');
      await paste(sortBox, '0');
      await shot(page, 'combo', 'form-loi', true);
      expect((await berr.innerText()).trim()).not.toMatch(TECHNICAL);
      expect(w.posts.slice(bpost).filter((p) => /bundles/.test(p)), 'form chặn: không có lệnh ghi nào').toEqual([]);
      const created = submitAndRead(page, () => bsave.click(), /\/admin\/bundles$/);
      expect((await created).status).toBe(201);
      await expect(page.getByRole('status').filter({ hasText: 'Đã lưu bộ.' })).toBeVisible();
      await expect(brow('W13 Combo form')).toContainText('Sắp chạy');
      await expect(brow('W13 Combo form')).toContainText(dmy(4));
      note('combo', `dòng combo vừa tạo: ${(await brow('W13 Combo form').innerText()).replace(/\s+/g, ' ')}`);
      await brow('W13 Combo form').getByRole('button', { name: 'Tắt bộ W13 Combo form', exact: true }).click();
      await expect(brow('W13 Combo form')).toContainText('Đang tắt');
      await brow('W13 Combo form').getByRole('button', { name: 'Xoá bộ W13 Combo form', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Xoá "W13 Combo form"');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Giữ lại', exact: true }).click();
      await expect(brow('W13 Combo form')).toBeVisible();
      await expectCleanScreen(page, 'combo-sau-tao');
      await shot(page, 'combo', 'sau-khi-tao');

      // Chiến dịch qua giao diện: lời báo khi bấm Lưu, rồi tạo thật; danh sách hiện khoảng giờ VN và trạng thái.
      await gotoNav(page, 'Chiến dịch');
      await page.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click();
      const cform = page.getByRole('form', { name: 'Tạo chiến dịch mới' });
      const csave = cform.getByRole('button', { name: 'Lưu chiến dịch', exact: true });
      const cerr = cform.getByRole('alert');
      await expect(csave, 'chưa có tên, ảnh, ngày: nút Lưu khoá').toBeDisabled();
      await paste(cform.getByRole('textbox', { name: 'Tên chiến dịch', exact: true }), 'W13 Chiến dịch form');
      await paste(cform.getByRole('textbox', { name: /^Link ảnh/ }), 'http://cdn.w13.test/banner.svg');
      await setWhen(cform, 'Bắt đầu', 3, '09', '00');
      await setWhen(cform, 'Kết thúc', 3, '09', '00');
      const cpost = w.posts.length;
      await csave.click();
      await expect(cerr).toContainText('Ảnh banner phải là link bắt đầu bằng https://');
      await paste(cform.getByRole('textbox', { name: /^Link ảnh/ }), BANNER);
      await csave.click();
      await expect(cerr).toContainText('Giờ kết thúc phải sau giờ bắt đầu.');
      await setWhen(cform, 'Kết thúc', 5, '09', '00');
      const csort = cform.getByRole('spinbutton', { name: 'Thứ tự hiển thị', exact: true });
      for (const bad of ['-1', '10000', '1.5', '']) {
        await paste(csort, bad);
        await csave.click();
        await expect(cerr, `thứ tự "${bad}"`).toContainText('Thứ tự là số nguyên từ 0 đến 9999.');
      }
      await paste(csort, '0');
      await paste(cform.getByRole('textbox', { name: 'Mã giảm giá gắn kèm', exact: true }), Array.from({ length: 11 }, (_, i) => `E2EW13X${i}`).join(', '));
      await csave.click();
      await expect(cerr).toContainText('Mỗi chiến dịch gắn tối đa 10 mã.');
      await paste(cform.getByRole('textbox', { name: 'Mã giảm giá gắn kèm', exact: true }), '');
      await shot(page, 'chien-dich', 'form-loi', true);
      expect((await cerr.innerText()).trim()).not.toMatch(TECHNICAL);
      expect(w.posts.slice(cpost).filter((p) => /campaigns/.test(p)), 'form chặn: không có lệnh ghi nào').toEqual([]);
      await cform.getByRole('searchbox', { name: 'Thêm sản phẩm', exact: true }).fill(PRODUCT.name);
      await cform.getByRole('option', { name: new RegExp(escapeRe(PRODUCT.name)) }).first().click();
      await expect(cform.getByRole('listbox')).toHaveCount(0);
      await expect(cform.getByTestId('campaign-product')).toHaveCount(1);
      await expect(csave).toBeEnabled();
      await expect(cform.getByText(/Kiểm trước khi bật/).first()).toBeVisible();
      const cmade = await submitAndRead(page, () => csave.click(), /\/admin\/campaigns$/);
      note('chien-dich', `lưu chiến dịch: ${cmade.status} ${cmade.status === 201 ? '' : cmade.body}`);
      expect(cmade.status, cmade.body).toBe(201);
      await expect(page.getByRole('status').filter({ hasText: 'Đã lưu chiến dịch.' })).toBeVisible();
      const crow = page.locator('div.rounded-card').filter({ hasText: 'W13 Chiến dịch form' }).filter({ has: page.getByRole('button', { name: /^Sửa/ }) });
      await expect(crow).toContainText('Sắp chạy');
      await expect(crow).toContainText(`${dmy(3)} 09:00 → ${dmy(5)} 09:00`);
      await expectCleanScreen(page, 'chien-dich-sau-tao');
      await shot(page, 'chien-dich', 'sau-khi-tao');
      expectCleanWatch('khuyen-mai', w);
    });

    //__TESTS__
  });
}
