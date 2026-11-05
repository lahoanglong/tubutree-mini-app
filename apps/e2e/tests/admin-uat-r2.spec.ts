import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createHmac } from 'crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * UAT quản trị vòng 2 ở hai khung 1440x900 và 768x1024, API và DB thật (chạy qua scripts/web-gate.sh, E2E_SCOPE=web).
 * Các màn: Tổng quan chỉ số, Báo cáo, Hôm nay, Danh mục, Nhãn hàng, Chiến dịch, Cấu hình, Sức khoẻ hệ thống (việc nền, đồng bộ Pancake, ZNS), Mẫu thông báo.
 * Chỉ /auth/refresh được giả (phiên ADMIN ký bằng đúng JWT_ACCESS_SECRET của API). Mốc đơn seed tính từ Date.now() theo lịch Việt Nam, có 00:30 và 23:30 giờ VN;
 * mỗi khung chạy trong một múi giờ trình duyệt khác nhau để ngày đọc theo giờ máy lộ ra.
 * Ảnh chụp (fullPage) ghi vào W11_SCREENS_DIR nếu đặt, tên `NN-<khung>-<màn>-<bước>.png`.
 */

const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
const W11 = 'e2e-w11-';
const ADMIN_ID = `${W11}admin`;
const dbUrl = process.env.DATABASE_URL ?? '';
const secret = process.env.JWT_ACCESS_SECRET ?? '';
const runnable = process.env.E2E_SCOPE === 'web' && GATE_DB.test(dbUrl) && secret.length >= 16;
const SCREENS = process.env.W11_SCREENS_DIR;
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3001'}/api`;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const p2 = (n: number) => String(n).padStart(2, '0');

/** Ngày theo lịch Việt Nam `days` ngày kể từ bây giờ. */
function vnDay(days: number): { y: string; m: string; d: string } {
  const t = new Date(Date.now() + VN_OFFSET_MS + days * DAY_MS);
  return { y: String(t.getUTCFullYear()), m: p2(t.getUTCMonth() + 1), d: p2(t.getUTCDate()) };
}
const ymd = (days: number): string => { const { y, m, d } = vnDay(days); return `${y}-${m}-${d}`; };
const dmy = (days: number): string => { const { y, m, d } = vnDay(days); return `${d}/${m}/${y}`; };
/** Mốc UTC của giờ tường `hhmm` giờ Việt Nam vào ngày `days`. */
const vnAt = (days: number, hhmm: string): Date => new Date(`${ymd(days)}T${hhmm}:00+07:00`);
/** Chữ giờ-ngày mà màn quản trị phải hiện cho một mốc: "HH:mm dd/mm/yyyy". */
const shown = (days: number, hhmm: string): string => `${hhmm} ${dmy(days)}`;
/** "1.234.567đ", tự ghép để không phụ thuộc ICU của máy chạy test. */
const vnd = (n: number): string => `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

const SPACES = '   \t  ';
const ZERO_WIDTH = '​​​';
const INVISIBLE_MIX = '​﻿⁠​';

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
  const body = b64(JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', zaloId: `${W11}admin-zalo`, iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

/** PNG một màu `w`x`h` (đủ lớn để qua kiểm tỉ lệ banner 5:2), tự dựng bằng zlib. */
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let shotNo = 0;
async function shot(page: Page, flow: string, step: string, modal = false): Promise<void> {
  if (!SCREENS) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  shotNo += 1;
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SCREENS, `${String(shotNo).padStart(2, '0')}-${vp?.width ?? 0}-${flow}-${step}.png`), fullPage: !modal });
}

/** Điều thấy được mà chưa phải lỗi: đi vào báo cáo của lần chạy (stdout và phần chú thích của ca test). */
function note(flow: string, text: string): void {
  const line = `[W11 ${flow}] ${text}`;
  test.info().annotations.push({ type: 'quan-sat', description: line });
  console.log(line);
}

interface Watch {
  pageErrors: string[];
  consoleErrors: string[];
  api: { status: number; method: string; path: string; from: string }[];
}

function watch(page: Page): Watch {
  const w: Watch = { pageErrors: [], consoleErrors: [], api: [] };
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) w.consoleErrors.push(m.text());
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
        user: { id: ADMIN_ID, role: 'ADMIN', fullName: 'W11 Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'E2EW11AD1' },
      }),
    });
  });
  await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
  await page.goto(url);
  await expect(page.getByRole('navigation', { name: /^Mục quản trị/ }).or(page.getByRole('button', { name: /Đổi mục/ })).first()).toBeVisible();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bấm một mục của menu: ô "Tìm mục quản trị" ở khung rộng (menu trái), qua nút "Đổi mục" và ngăn kéo ở khung hẹp (dưới 1024). */
async function gotoNav(page: Page, label: string): Promise<void> {
  const narrow = (page.viewportSize()?.width ?? 1440) < 1024;
  if (narrow) await page.getByRole('button', { name: /Đổi mục/ }).click();
  const nav = page.getByRole('navigation', { name: narrow ? 'Mục quản trị (điện thoại)' : 'Mục quản trị', exact: true });
  await nav.getByRole('searchbox', { name: 'Tìm mục quản trị' }).fill(label);
  await nav.getByRole('button', { name: new RegExp(`^${escapeRe(label)}\\s*(,|$)`) }).first().click();
}

async function adminGet(request: import('@playwright/test').APIRequestContext, urlPath: string) {
  return request.get(`${API}${urlPath}`, { headers: { authorization: `Bearer ${adminToken()}` } });
}

async function submitAndRead(page: Page, trigger: () => Promise<void>, urlPath: RegExp, method = 'POST'): Promise<{ status: number; body: string }> {
  const wait = page.waitForResponse((r) => urlPath.test(new URL(r.url()).pathname) && r.request().method() === method);
  await trigger();
  const r = await wait;
  return { status: r.status(), body: (await r.text()).slice(0, 300) };
}

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
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.width > 0 && t.getClientRects().length > 0;
      })
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

const CUSTOMER = { id: `${W11}cust`, name: 'W11 Khách Hàng', phone: '0900011001' };

/**
 * Đơn seed (mã E2EW11-*). A và B nằm sát nửa đêm giờ VN. Không có dòng hàng: các màn đang kiểm chỉ đọc số tiền, trạng thái và mốc.
 * A 00:30 hôm nay, B 23:30 hôm qua, C đúng 1.000.000đ, D đang chờ COD, E đã huỷ, F chờ chuyển khoản, G lớn, H ngoài 30 ngày.
 */
interface SeedOrder { code: string; day: number; at: string; status: string; method: string; pay: string; total: number; source: string; platform: string }
const ORDERS: readonly SeedOrder[] = [
  { code: 'E2EW11-A', day: 0, at: '00:30', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 1_234_567, source: 'checkout', platform: 'miniapp' },
  { code: 'E2EW11-B', day: -1, at: '23:30', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 2_500_000, source: 'checkout', platform: 'web' },
  { code: 'E2EW11-C', day: -2, at: '12:00', status: 'DELIVERED', method: 'COD', pay: 'PAID', total: 1_000_000, source: 'storefront', platform: 'miniapp' },
  { code: 'E2EW11-D', day: -3, at: '09:15', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID', total: 850_000, source: 'buy_now', platform: 'miniapp' },
  { code: 'E2EW11-E', day: -5, at: '15:00', status: 'CANCELLED', method: 'COD', pay: 'UNPAID', total: 300_000, source: 'checkout', platform: 'miniapp' },
  { code: 'E2EW11-F', day: -8, at: '08:05', status: 'PENDING_PAYMENT', method: 'BANK_TRANSFER', pay: 'UNPAID', total: 99_000, source: 'checkout', platform: 'web' },
  { code: 'E2EW11-G', day: -12, at: '20:45', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 12_345_678, source: 'dealer', platform: 'web' },
  { code: 'E2EW11-H', day: -40, at: '10:00', status: 'DELIVERED', method: 'BANK_TRANSFER', pay: 'PAID', total: 700_000, source: 'checkout', platform: 'miniapp' },
];
const order = (suffix: string) => ORDERS.find((o) => o.code === `E2EW11-${suffix}`)!;
const sum = (xs: readonly { total: number }[]) => xs.reduce((s, o) => s + o.total, 0);
const PAID = ORDERS.filter((o) => o.pay === 'PAID' && o.status === 'DELIVERED');
const GMV = ORDERS.filter((o) => ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'].includes(o.status));

/** Mốc "bây giờ" của lần seed gần nhất: việc nền, tin ZNS và tin báo lỗi seed theo số phút trước đó. */
const SEED = { now: new Date(), ago(min: number): Date { return new Date(this.now.getTime() - min * 60_000); } };
/** Chữ giờ-ngày VN của một mốc: "HH:mm dd/mm/yyyy". */
const vnClock = (d: Date): string => {
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  return `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())} ${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
};

const CRON_REAL = ['PancakeSyncService.scheduledSync', 'ZnsStuckLogCron.sweepStuckZnsLogs', 'AffiliateService.dailyWalletTransfer', 'LoyaltyCron.recalcTiers'];

async function seedAll(): Promise<void> {
  await withDb(async (prisma) => {
    const orderIds: string[] = (await prisma.order.findMany({ where: { code: { startsWith: 'E2EW11-' } }, select: { id: true } })).map((o: { id: string }) => o.id);
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { code: { startsWith: 'E2EW11-' } } });
    await prisma.campaign.deleteMany({ where: { title: { startsWith: 'W11 ' } } });
    await prisma.brand.deleteMany({ where: { name: { startsWith: 'W11 ' } } });
    await prisma.systemConfig.updateMany({ where: { key: 'company.legal_name' }, data: { value: '' } });
    // Mục con tạo bằng giao diện có id cuid, nên nhận ra theo tên "W11 " thay vì tiền tố id; con trước, gốc sau.
    const w11Category = { OR: [{ id: { startsWith: W11 } }, { name: { startsWith: 'W11 ' } }] };
    await prisma.category.deleteMany({ where: { AND: [w11Category, { parentId: { not: null } }] } });
    await prisma.category.deleteMany({ where: w11Category });
    await prisma.cronRun.deleteMany({ where: { OR: [{ job: { startsWith: W11 } }, { job: { in: CRON_REAL } }] } });
    await prisma.notificationLog.deleteMany({ where: { userId: CUSTOMER.id } });
    await prisma.pancakeWebhookEvent.deleteMany({ where: { dedupeKey: { startsWith: W11 } } });

    const user = (id: string, zalo: string, fullName: string, phone: string | null, refCode: string, role = 'CUSTOMER') =>
      prisma.user.upsert({
        where: { id },
        update: { role, isBlocked: false, blockedReason: null, fullName, phone },
        create: { id, zaloId: zalo, role, fullName, phone, referralCode: refCode },
      });
    await user(ADMIN_ID, `${W11}admin-zalo`, 'W11 Admin', null, 'E2EW11AD1', 'ADMIN');
    await user(CUSTOMER.id, `${W11}cust-zalo`, CUSTOMER.name, CUSTOMER.phone, 'E2EW11CU1');

    for (const o of ORDERS) {
      const stuck = o.code === 'E2EW11-D';
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
          source: o.source,
          platform: o.platform,
          createdAt: vnAt(o.day, o.at),
          ...(stuck ? { pancakePushStatus: 'FAILED', pancakeErrorKind: 'REJECTED', pancakeSyncError: 'Pancake từ chối: thiếu địa chỉ người nhận (HTTP 422)', pancakePushAttempts: 3 } : {}),
          shippingAddress: { recipient: CUSTOMER.name, phone: CUSTOMER.phone, line1: '12 Đường Thử, Quận 1', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
        },
      });
    }

    // Danh mục: gốc W11 có hai con; 7 gốc có sẵn của seed + 1 gốc này = đủ 8.
    await prisma.category.create({ data: { id: `${W11}cat-root`, name: 'W11 Dừa Bến Tre', slug: 'e2e-w11-dua-ben-tre', sortOrder: 90 } });
    await prisma.category.create({ data: { id: `${W11}cat-a`, parentId: `${W11}cat-root`, name: 'W11 Nước dừa', slug: 'e2e-w11-nuoc-dua', sortOrder: 1 } });
    await prisma.category.create({ data: { id: `${W11}cat-b`, parentId: `${W11}cat-root`, name: 'W11 Kẹo dừa', slug: 'e2e-w11-keo-dua', sortOrder: 2 } });

    // Nhãn hàng: một nhãn chính hãng đã đăng với 1.234 người theo dõi, một nhãn nháp.
    const brand = await prisma.brand.create({
      data: {
        name: 'W11 Nhãn Chính Hãng',
        slug: 'e2e-w11-nhan-chinh-hang',
        tagline: 'Câu giới thiệu ngắn của nhãn thử',
        origin: 'Bến Tre',
        isVerified: true,
        isPublished: true,
        followerCount: 1234,
        certifications: [{ code: 'ORG', label: 'Hữu cơ USDA', verified: true }],
      },
    });
    await prisma.brand.create({ data: { name: 'W11 Nhãn Nháp', slug: 'e2e-w11-nhan-nhap', isPublished: false, followerCount: 7 } });
    await prisma.brandPromotion.create({ data: { brandId: brand.id, title: 'W11 MUA 2 TẶNG 1', subtitle: 'Tặng một hộp cho đơn thứ hai', startAt: vnAt(-1, '00:00'), endAt: vnAt(9, '23:59') } });

    // Chiến dịch: đang chạy, sắp chạy, đã kết thúc, đang tắt; mốc sát nửa đêm giờ VN.
    const img = `data:image/png;base64,${solidPng(50, 20, [34, 139, 34]).toString('base64')}`;
    const camp = (slug: string, title: string, over: Record<string, unknown>) =>
      prisma.campaign.create({ data: { slug: `e2e-w11-${slug}`, title, placement: 'HOME_TOP', image: img, startAt: vnAt(-2, '00:00'), endAt: vnAt(5, '23:59'), isActive: true, ...over } });
    await camp('dang-chay', 'W11 Giữa thu đang chạy', { subtitle: 'Giảm đến 30%', startAt: vnAt(-2, '00:30'), endAt: vnAt(5, '23:30') });
    await camp('sap-chay', 'W11 Chiến dịch sắp chạy', { placement: 'OFFERS_TOP', audience: 'NEW', startAt: vnAt(3, '08:00'), endAt: vnAt(10, '22:00') });
    await camp('da-het', 'W11 Chiến dịch đã kết thúc', { startAt: vnAt(-20, '00:00'), endAt: vnAt(-10, '23:59') });
    await camp('dang-tat', 'W11 Chiến dịch đang tắt', { isActive: false, audience: 'RETURNING' });

    // Việc nền: OK, lỗi ghi log, ném lỗi, bỏ qua; một việc chưa có tên thường.
    SEED.now = new Date();
    const ago = (min: number) => SEED.ago(min);
    const cron = (job: string, outcome: string, extra: Record<string, unknown> = {}) =>
      prisma.cronRun.create({ data: { job, lastStartedAt: ago(30), lastFinishedAt: ago(29), lastDurationMs: 61_000, lastOutcome: outcome, ...extra } });
    await cron('PancakeSyncService.scheduledSync', 'OK', { lastSuccessAt: ago(29) });
    await cron('ZnsStuckLogCron.sweepStuckZnsLogs', 'THREW', { lastSuccessAt: ago(600), lastErrorAt: ago(29), lastError: 'Error: connect ECONNREFUSED 127.0.0.1:5432', consecutiveFailures: 4 });
    await cron('AffiliateService.dailyWalletTransfer', 'ERRORS', { lastSuccessAt: ago(1500), lastErrorAt: ago(29), lastError: 'Không chuyển được 2 lệnh hoa hồng', lastErrorCount: 2, consecutiveFailures: 1 });
    await cron('LoyaltyCron.recalcTiers', 'SKIPPED', { lastSuccessAt: ago(2000) });
    await cron(`${W11}job-chua-co-ten`, 'OK', { lastSuccessAt: ago(29) });

    // Tin ZNS: gửi được, hỏng trong 24 giờ, đang chờ gửi lại, hỏng cũ hơn 24 giờ; một mẫu có tin trong app.
    const log = (templateCode: string, channel: string, status: string, minutesAgo: number, error: string | null) =>
      prisma.notificationLog.create({ data: { userId: CUSTOMER.id, templateCode, channel, status, error, payload: {}, sentAt: ago(minutesAgo) } });
    await log('ORDER_CONFIRMED', 'ZNS', 'SENT', 120, null);
    await log('ORDER_CONFIRMED', 'ZNS', 'FAILED', 90, 'Zalo từ chối: mẫu tin chưa được duyệt (-124)');
    await log('ORDER_CONFIRMED', 'ZNS', 'FAILED', 80, 'Zalo từ chối: mẫu tin chưa được duyệt (-124)');
    await log('ORDER_CONFIRMED', 'ZNS', 'RETRYING', 20, null);
    await log('ORDER_CONFIRMED', 'ZNS', 'FAILED', 60 * 24 * 12, 'Số điện thoại không dùng Zalo (-118)');
    await log('ORDER_CONFIRMED', 'INAPP', 'SENT', 15, null);

    // Tin báo Pancake lỗi chưa xử lý.
    await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'order.updated', dedupeKey: `${W11}ev-1`, rawPayload: { data: { extension: { external_order_id: 'E2EW11-A' } } }, receivedAt: ago(50), status: 'FAILED', attempts: 3, error: 'Không khớp đơn trong hệ thống: thiếu mã đơn ngoài' },
    });
    await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'variation.stock_changed', dedupeKey: `${W11}ev-2`, rawPayload: { data: { id: 'v-1' } }, receivedAt: ago(70), status: 'FAILED', attempts: 2, error: 'Biến thể chưa có trong danh mục' },
    });
  });
}

for (const frame of FRAMES) {
  test.describe(`Admin UAT vòng 2 ${frame.w}x${frame.h} với API và DB thật`, () => {
    test.skip(!runnable, 'Cần web-gate.sh (API + DB tạm thật)');
    test.use({ viewport: { width: frame.w, height: frame.h }, timezoneId: frame.tz });
    // Mọi ca dùng chung dữ liệu seed `e2e-w11-*` (beforeAll xoá rồi tạo lại): chạy nhiều worker thì các lần seed đạp lên nhau.
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
      await seedAll();
    });

    test('1. Tổng quan chỉ số: doanh thu, đơn mới nhất, mốc 00:30 và 23:30', async ({ page, request }) => {
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Tổng quan chỉ số');
      const revenueCard = page.locator('div.shadow-card').filter({ hasText: 'Doanh thu đã thu' }).first();
      await expect(revenueCard).toBeVisible();
      const stats = await (await adminGet(request, '/admin/dashboard/stats')).json();

      await expect(revenueCard.locator('.text-2xl')).toHaveText(vnd(sum(PAID)));
      expect(stats.totalRevenue, 'API: doanh thu đã thu bằng tổng đơn đã giao đã thanh toán').toBe(sum(PAID));
      await expect(revenueCard.getByText(vnd(sum(GMV)))).toBeVisible();
      await expect(revenueCard.getByText(vnd(order('D').total))).toBeVisible();
      await shot(page, 'tong-quan', 'the-so');

      // Đơn mới nhất: sáu đơn gần nhất, mỗi dòng có mã, tiền đúng dạng, giờ-ngày VN.
      const rows = page.locator('table tbody tr').filter({ hasText: 'E2EW11-' });
      for (const code of ['A', 'B', 'C', 'D', 'E', 'F']) {
        const o = order(code);
        const row = rows.filter({ hasText: o.code });
        await expect(row, `đơn ${o.code} có trong bảng đơn mới nhất`).toHaveCount(1);
        await expect(row).toContainText(vnd(o.total));
        await expect(row, `${o.code}: giờ-ngày theo giờ Việt Nam, không lệch theo múi giờ ${frame.tz}`).toContainText(shown(o.day, o.at));
      }
      await expect(rows.filter({ hasText: order('G').code })).toHaveCount(0);
      const wrapped = await page.evaluate(() => {
        const lines = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
        };
        return Array.from(document.querySelectorAll('table tbody tr'))
          .filter((tr) => tr.textContent?.includes('E2EW11-'))
          .flatMap((tr) => [tr.querySelector('td:first-child button')!, tr.querySelector('td:last-child')!])
          .filter((el) => lines(el) > 1)
          .map((el) => (el.textContent ?? '').trim());
      });
      expect(wrapped, 'mã đơn và giờ-ngày nằm trên một dòng, không bị bẻ đôi').toEqual([]);
      await expectCleanScreen(page, 'tong-quan');
      await shot(page, 'tong-quan', 'don-moi-nhat');
      expectCleanWatch('tong-quan', w);
    });

    test('2. Báo cáo: số theo khoảng ngày, bảng ngày × kênh, nút xuất, nhập khoảng ngày', async ({ page, request }) => {
      test.setTimeout(120_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Báo cáo');
      await expect(page.getByRole('heading', { name: 'Doanh thu theo ngày và kênh' })).toBeVisible();
      const tile = (label: string) => page.locator(`[data-kpi="${label}"] dd`);

      // Mặc định 30 ngày gần nhất: A..G, không có H (40 ngày trước).
      const in30 = ORDERS.filter((o) => o.day >= -29);
      await expect(tile('Doanh thu (đã thu)')).toHaveText(vnd(sum(in30.filter((o) => PAID.includes(o)))));
      await expect(tile('Tổng giá trị đơn đặt')).toHaveText(vnd(sum(in30.filter((o) => GMV.includes(o)))));
      await expect(tile('Đơn đặt')).toHaveText(String(in30.length));
      await expect(tile('Đơn huỷ / trả')).toHaveText('1');
      await expect(tile('Đã hoàn một phần')).toHaveText('0đ');
      const api = await (await adminGet(request, `/admin/reports/revenue?from=${ymd(-29)}&to=${ymd(0)}`)).json();
      expect(api.totals.revenue).toBe(sum(in30.filter((o) => PAID.includes(o))));

      // 00:30 hôm nay và 23:30 hôm qua nằm ở hai dòng ngày khác nhau, mỗi dòng đúng số tiền của đơn đó.
      const dayRow = (days: number) => page.locator(`tr[data-day="${ymd(days)}"]`);
      await expect(dayRow(0), 'đơn 00:30 giờ VN phải nằm ở ngày hôm nay, không lùi về hôm qua').toContainText(dmy(0));
      await expect(dayRow(0)).toContainText(vnd(order('A').total));
      await expect(dayRow(-1), 'đơn 23:30 giờ VN phải nằm ở ngày hôm qua, không nhảy sang hôm nay').toContainText(dmy(-1));
      await expect(dayRow(-1)).toContainText(vnd(order('B').total));
      await expect(dayRow(-12)).toContainText(vnd(order('G').total));
      await expect(page.locator('tr[data-total]')).toContainText(vnd(sum(in30.filter((o) => PAID.includes(o)))));
      await expect(page.getByText(new RegExp(`${escapeRe(dmy(-29))} – ${escapeRe(dmy(0))} \\(30 ngày\\)`))).toBeVisible();
      for (const label of ['Từ ngày', 'Đến ngày']) {
        const gap = await page.evaluate((text) => {
          const field = document.querySelector<HTMLElement>(`input[aria-label="${text}"]`)!;
          const wrap = field.closest('label')!;
          const node = Array.from(wrap.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim() === text)!;
          const r = document.createRange();
          r.selectNodeContents(node);
          const t = r.getBoundingClientRect();
          const f = field.getBoundingClientRect();
          return { horizontal: Math.round(f.left - t.right), vertical: Math.round(Math.abs((f.top + f.bottom) / 2 - (t.top + t.bottom) / 2)) };
        }, label);
        expect(gap.horizontal, `chữ "${label}" cách ô ngày ít nhất 4px, không dính vào viền ô`).toBeGreaterThanOrEqual(4);
        expect(gap.vertical, `chữ "${label}" nằm giữa chiều cao ô ngày, không lệch dòng`).toBeLessThanOrEqual(6);
      }
      await expect(page.locator('tr[data-source-row]').first()).toBeVisible();
      for (const rowText of await page.locator('tr[data-source-row]').allInnerTexts()) {
        expect(rowText, 'nguồn chưa có đơn đầu thì không ghi "(— của có đơn đầu)"').not.toContain('(—');
      }
      await expectCleanScreen(page, 'bao-cao-30-ngay');
      await shot(page, 'bao-cao', '30-ngay');

      // Các mốc nhanh.
      await page.getByRole('button', { name: 'Hôm qua', exact: true }).click();
      await expect(tile('Doanh thu (đã thu)')).toHaveText(vnd(order('B').total));
      await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
      await expect(tile('Doanh thu (đã thu)')).toHaveText(vnd(order('A').total));
      await page.getByRole('button', { name: '90 ngày', exact: true }).click();
      await expect(tile('Doanh thu (đã thu)')).toHaveText(vnd(sum(PAID)));
      for (const label of ['7 ngày', 'Tháng này', 'Tháng trước']) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(tile('Doanh thu (đã thu)')).toBeVisible();
        await expectCleanScreen(page, `bao-cao-${label}`);
      }

      // Nhập tay khoảng ngày: hợp lệ, ngược, không có thật, quá năm.
      const from = page.getByRole('textbox', { name: 'Từ ngày', exact: true });
      const to = page.getByRole('textbox', { name: 'Đến ngày', exact: true });
      await paste(from, dmy(-12).replace(/\//g, ''));
      await paste(to, dmy(-12).replace(/\//g, ''));
      await expect(from).toHaveValue(dmy(-12));
      await expect(tile('Doanh thu (đã thu)')).toHaveText(vnd(order('G').total));
      await expect(page.getByRole('button', { name: '7 ngày', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await paste(from, '31/02/2026');
      await from.blur();
      await expect(page.getByRole('alert').filter({ hasText: /Ngày không có thật/ })).toBeVisible();
      await paste(from, '');
      await paste(from, ymd(-1000).split('-').reverse().join('/'));
      await from.blur();
      const rangeAlert = page.getByRole('alert').first();
      await expect(rangeAlert).toBeVisible();
      const alertText = (await rangeAlert.innerText()).trim();
      note('bao-cao', `khoảng ngày quá dài báo: "${alertText}"`);
      expect(alertText).not.toMatch(/undefined|NaN|\[object|REVENUE_MAX/);
      await shot(page, 'bao-cao', 'khoang-ngay-loi');

      // Xuất CSV: tải được, báo tên file.
      await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
      const dl = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Xuất CSV đơn hàng' }).click();
      const file = await dl;
      expect(file.suggestedFilename()).toMatch(/\.csv$/);
      await expect(page.getByRole('status').filter({ hasText: /Đã tải/ })).toBeVisible();
      await expectCleanScreen(page, 'bao-cao-xuat');
      expectCleanWatch('bao-cao', w);
    });

    test('3. Hôm nay: số bán hàng so với hôm qua, 7 ngày, việc đang chờ', async ({ page }) => {
      const w = watch(page);
      // "Hôm nay" là mục mở đầu của quản trị viên (không nằm trong ô tìm của menu, vì chỉ có ở nhóm Hay dùng).
      await openAdmin(page);
      await expect(page.getByRole('heading', { name: 'Hôm nay', exact: true })).toBeVisible();
      const stats = page.getByRole('region', { name: 'Số bán hàng hôm nay' });
      const revenue = stats.getByRole('group', { name: 'Đã thu từ đơn hôm nay', exact: true });
      await expect(revenue).toContainText(vnd(order('A').total));
      await expect(revenue).toContainText(`Giá trị đơn đặt ${vnd(order('A').total)}`);
      await expect(revenue, 'hôm nay (00:30 giờ VN) kém hôm qua (23:30 giờ VN) đúng chênh lệch giữa hai đơn').toContainText(new RegExp(`[−-]${escapeRe(vnd(order('B').total - order('A').total))} so với hôm qua`));
      await expect(revenue).toContainText(`7 ngày ${vnd(order('A').total + order('B').total + order('C').total)}`);
      const orders = stats.getByRole('group', { name: 'Đơn hôm nay', exact: true });
      await expect(orders).toContainText('Bằng hôm qua (1)');
      await expect(orders).toContainText('7 ngày 5');
      await expectCleanScreen(page, 'hom-nay');
      await shot(page, 'hom-nay', 'tong-quan');
      expectCleanWatch('hom-nay', w);
    });

    test('4. Danh mục: cây, thêm mục con, tên rỗng, vô hình, quá dài, trùng, đổi tên, xoá', async ({ page, request }) => {
      test.setTimeout(120_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Sản phẩm');
      const tree = page.getByRole('region', { name: 'Quản lý cây danh mục' });
      await expect(tree.getByRole('heading', { name: 'Cây danh mục' })).toBeVisible();
      await expect(tree).toContainText('Tầng 1: 8/8 · tối đa 8 mục con mỗi mục');
      await expect(tree).toContainText('Đã đủ 8 danh mục gốc.');
      await expect(tree.getByRole('button', { name: 'Thêm danh mục gốc' })).toBeDisabled();
      await expect(tree).toContainText('W11 Dừa Bến Tre');
      await expect(tree).toContainText('0 sản phẩm, cả mục con · 2/8 mục con');
      await expectCleanScreen(page, 'danh-muc');
      await shot(page, 'danh-muc', 'cay');

      const ROOT = 'W11 Dừa Bến Tre';
      await tree.getByRole('button', { name: `Thêm mục con vào "${ROOT}"` }).click();
      const nameBox = tree.getByRole('textbox', { name: `Tên mục con mới của "${ROOT}"` });
      const add = tree.getByRole('button', { name: 'Thêm', exact: true });
      await expect(nameBox).toBeFocused();
      await expect(add, 'ô trống: nút Thêm khoá').toBeDisabled();
      await paste(nameBox, SPACES);
      await expect(add, 'chỉ dấu cách: nút Thêm khoá').toBeDisabled();

      // Chỉ ký tự vô hình (String.trim của trình duyệt không bỏ): hoặc nút khoá, hoặc máy chủ từ chối bằng tiếng Việt; không tạo mục tên rỗng.
      await paste(nameBox, ZERO_WIDTH);
      if (await add.isEnabled()) {
        const r = await submitAndRead(page, () => add.click(), /\/admin\/categories$/);
        note('danh-muc', `tên toàn ký tự vô hình: nút Thêm bật, máy chủ trả ${r.status} ${r.body}`);
        expect(r.status).toBe(400);
        const alert = tree.getByRole('alert').first();
        await expect(alert).toBeVisible();
        const text = (await alert.innerText()).trim();
        note('danh-muc', `lời báo: "${text}"`);
        expect(text, 'lời báo phải bằng tiếng Việt, nói tên không được để trống').not.toMatch(/should|must|empty|undefined|Bad Request|\[object/);
        expect(text).toMatch(/[Tt]ên/);
      }
      const listed = await (await adminGet(request, '/admin/categories')).json();
      expect(listed.items.filter((c: { name: string }) => c.name.replace(/[\s​-‍﻿⁠]/g, '') === ''), 'không có danh mục tên rỗng').toEqual([]);

      await paste(nameBox, 'x'.repeat(80));
      expect(await nameBox.inputValue(), 'ô tên chặn ở 60 ký tự').toHaveLength(60);
      await paste(nameBox, '   W11   Mục  con   mới  ');
      await add.click();
      await expect(tree.getByRole('status')).toContainText('Đã thêm "W11 Mục con mới".');
      await expect(tree).toContainText('W11 Mục con mới');
      await expect(tree).toContainText('3/8 mục con');
      await expectCleanScreen(page, 'danh-muc-da-them');
      await shot(page, 'danh-muc', 'da-them');

      // Trùng tên: lời báo tiếng Việt, mục không nhân đôi.
      await tree.getByRole('button', { name: `Thêm mục con vào "${ROOT}"` }).click();
      await paste(tree.getByRole('textbox', { name: `Tên mục con mới của "${ROOT}"` }), 'w11 mục con mới');
      const dup = await submitAndRead(page, () => tree.getByRole('button', { name: 'Thêm', exact: true }).click(), /\/admin\/categories$/);
      note('danh-muc', `trùng tên: ${dup.status} ${dup.body}`);
      expect(dup.status).toBeGreaterThanOrEqual(400);
      expect(dup.status).toBeLessThan(500);
      const dupText = (await tree.getByRole('alert').first().innerText()).trim();
      expect(dupText).not.toMatch(/Unique|constraint|undefined|\[object/);
      await tree.getByRole('button', { name: 'Huỷ', exact: true }).click();

      // Đổi tên.
      await tree.getByRole('button', { name: 'Đổi tên "W11 Mục con mới"' }).click();
      const renameBox = tree.getByRole('textbox', { name: 'Tên mới của "W11 Mục con mới"' });
      await expect(renameBox).toHaveValue('W11 Mục con mới');
      await paste(renameBox, INVISIBLE_MIX);
      const save = tree.getByRole('button', { name: 'Lưu', exact: true });
      if (await save.isEnabled()) {
        const r = await submitAndRead(page, () => save.click(), /\/admin\/categories\/[^/]+$/, 'PATCH');
        expect(r.status).toBe(400);
        const text = (await tree.getByRole('alert').first().innerText()).trim();
        expect(text).not.toMatch(/should|must|empty|undefined|Bad Request|\[object/);
      }
      await paste(renameBox, 'W11 Mục con đổi tên');
      await save.click();
      await expect(tree.getByRole('status')).toContainText('Đã đổi tên thành "W11 Mục con đổi tên".');
      await shot(page, 'danh-muc', 'da-doi-ten');

      // Xoá sau khi xác nhận.
      await tree.getByRole('button', { name: 'Xoá "W11 Mục con đổi tên"' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('Xoá danh mục "W11 Mục con đổi tên"?');
      await shot(page, 'danh-muc', 'hop-xac-nhan-xoa', true);
      await dialog.getByRole('button', { name: 'Xoá', exact: true }).click();
      await expect(tree.getByRole('status')).toContainText('Đã xoá "W11 Mục con đổi tên".');
      await expect(tree.getByRole('button', { name: 'Xoá "W11 Mục con đổi tên"' })).toHaveCount(0);
      await expectCleanScreen(page, 'danh-muc-cuoi');
      expectCleanWatch('danh-muc', w, [{ status: 0, path: /\/admin\/categories/, why: 'thử tên rỗng, vô hình và trùng tên' }]);
    });

    test('5. Nhãn hàng: danh sách, tạo nhãn, tên rỗng/vô hình/quá dài/trùng, quản lý, khuyến mãi', async ({ page }) => {
      test.setTimeout(120_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Nhãn hàng');
      const verified = page.locator('div.shadow-card, div.rounded-card').filter({ hasText: 'W11 Nhãn Chính Hãng' }).filter({ hasText: 'Quản lý' }).last();
      await expect(verified).toContainText('Chính hãng');
      await expect(verified, 'số người theo dõi có dấu chấm ngăn nghìn').toContainText('1.234 theo dõi');
      await expect(page.locator('div').filter({ hasText: /^W11 Nhãn Nháp/ }).first()).toBeVisible();
      await expectCleanScreen(page, 'nhan-hang');
      await shot(page, 'nhan-hang', 'danh-sach');

      const name = page.getByRole('textbox', { name: 'Tên nhãn', exact: false }).first();
      const tagline = page.getByRole('textbox', { name: /^Tagline/ }).first();
      const create = page.getByRole('button', { name: 'Tạo nhãn', exact: true });
      await expect(create, 'ô trống: nút Tạo nhãn khoá').toBeDisabled();
      await paste(name, SPACES);
      await expect(create).toBeDisabled();
      await paste(name, ZERO_WIDTH);
      if (await create.isEnabled()) {
        const r = await submitAndRead(page, () => create.click(), /\/admin\/brands$/);
        note('nhan-hang', `tên nhãn toàn ký tự vô hình: ${r.status} ${r.body}`);
        expect(r.status).toBe(400);
        const text = (await page.locator('p.text-danger-fg').last().innerText()).trim();
        note('nhan-hang', `lời báo tên vô hình trên màn: "${text}"`);
        expect(text).not.toMatch(/should|must|empty|undefined|Bad Request|\[object|slug/);
      }
      await paste(name, 'n'.repeat(140));
      expect(await name.inputValue(), 'ô tên nhãn chặn ở 120 ký tự').toHaveLength(120);
      await paste(tagline, 't'.repeat(260));
      expect(await tagline.inputValue(), 'ô tagline chặn ở 200 ký tự').toHaveLength(200);
      await paste(tagline, '');
      await paste(name, 'W11 Nhãn Nháp');
      const dup = await submitAndRead(page, () => create.click(), /\/admin\/brands$/);
      note('nhan-hang', `trùng tên nhãn: ${dup.status} ${dup.body}`);
      note('nhan-hang', `lời báo trùng tên trên màn: "${(await page.locator('p.text-danger-fg').last().innerText()).trim()}"`);
      expect(dup.status, 'trùng tên nhãn là lỗi nhập, không phải lỗi máy chủ').toBeLessThan(500);
      await paste(name, 'W11 Nhãn Mới Tạo');
      await paste(tagline, 'Câu giới thiệu thử');
      await create.click();
      await expect(page.locator('div').filter({ hasText: /^W11 Nhãn Mới Tạo/ }).first()).toBeVisible();
      await expectCleanScreen(page, 'nhan-hang-moi-tao');
      await shot(page, 'nhan-hang', 'moi-tao');

      // Quản lý nhãn chính hãng: mở rộng, thông tin, chứng nhận, khuyến mãi.
      const card = page.locator('div.rounded-card').filter({ hasText: 'W11 Nhãn Chính Hãng' }).last();
      await card.getByRole('button', { name: 'Quản lý' }).click();
      await expect(card.getByText('Thông tin nhãn')).toBeVisible();
      await expect(card.getByRole('button', { name: 'Ẩn (chuyển nháp)', exact: true })).toBeVisible();
      await expect(card.getByText('Đã xác minh', { exact: true }), 'ô tick chứng nhận ghi Đã xác minh bằng tiếng Việt').toBeVisible();
      expect(await card.innerText(), 'màn quản lý nhãn không còn chữ tiếng Anh verified, Proof URL, publish').not.toMatch(/\bverified\b|Proof URL|\(publish\)/);
      await expectCleanScreen(page, 'nhan-hang-quan-ly');
      await shot(page, 'nhan-hang', 'quan-ly');

      const promoTitle = card.getByRole('textbox', { name: 'Tiêu đề khuyến mãi' });
      const promoAdd = card.getByRole('button', { name: 'Thêm KM', exact: true });
      await expect(promoAdd).toBeDisabled();
      await paste(promoTitle, ZERO_WIDTH);
      if (await promoAdd.isEnabled()) {
        const r = await submitAndRead(page, () => promoAdd.click(), /\/admin\/brands\/[^/]+\/promotions$/);
        note('nhan-hang', `khuyến mãi tiêu đề vô hình: ${r.status} ${r.body}`);
        expect(r.status, 'khuyến mãi không tiêu đề không được tạo').toBe(400);
      }
      await paste(promoTitle, 't'.repeat(200));
      expect(await promoTitle.inputValue()).toHaveLength(160);
      await paste(promoTitle, 'W11 GIẢM 20% CUỐI TUẦN');
      const start = card.getByRole('textbox', { name: 'Khuyến mãi bắt đầu từ ngày' });
      const end = card.getByRole('textbox', { name: 'Khuyến mãi kết thúc ngày' });
      await paste(start, dmy(2).replace(/\//g, ''));
      await expect(start).toHaveValue(dmy(2));
      await paste(end, dmy(1));
      await end.blur();
      await expect(card.getByRole('alert').filter({ hasText: /ngoài khoảng/ })).toBeVisible();
      await paste(end, dmy(6));
      await promoAdd.click();
      await expect(card.getByText('W11 GIẢM 20% CUỐI TUẦN')).toBeVisible();
      await expectCleanScreen(page, 'nhan-hang-khuyen-mai');
      await shot(page, 'nhan-hang', 'khuyen-mai');
      expectCleanWatch('nhan-hang', w, [{ status: 0, path: /\/admin\/brands/, why: 'thử tên rỗng, vô hình và trùng tên' }]);
    });

    test('6. Chiến dịch (banner): danh sách, mốc giờ VN, lọc, tạo chiến dịch với ô trống/vô hình/quá dài', async ({ page }) => {
      test.setTimeout(150_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Chiến dịch');
      const row = (title: string) => page.locator('div.rounded-card').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: /^Sửa chiến dịch/ }) }).last();
      const live = row('W11 Giữa thu đang chạy');
      await expect(live).toContainText('Đang chạy');
      await expect(live, 'mốc 00:30 và 23:30 giờ VN hiện đúng giờ VN, không lệch theo múi giờ trình duyệt').toContainText(`${dmy(-2)} 00:30 → ${dmy(5)} 23:30`);
      await expect(live).toContainText('Đầu Trang chủ · Mọi khách · 0 sản phẩm · 0 mã');
      await expect(row('W11 Chiến dịch sắp chạy')).toContainText('Sắp chạy');
      await expect(row('W11 Chiến dịch sắp chạy')).toContainText(`${dmy(3)} 08:00 → ${dmy(10)} 22:00`);
      await expect(row('W11 Chiến dịch sắp chạy')).toContainText('Đầu Ưu đãi · Khách mới');
      await expect(row('W11 Chiến dịch đã kết thúc')).toContainText('Đã kết thúc');
      await expect(row('W11 Chiến dịch đang tắt')).toContainText('Đang tắt');
      await expect(row('W11 Chiến dịch đang tắt')).toContainText('Khách cũ');
      await expectCleanScreen(page, 'chien-dich');
      await shot(page, 'chien-dich', 'danh-sach');

      await page.getByRole('button', { name: 'Đầu Ưu đãi', exact: true }).click();
      await expect(page.getByText('W11 Chiến dịch sắp chạy')).toBeVisible();
      await expect(page.getByText('W11 Giữa thu đang chạy')).toHaveCount(0);
      await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
      await expect(page.getByText('W11 Giữa thu đang chạy')).toBeVisible();

      // Form tạo.
      await page.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click();
      const form = page.getByRole('form', { name: 'Tạo chiến dịch mới' });
      await expect(form).toBeVisible();
      const save = form.getByRole('button', { name: 'Lưu chiến dịch' });
      await expect(save, 'form trống: nút Lưu khoá').toBeDisabled();
      const title = form.getByRole('textbox', { name: 'Tên chiến dịch' });
      await paste(title, 't'.repeat(150));
      expect(await title.inputValue(), 'tên chiến dịch chặn ở 120 ký tự').toHaveLength(120);
      await paste(form.getByRole('textbox', { name: 'Phụ đề' }), 's'.repeat(230));
      expect(await form.getByRole('textbox', { name: 'Phụ đề' }).inputValue()).toHaveLength(200);
      await paste(form.getByRole('textbox', { name: 'Phụ đề' }), '');
      await paste(title, ZERO_WIDTH);

      await form.locator('input[type=file]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: solidPng(1500, 600, [34, 139, 34]) });
      await expect(form.getByRole('img', { name: /Ảnh banner/ })).toBeVisible();
      await paste(form.getByRole('textbox', { name: 'Bắt đầu: ngày' }), dmy(4).replace(/\//g, ''));
      await form.getByRole('combobox', { name: 'Bắt đầu: giờ' }).selectOption('23');
      await form.getByRole('combobox', { name: 'Bắt đầu: phút' }).selectOption('30');
      await paste(form.getByRole('textbox', { name: 'Kết thúc: ngày' }), dmy(9).replace(/\//g, ''));
      await form.getByRole('combobox', { name: 'Kết thúc: giờ' }).selectOption('00');
      await form.getByRole('combobox', { name: 'Kết thúc: phút' }).selectOption('30');
      await expect(form.getByRole('textbox', { name: 'Bắt đầu: ngày' })).toHaveValue(dmy(4));
      await expectCleanScreen(page, 'chien-dich-form');
      await shot(page, 'chien-dich', 'form-tao');

      // Tên chỉ ký tự vô hình: nút Lưu khoá, hoặc máy chủ từ chối bằng tiếng Việt; không tạo chiến dịch tên rỗng.
      if (await save.isEnabled()) {
        const r = await submitAndRead(page, () => save.click(), /\/admin\/campaigns$/);
        note('chien-dich', `tên toàn ký tự vô hình: ${r.status} ${r.body}`);
        expect(r.status).toBe(400);
        const text = (await form.getByRole('alert').first().innerText()).trim();
        note('chien-dich', `lời báo: "${text}"`);
        expect(text, 'lời báo bằng tiếng Việt, không lộ tên trường kỹ thuật').not.toMatch(/should|must|empty|title|undefined|Bad Request|\[object/);
      }
      await paste(title, 'W11 Chiến dịch tạo từ form');
      await expect(save, 'chiến dịch trống mà đang bật thì máy chủ khoá nút Lưu').toBeDisabled();
      await form.getByRole('checkbox', { name: 'Đang bật' }).uncheck();
      await expect(save).toBeEnabled();
      await paste(form.getByRole('spinbutton', { name: 'Thứ tự hiển thị' }), '99999');
      await save.click();
      await expect(form.getByRole('alert').filter({ hasText: 'Thứ tự là số nguyên từ 0 đến 9999.' })).toBeVisible();
      await paste(form.getByRole('spinbutton', { name: 'Thứ tự hiển thị' }), '5');
      await save.click();
      await expect(page.getByRole('status').filter({ hasText: 'Đã lưu chiến dịch.' })).toBeVisible();
      const created = row('W11 Chiến dịch tạo từ form');
      await expect(created, 'giờ 23:30 và 00:30 giờ VN lưu rồi đọc lại đúng').toContainText(`${dmy(4)} 23:30 → ${dmy(9)} 00:30`);
      await expect(created).toContainText('Đang tắt');
      await expectCleanScreen(page, 'chien-dich-da-tao');
      await shot(page, 'chien-dich', 'da-tao');

      // Sửa: mở form có sẵn giá trị đúng giờ VN; đóng; tắt rồi bật lại.
      await created.getByRole('button', { name: /^Sửa chiến dịch/ }).click();
      const edit = page.getByRole('form', { name: 'Sửa chiến dịch' });
      await expect(edit.getByRole('textbox', { name: 'Bắt đầu: ngày' })).toHaveValue(dmy(4));
      await expect(edit.getByRole('combobox', { name: 'Bắt đầu: giờ' })).toHaveValue('23');
      await expect(edit.getByRole('combobox', { name: 'Bắt đầu: phút' })).toHaveValue('30');
      await expect(edit.getByRole('combobox', { name: 'Kết thúc: giờ' })).toHaveValue('00');
      await shot(page, 'chien-dich', 'form-sua');
      await edit.getByRole('button', { name: 'Đóng' }).click();
      await expect(created.getByRole('button', { name: /^Bật chiến dịch/ }), 'chiến dịch trống còn lỗi chặn thì không bật được').toBeDisabled();
      await created.getByRole('button', { name: /^Xoá chiến dịch/ }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Xoá "W11 Chiến dịch tạo từ form"?');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Xoá chiến dịch' }).click();
      await expect(page.getByText('W11 Chiến dịch tạo từ form')).toHaveCount(0);
      expectCleanWatch('chien-dich', w, [{ status: 0, path: /\/admin\/campaigns/, why: 'thử tên vô hình' }]);
    });

    test('7. Cấu hình: thẻ tính năng, thông tin cửa hàng, điểm danh, tìm khoá, JSON', async ({ page, request }) => {
      test.setTimeout(150_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Cấu hình');
      await expect(page.getByRole('heading', { name: 'Bật/tắt tính năng' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Thông tin cửa hàng/ })).toBeVisible();
      await expectCleanScreen(page, 'cau-hinh');
      await shot(page, 'cau-hinh', 'tong-the');

      // Thông tin cửa hàng.
      const shop = page.locator('[data-shop-info]');
      const legalName = shop.getByRole('textbox', { name: /Tên công ty/ });
      const saveShop = shop.getByRole('button', { name: 'Lưu thông tin cửa hàng' });
      await expect(saveShop, 'chưa sửa gì: nút Lưu khoá').toBeDisabled();
      const bct = shop.getByRole('textbox', { name: /Link thông báo Bộ Công Thương/ });
      await paste(bct, 'http://khong-an-toan.test');
      await expect(shop.getByText('Link phải bắt đầu bằng https:// và không có khoảng trắng.')).toBeVisible();
      await expect(saveShop).toBeDisabled();
      await paste(bct, '');
      await paste(legalName, INVISIBLE_MIX);
      await expect(saveShop, 'tên công ty chỉ có ký tự vô hình: nút Lưu khoá, không ghi chuỗi vô hình vào cấu hình').toBeDisabled();
      await paste(legalName, 'Công ty TNHH W11 Thử Nghiệm');
      await saveShop.click();
      await expect(shop.getByRole('status').filter({ hasText: 'Đã lưu.' })).toBeVisible();
      const cfg = await (await adminGet(request, '/admin/config')).json();
      const rows = Array.isArray(cfg) ? cfg : (cfg.items ?? []);
      expect(rows.find((c: { key: string }) => c.key === 'company.legal_name')?.value).toBe('Công ty TNHH W11 Thử Nghiệm');
      await paste(legalName, 'x'.repeat(2000));
      await saveShop.click();
      const longRes = await Promise.race([
        page.waitForResponse((r) => /\/admin\/config$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT').then((r) => r.status()),
        shop.getByRole('alert').first().waitFor().then(() => -1),
      ]);
      note('cau-hinh', `tên công ty 2000 ký tự: ${longRes}`);
      await paste(legalName, 'Công ty TNHH W11 Thử Nghiệm');
      await shot(page, 'cau-hinh', 'thong-tin-cua-hang');

      // Điểm Xanh: số điểm danh và trần tích điểm.
      const loyalty = page.locator('section').filter({ has: page.getByRole('heading', { name: /Điểm Xanh — điểm danh/ }) });
      await expect(loyalty).toBeVisible();
      await expect(loyalty, 'tổng điểm điểm danh có dấu chấm ngăn nghìn').toContainText('Tổng 8.000 điểm/tuần');
      await paste(loyalty.getByRole('textbox', { name: 'Điểm ngày 1' }), '');
      await loyalty.getByRole('button', { name: /^Lưu/ }).first().click();
      const msg1 = loyalty.getByText(/Điểm danh —|Không có thay đổi/).first();
      await expect(msg1).toBeVisible();
      note('cau-hinh', `điểm ngày 1 để trống báo: "${(await msg1.innerText()).trim()}"`);
      expect((await msg1.innerText()).trim()).not.toMatch(/undefined|NaN|\[object|loyalty\./);
      await shot(page, 'cau-hinh', 'diem-danh-loi');

      // Tìm khoá và sửa JSON.
      await page.getByText('Cài đặt kỹ thuật (dành cho người cài đặt hệ thống)').click();
      const search = page.getByRole('searchbox', { name: 'Tìm khoá cấu hình' });
      await paste(search, 'zzz-khong-co-khoa-nao');
      await expect(page.getByText('Không có khoá nào khớp "zzz-khong-co-khoa-nao".')).toBeVisible();
      await paste(search, 'company.legal_name');
      const item = page.getByRole('textbox', { name: 'company.legal_name', exact: true });
      await expect(item).toBeVisible();
      await paste(item, '{khong hop le');
      await item.locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]').getByRole('button', { name: 'Lưu' }).click();
      await expect(page.getByText('JSON không hợp lệ')).toBeVisible();
      await expectCleanScreen(page, 'cau-hinh-json');
      await shot(page, 'cau-hinh', 'json-loi');
      expectCleanWatch('cau-hinh', w, [{ status: 0, path: /\/admin\/config/, why: 'thử giá trị vô hình và quá dài' }]);
    });

    test('8. Sức khoẻ hệ thống: việc nền, đồng bộ Pancake, ZNS, tin báo lỗi, đơn kẹt', async ({ page }) => {
      test.setTimeout(150_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Sức khoẻ hệ thống');
      await expect(page.getByRole('heading', { name: 'Sức khoẻ hệ thống', exact: true })).toBeVisible();
      const failing = page.getByRole('alert', { name: 'Việc nền đang lỗi' });
      await expect(failing).toBeVisible();
      await expect(failing).toContainText('Đóng tin ZNS kẹt chờ gửi');
      await expect(failing).toContainText(`${vnClock(SEED.ago(29))} · lỗi liên tiếp 4`);

      const zns = page.getByRole('region', { name: 'Tin ZNS' });
      await expect(zns).toContainText('Tin gửi hỏng trong 24 giờ');
      await expect(zns).toContainText('Lỗi gặp nhiều nhất: Zalo từ chối: mẫu tin chưa được duyệt (-124)');
      await expect(page.getByRole('region', { name: 'Pancake' })).toContainText('Chưa cấu hình');

      // Việc tự chạy nền: bảng (từ 640) hoặc thẻ (dưới 640), mốc giờ VN.
      const cron = page.getByRole('region', { name: 'Tác vụ nền', exact: true });
      await expect(cron).toContainText('Việc tự chạy nền');
      await expect(cron).toContainText('Đồng bộ danh mục Pancake (15 phút một lần)');
      await expect(cron).toContainText('Ném lỗi');
      await expect(cron).toContainText('Lỗi 2 lần ghi log');
      await expect(cron).toContainText('Bỏ qua');
      await expect(cron).toContainText(`Bắt đầu ${vnClock(SEED.ago(30))}`);
      await expect(cron).toContainText(`Xong ${vnClock(SEED.ago(29))}`);
      await expect(cron).toContainText('connect ECONNREFUSED');
      await expectCleanScreen(page, 'suc-khoe-viec-nen');
      await shot(page, 'suc-khoe', 'viec-nen');

      // Tin báo Pancake lỗi và đơn kẹt: mốc nhận, mốc đặt theo giờ VN.
      const events = page.getByRole('region', { name: 'Tin báo lỗi cần xử lý' });
      await expect(events).toContainText('Pancake · E2EW11-A');
      await expect(events).toContainText(`nhận ${vnClock(SEED.ago(50))}`);
      const eventsText = (await events.innerText()).replace(/\s+/g, ' ');
      note('suc-khoe', `dòng tin báo lỗi: "${eventsText.slice(0, 260)}"`);
      expect(eventsText, 'dòng tin báo lỗi không có chữ rác').not.toMatch(/undefined|NaN|\[object|Invalid Date/);
      const stuck = page.getByRole('region', { name: 'Đơn kẹt' });
      await expect(stuck).toContainText('E2EW11-D');
      await expect(stuck).toContainText(`đặt ${shown(order('D').day, order('D').at)}`);
      await expect(stuck).toContainText('đẩy lỗi · 3 lần thử');
      await expectCleanScreen(page, 'suc-khoe-tin-bao');
      await shot(page, 'suc-khoe', 'tin-bao-don-ket');

      // Công cụ vận hành: chưa cấu hình Pancake nên đồng bộ báo lỗi bằng tiếng Việt, không treo.
      await page.getByRole('button', { name: 'Đồng bộ danh mục Pancake', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('Đồng bộ danh mục Pancake ngay?');
      await shot(page, 'suc-khoe', 'hop-xac-nhan-dong-bo', true);
      await dialog.getByRole('button', { name: 'Đồng bộ', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Đồng bộ danh mục Pancake', exact: true })).toBeEnabled();
      await expect.poll(async () => (await page.locator('[role="alert"], [role="status"]').allInnerTexts()).some((t) => /đồng bộ|Pancake|cấu hình/i.test(t) && !/sự cố|Việc nền đang lỗi/.test(t)), { message: 'kết quả đồng bộ hiện thành lời báo' }).toBe(true);
      const resultText = (await page.locator('[role="alert"], [role="status"]').allInnerTexts()).map((t) => t.trim()).filter((t) => t && !/sự cố|Việc nền đang lỗi/.test(t)).join(' | ');
      note('suc-khoe', `đồng bộ khi chưa cấu hình Pancake báo: "${resultText}"`);
      expect(resultText).not.toMatch(/undefined|NaN|\[object|Internal|Bad Request|Service Unavailable/);
      await page.getByRole('button', { name: 'Làm mới' }).click();
      await expectCleanScreen(page, 'suc-khoe-cuoi');
      expectCleanWatch('suc-khoe', w, [{ status: 0, path: /\/admin\/ops\//, why: 'đồng bộ Pancake khi chưa cấu hình' }, { status: 0, path: /\/pancake/, why: 'đồng bộ Pancake khi chưa cấu hình' }]);
    });

    test('9. Mẫu thông báo: kênh ZNS, lượt gửi 30 ngày, lỗi ZNS, lời báo khi lưu sai', async ({ page }) => {
      test.setTimeout(120_000);
      const w = watch(page);
      await openAdmin(page);
      await gotoNav(page, 'Mẫu thông báo');
      const tpl = page.locator('[data-template="ORDER_CONFIRMED"]');
      await expect(tpl).toBeVisible();
      await expect(tpl).toContainText('2 lượt / 30 ngày');
      await expect(tpl, 'lượt ZNS lỗi và lần lỗi gần nhất theo giờ VN').toContainText(`3 lượt ZNS lỗi trong 30 ngày, khách chưa nhận tin Zalo. Lần gần nhất (${vnClock(SEED.ago(80))}): Zalo từ chối: mẫu tin chưa được duyệt (-124)`);
      await expectCleanScreen(page, 'mau-thong-bao');
      await tpl.scrollIntoViewIfNeeded();
      await shot(page, 'mau-thong-bao', 'mau-co-loi-zns');

      // Kênh ZNS không mã mẫu: cảnh báo, nút Lưu khoá; mã mẫu có chữ: máy chủ từ chối bằng tiếng Việt.
      await tpl.locator('select[name="channel"]').selectOption('ZNS');
      await expect(tpl.getByText('Kênh ZNS cần mã mẫu Zalo đã duyệt.')).toBeVisible();
      await expect(tpl.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
      await paste(tpl.locator('input[name="zaloTemplateId"]'), 'abc');
      await expect(tpl.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled();
      const bad = await submitAndRead(page, () => tpl.getByRole('button', { name: 'Lưu', exact: true }).click(), /\/admin\/notification-templates\/ORDER_CONFIRMED$/, 'PATCH');
      note('mau-thong-bao', `mã mẫu có chữ: ${bad.status} ${bad.body}`);
      expect(bad.status).toBe(400);
      const alert = tpl.getByRole('alert').first();
      await expect(alert).toBeVisible();
      expect((await alert.innerText()).trim()).toMatch(/dãy số/);
      await paste(tpl.locator('input[name="zaloTemplateId"]'), '9'.repeat(30));
      expect(await tpl.locator('input[name="zaloTemplateId"]').inputValue()).toHaveLength(20);
      await tpl.locator('select[name="channel"]').selectOption('INAPP');
      await paste(tpl.locator('input[name="zaloTemplateId"]'), '');

      // Nội dung: biến lạ báo lỗi ngay, ô trống khoá nút.
      const body = tpl.locator('textarea[name="bodyTemplate"]');
      const original = await body.inputValue();
      await paste(body, `${original} {{khong_co_bien_nay}}`);
      const problem = tpl.getByRole('alert').first();
      await expect(problem).toBeVisible();
      const problemText = (await problem.innerText()).trim();
      note('mau-thong-bao', `biến lạ báo: "${problemText}"`);
      expect(problemText).not.toMatch(/undefined|NaN|\[object/);
      await expect(tpl.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
      await paste(body, '');
      await expect(tpl.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
      await paste(body, SPACES);
      await expect(tpl.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
      await paste(body, original);
      await expectCleanScreen(page, 'mau-thong-bao-cuoi');
      expectCleanWatch('mau-thong-bao', w, [{ status: 400, path: /\/admin\/notification-templates\//, why: 'mã mẫu ZNS có chữ' }]);
    });
  });
}
