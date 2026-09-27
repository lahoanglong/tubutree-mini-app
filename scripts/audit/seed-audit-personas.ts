/**
 * AUDIT-ONLY persona seed for the isolated screenshot environment (database `tubutree_audit`).
 *
 * Run AFTER `prisma migrate deploy` + `prisma/seed.ts` on the audit DB:
 *   cd apps/api
 *   DATABASE_URL="$(node ../../scripts/audit/build-audit-env.mjs --print-db)" \
 *     pnpm exec tsx ../../scripts/audit/seed-audit-personas.ts
 * (DATABASE_URL may be omitted: it is then read from .audit/api.env.)
 *
 * Safety: REFUSES to run unless DATABASE_URL's database name is exactly `tubutree_audit`, and sets
 * DATABASE_URL in process.env BEFORE loading @prisma/client (the generated client auto-loads
 * apps/api/.env — the OWNER's dev DB — for any env key that is missing).
 *
 * Idempotent: users have fixed ids; every run deletes the rows owned by the audit users and
 * recreates them with dates relative to "now" (so "delivered 3 days ago" stays true), upserts
 * shared reference data, re-mints tokens, and rewrites scripts/audit/personas.json + routes.json.
 * Prints the created ids/slugs/codes as JSON on stdout.
 *
 * `--tokens-only`: skip the data part — revoke the audit users' refresh tokens and re-mint
 * personas.json (use after a refresh token was consumed/burned).
 */
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ───────────────────────────── bootstrap & guards ─────────────────────────────
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml')) && existsSync(path.join(dir, 'apps', 'api'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('Cannot locate repo root (pnpm-workspace.yaml). Run from inside the repo.');
}
const REPO = findRepoRoot();
const AUDIT_DIR = path.join(REPO, '.audit');
const AUDIT_ENV_FILE = path.join(AUDIT_DIR, 'api.env');
const OUT_DIR = path.join(REPO, 'scripts', 'audit');
const EXPECTED_DB = 'tubutree_audit';

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}
const auditEnv = parseEnvFile(AUDIT_ENV_FILE);
if (!process.env.DATABASE_URL && auditEnv.DATABASE_URL) process.env.DATABASE_URL = auditEnv.DATABASE_URL;

function dbNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}
const DB_URL = process.env.DATABASE_URL;
if (dbNameOf(DB_URL) !== EXPECTED_DB) {
  console.error(
    `REFUSING TO RUN: DATABASE_URL database is "${dbNameOf(DB_URL) ?? '(unset)'}" — this script only ever writes "${EXPECTED_DB}".`,
  );
  process.exit(1);
}
const JWT_SECRET = auditEnv.JWT_ACCESS_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error(`Missing JWT_ACCESS_SECRET in ${AUDIT_ENV_FILE} — run: node scripts/audit/build-audit-env.mjs`);
  process.exit(1);
}
const REFRESH_TTL_DAYS = Number(auditEnv.JWT_REFRESH_TTL_DAYS || 30) || 30;

// Resolve @prisma/client through apps/api (pnpm does not hoist it to the repo root).
const requireFromApi = createRequire(path.join(REPO, 'apps', 'api', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient, Prisma } = requireFromApi('@prisma/client');
if (process.env.DATABASE_URL !== DB_URL || dbNameOf(process.env.DATABASE_URL) !== EXPECTED_DB) {
  console.error('REFUSING TO RUN: DATABASE_URL changed while loading @prisma/client.');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma: any = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ───────────────────────────── helpers ─────────────────────────────
const NOW = new Date();
const VN = 7 * 3600e3;
const DAY = 864e5;
const HOUR = 3600e3;
const MIN = 60e3;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Deterministic cuid-looking id ("c" + 24 base36 chars) so ids stay stable across re-seeds. */
function cid(key: string): string {
  const n = BigInt('0x' + sha(`tubu-audit:${key}`).slice(0, 30));
  return ('c' + n.toString(36).padStart(24, '0')).slice(0, 25);
}
const refCode = (key: string) => sha(`ref:${key}`).slice(0, 8).toUpperCase();
const digits = (key: string, n: number) => String(BigInt('0x' + sha(key).slice(0, 16)) % BigInt(10 ** n)).padStart(n, '0');

function vnParts(d: Date) {
  const v = new Date(d.getTime() + VN);
  return { y: v.getUTCFullYear(), m: v.getUTCMonth(), d: v.getUTCDate(), dow: v.getUTCDay() };
}
/** UTC instant for VN wall time `hh:mm`, `daysAgo` days before today (VN). */
function at(daysAgo: number, hh: number, mm = 0): Date {
  const p = vnParts(NOW);
  return new Date(Date.UTC(p.y, p.m, p.d - daysAgo, hh, mm) - VN);
}
const minsAgo = (n: number) => new Date(NOW.getTime() - n * MIN);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * HOUR);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
/** Clamp a derived instant into the past (quarter/month-relative dates must never be in the future). */
const past = (d: Date) => (d.getTime() > NOW.getTime() - 10 * MIN ? new Date(NOW.getTime() - 10 * MIN) : d);
const vnDayKey = (d: Date) => new Date(d.getTime() + VN).toISOString().slice(0, 10);
/** midnight UTC of the VN date key (Shift.workDate / PayrollDay.workDate convention). */
const workDateOf = (d: Date) => new Date(`${vnDayKey(d)}T00:00:00.000Z`);
function vnMonthStart(d: Date, offsetMonths = 0): Date {
  const p = vnParts(d);
  return new Date(Date.UTC(p.y, p.m + offsetMonths, 1) - VN);
}
const monthKeyOf = (d: Date) => new Date(d.getTime() + VN).toISOString().slice(0, 7);
function vnQuarter(d: Date, offset = 0) {
  const p = vnParts(d);
  let q = Math.floor(p.m / 3) + offset;
  let y = p.y;
  while (q < 0) { q += 4; y -= 1; }
  while (q > 3) { q -= 4; y += 1; }
  return {
    key: `Q${q + 1}/${y}`,
    start: new Date(Date.UTC(y, q * 3, 1) - VN),
    end: new Date(Date.UTC(y, q * 3 + 3, 1) - VN),
  };
}
const MONTH_START = vnMonthStart(NOW);
const PREV_MONTH_START = vnMonthStart(NOW, -1);
const SINCE_MONTH_START = NOW.getTime() - MONTH_START.getTime();
/** An instant inside the CURRENT VN month, at fraction f of the time elapsed so far (always < now). */
const inThisMonth = (f: number) => new Date(MONTH_START.getTime() + Math.max(SINCE_MONTH_START * f, 30 * MIN));
/** An instant inside the PREVIOUS VN month at fraction f. */
const inPrevMonth = (f: number) =>
  new Date(PREV_MONTH_START.getTime() + (MONTH_START.getTime() - PREV_MONTH_START.getTime()) * f);
const Q_CUR = vnQuarter(NOW);
const Q_PREV = vnQuarter(NOW, -1);
const inQuarter = (q: { start: Date; end: Date }, f: number) => {
  const end = Math.min(q.end.getTime(), NOW.getTime() - HOUR);
  return new Date(q.start.getTime() + (end - q.start.getTime()) * f);
};
const YEAR_KEY = String(vnParts(NOW).y);

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}
function signJwt(payload: Record<string, unknown>, ttlSec: number): { token: string; exp: number } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSec;
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat, exp }));
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest());
  return { token: `${head}.${body}.${sig}`, exp };
}
/** zmp-sdk LocalResourceStorage value encoding: btoa(encodeURIComponent(JSON.stringify(v))). */
const zmpEncode = (v: unknown) => Buffer.from(encodeURIComponent(JSON.stringify(v)), 'binary').toString('base64');

// ───────────────────────────── personas ─────────────────────────────
type PersonaKey = 'new_customer' | 'active_customer' | 'ctv' | 'dealer' | 'brand_owner' | 'staff' | 'admin';
interface PersonaDef {
  key: string;
  id: string;
  phone: string;
  fullName: string;
  role: 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN';
  referralCode: string;
  zaloId: string;
  email?: string;
  dob?: Date;
  createdDaysAgo: number;
  segments: string[] | null; // null = not onboarded
  extraMeta?: Record<string, unknown>;
}
const zaloIdOf = (key: string) => '8' + digits(`zalo:${key}`, 18);
function persona(
  key: string,
  phone: string,
  fullName: string,
  role: PersonaDef['role'],
  createdDaysAgo: number,
  segments: string[] | null,
  extra: Partial<PersonaDef> = {},
): PersonaDef {
  return {
    key,
    id: cid(`user:${key}`),
    phone,
    fullName,
    role,
    referralCode: refCode(key),
    zaloId: zaloIdOf(key),
    createdDaysAgo,
    segments,
    ...extra,
  };
}
const P: Record<PersonaKey, PersonaDef> = {
  new_customer: persona('new_customer', '0900000001', 'Trần Minh Khoa', 'CUSTOMER', 0, ['home_clean', 'self', 'natural']),
  active_customer: persona('active_customer', '0900000002', 'Nguyễn Thị Thu Hà', 'CUSTOMER', 140, ['skincare', 'mom_baby', 'home_clean', 'sensitive_skin', 'family', 'natural'], {
    email: 'thuha.audit@example.com',
    dob: new Date('1992-10-03T00:00:00.000Z'),
  }),
  ctv: persona('ctv', '0900000003', 'Lê Hoàng Mai', 'AFFILIATE', 200, ['skincare', 'eco', 'self', 'natural'], { email: 'hoangmai.ctv@example.com' }),
  dealer: persona('dealer', '0900000004', 'Phạm Văn Đức', 'DEALER', 260, ['home_clean', 'family', 'price'], {
    extraMeta: { dealerTierId: 'DEALER_2', businessName: 'Tạp hoá Xanh Đức Phát' },
  }),
  brand_owner: persona('brand_owner', '0900000005', 'Võ Thanh Tâm', 'CUSTOMER', 300, ['home_clean', 'eco', 'vietnamese']),
  staff: persona('staff', '0900000006', 'Đặng Ngọc Lan', 'STAFF', 180, ['skincare', 'self', 'natural']),
  admin: persona('admin', '0900000007', 'Bùi Quốc Anh', 'ADMIN', 400, ['eco', 'family', 'vietnamese']),
};
const BG = {
  linh: persona('bg_linh', '0900000011', 'Hoàng Thị Mỹ Linh', 'CUSTOMER', 120, ['skincare', 'self', 'natural']),
  thinh: persona('bg_thinh', '0900000012', 'Ngô Đức Thịnh', 'CUSTOMER', 95, ['home_clean', 'eco', 'price']),
  ngoc: persona('bg_ngoc', '0900000013', 'Trịnh Bảo Ngọc', 'CUSTOMER', 110, ['mom_baby', 'baby', 'natural']),
  huy: persona('bg_huy', '0900000014', 'Phan Gia Huy', 'CUSTOMER', 60, ['men', 'self', 'price']),
  duong: persona('bg_duong', '0900000015', 'Đỗ Thùy Dương', 'CUSTOMER', 20, ['eco', 'packaging']),
};
const GUEST_DEVICE_ID = 'd_audit_guest_onboarded_0001';
const GUEST_USER = { id: cid('user:guest_onboarded'), zaloId: `guest_${GUEST_DEVICE_ID}`, referralCode: refCode('guest_onboarded') };
const ALL_USERS: PersonaDef[] = [...Object.values(P), ...Object.values(BG)];
const AUDIT_USER_IDS = [...ALL_USERS.map((u) => u.id), GUEST_USER.id];
const AUDIT_PHONES = ALL_USERS.map((u) => u.phone);

// ───────────────────────────── catalog lookups ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Var = { id: string; sku: string; name: string; retailPrice: number; salePrice: number | null; productId: string; product: any };
let VARS: Map<string, Var>;
const priceOf = (v: Var) => v.salePrice ?? v.retailPrice;
function V(sku: string): Var {
  const v = VARS.get(sku);
  if (!v) throw new Error(`Seed variation ${sku} not found — run apps/api/prisma/seed.ts first.`);
  return v;
}

// ───────────────────────────── address book ─────────────────────────────
interface Addr {
  id: string;
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  isDefault: boolean;
}
const HCM = { province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79' };
const HN = { province: 'Thành phố Hà Nội', provinceCode: '84_VN01' };
function addr(key: string, recipient: string, phone: string, street: string, ward: string, wardCode: string, prov = HCM, isDefault = true): Addr {
  return { id: cid(`addr:${key}`), recipient, phone, province: prov.province, district: '', ward, street, provinceCode: prov.provinceCode, districtCode: '', wardCode, isDefault };
}
const ADDR = {
  activeHome: addr('active:home', 'Nguyễn Thị Thu Hà', '0900000002', '12 Đường số 7, KDC Him Lam', 'Phường Tân Hưng', '84_VN7927088'),
  activeOffice: addr('active:office', 'Nguyễn Thị Thu Hà', '0900000002', 'Tầng 5, 81 Cách Mạng Tháng Tám', 'Phường Bến Thành', '84_VN7926743', HCM, false),
  ctvHome: addr('ctv:home', 'Lê Hoàng Mai', '0900000003', '45/2 Nguyễn Văn Đậu', 'Phường Bình Lợi Trung', '84_VN7926956'),
  linh: addr('linh:home', 'Hoàng Thị Mỹ Linh', '0900000011', '88 Trần Não', 'Phường An Khánh', '84_VN7927094'),
  thinh: addr('thinh:home', 'Ngô Đức Thịnh', '0900000012', '17 Lê Văn Việt', 'Phường Tăng Nhơn Phú', '84_VN7926830'),
  ngoc: addr('ngoc:home', 'Trịnh Bảo Ngọc', '0900000013', '203 Xuân Thủy', 'Phường Cầu Giấy', '84_VN0100166', HN),
  huy: addr('huy:home', 'Phan Gia Huy', '0900000014', '9 Phạm Văn Chiêu', 'Phường An Hội Tây', '84_VN7926893'),
  brandOwner: addr('brand_owner:home', 'Võ Thanh Tâm', '0900000005', 'Golf Park, 1 đường số 2', 'Phường Long Bình', '84_VN7926680'),
};
const snap = (a: Addr) => ({
  recipient: a.recipient, phone: a.phone, province: a.province, district: a.district, ward: a.ward,
  street: a.street, provinceCode: a.provinceCode, districtCode: a.districtCode, wardCode: a.wardCode,
});

// ───────────────────────────── notifications ─────────────────────────────
let TEMPLATES: Map<string, string>;
const render = (tpl: string, data: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
async function notify(userId: string, code: string, data: Record<string, string>, sentAt: Date, read: boolean) {
  const tpl = TEMPLATES.get(code);
  const body = tpl ? render(tpl, data) : 'Tubu Tree có cập nhật mới cho bạn. Mở mục liên quan trong app để xem chi tiết nhé 🌿';
  await prisma.notificationLog.create({
    data: { userId, templateCode: code, channel: 'INAPP', payload: { body, data }, status: read ? 'READ' : 'SENT', sentAt },
  });
}

// ───────────────────────────── orders ─────────────────────────────
type OrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'PACKED' | 'SHIPPING' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';
interface OrderSpec {
  key: string;
  userId: string;
  createdAt: Date;
  status: OrderStatus;
  type?: 'RETAIL' | 'DEALER';
  paymentMethod: 'COD' | 'ZALOPAY' | 'BANK_TRANSFER' | 'WALLET' | 'XU';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  items: { sku: string; qty: number; unitPrice?: number; backordered?: number }[];
  discount?: number;
  couponCode?: string;
  pointsUsed?: number;
  tierMult?: number;
  freeshipFrom?: number; // subtotal threshold giving free ship (200k default; 99k Lộc Biếc)
  noShipping?: boolean;
  referrerUserId?: string;
  storefrontSlug?: string;
  placedForCustomer?: boolean;
  address: Record<string, unknown>;
  note?: string;
  deliveredAt?: Date;
  pancakeOrderId?: string;
  shipping?: { partner?: string; code?: string; status?: string; link?: string; history?: { at: Date; status: string; carrier: string; code: string }[] };
  invoiceRequest?: Record<string, unknown>;
  recycling?: { note: string; gomdonOrderId?: string | null; partnerCode?: string | null; status: string; statusAt?: Date | null };
  history: { to: OrderStatus; from: OrderStatus | 'NEW'; at: Date; actor: 'CUSTOMER' | 'ADMIN' | 'PANCAKE' | 'SYSTEM' | 'MERCHANT'; actorId?: string; note?: string }[];
  updatedAt?: Date;
}
interface BuiltOrder {
  id: string;
  code: string;
  key: string;
  userId: string;
  status: OrderStatus;
  total: number;
  subtotal: number;
  pointsEarned: number;
  createdAt: Date;
  deliveredAt?: Date;
  items: { variationId: string; productName: string; productSlug: string; total: number; productId: string }[];
  referrerUserId?: string;
  storefrontSlug?: string;
  paymentMethod: string;
}
const ORDERS = new Map<string, BuiltOrder>();

function orderCode(spec: OrderSpec): string {
  if (spec.type === 'DEALER') return `DLR${String(spec.createdAt.getTime() + Number(digits(`ms:${spec.key}`, 7))).slice(-8)}${digits(`code:${spec.key}`, 3)}`;
  const d = spec.createdAt;
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `TUBU${ymd}${digits(`code:${spec.key}`, 5)}`;
}

async function createOrder(spec: OrderSpec): Promise<BuiltOrder> {
  const lines = spec.items.map((it) => {
    const v = V(it.sku);
    const unitPrice = it.unitPrice ?? priceOf(v);
    return {
      variationId: v.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      variationName: v.name,
      unitPrice,
      quantity: it.qty,
      total: unitPrice * it.qty,
      backorderedQty: it.backordered ?? 0,
      productId: v.productId,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const discount = spec.discount ?? 0;
  const pointsDiscount = (spec.pointsUsed ?? 0) * 1000;
  const goods = Math.max(0, subtotal - discount - pointsDiscount);
  const freeFrom = spec.freeshipFrom ?? 200000;
  const shippingFee = spec.noShipping || spec.type === 'DEALER' ? 0 : subtotal >= freeFrom ? 0 : 19000;
  const total = goods + shippingFee;
  const pointsEarned = spec.type === 'DEALER' || spec.paymentMethod === 'XU' ? 0 : Math.floor((goods / 10000) * (spec.tierMult ?? 1));
  const id = cid(`order:${spec.key}`);
  const code = orderCode(spec);
  const lastAt = spec.history.length ? spec.history[spec.history.length - 1]!.at : spec.createdAt;
  await prisma.order.create({
    data: {
      id,
      code,
      idempotencyKey: `audit-seed:${spec.key}`,
      pancakeOrderId: spec.pancakeOrderId ?? null,
      userId: spec.userId,
      type: spec.type ?? 'RETAIL',
      status: spec.status,
      subtotal,
      discount: discount + pointsDiscount,
      shippingFee,
      total,
      pointsEarned,
      pointsUsed: spec.pointsUsed ?? 0,
      paymentMethod: spec.paymentMethod,
      paymentStatus: spec.paymentStatus,
      paymentTxnId: spec.paymentMethod === 'ZALOPAY' && spec.paymentStatus !== 'UNPAID' ? `${vnDayKey(spec.createdAt).slice(2).replace(/-/g, '')}_${digits(`zp:${spec.key}`, 9)}` : null,
      shippingAddress: spec.address,
      shippingPartner: spec.shipping?.partner ?? null,
      shippingCode: spec.shipping?.code ?? null,
      shippingStatus: spec.shipping?.status ?? null,
      trackingLink: spec.shipping?.link ?? null,
      shippingHistory: spec.shipping?.history
        ? spec.shipping.history.map((h) => ({ at: h.at.toISOString(), status: h.status, carrier: h.carrier, code: h.code }))
        : undefined,
      invoiceRequest: spec.invoiceRequest ?? undefined,
      invoiceStatus: spec.invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED',
      referrerUserId: spec.referrerUserId ?? null,
      storefrontSlug: spec.storefrontSlug ?? null,
      placedForCustomer: spec.placedForCustomer ?? false,
      couponCode: spec.couponCode ?? null,
      note: spec.note ?? null,
      hasRecyclingPickup: Boolean(spec.recycling),
      recyclingNote: spec.recycling?.note ?? null,
      gomdonOrderId: spec.recycling?.gomdonOrderId ?? null,
      gomdonPartnerCode: spec.recycling?.partnerCode ?? null,
      gomdonStatus: spec.recycling?.status ?? null,
      gomdonStatusAt: spec.recycling?.statusAt ?? null,
      deliveredAt: spec.deliveredAt ?? null,
      createdAt: spec.createdAt,
      updatedAt: spec.updatedAt ?? lastAt,
      items: {
        create: lines.map((l) => ({
          variationId: l.variationId,
          productName: l.productName,
          productSlug: l.productSlug,
          variationName: l.variationName,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          total: l.total,
          backorderedQty: l.backorderedQty,
        })),
      },
    },
  });
  for (const h of spec.history) {
    if (h.from === 'NEW') continue;
    await prisma.orderStatusHistory.create({
      data: { orderId: id, fromStatus: h.from, toStatus: h.to, actorType: h.actor, actorId: h.actorId ?? null, note: h.note ?? null, createdAt: h.at },
    });
  }
  const built: BuiltOrder = {
    id, code, key: spec.key, userId: spec.userId, status: spec.status, total, subtotal, pointsEarned,
    createdAt: spec.createdAt, deliveredAt: spec.deliveredAt,
    items: lines.map((l) => ({ variationId: l.variationId, productName: l.productName, productSlug: l.productSlug, total: l.total, productId: l.productId })),
    referrerUserId: spec.referrerUserId, storefrontSlug: spec.storefrontSlug, paymentMethod: spec.paymentMethod,
  };
  ORDERS.set(spec.key, built);
  return built;
}

/** Standard retail status trail (created → ... → target) with realistic actors. */
function trail(
  created: Date,
  target: OrderStatus,
  opts: { paidOnline?: boolean; stepsH?: number[]; cancelBy?: 'CUSTOMER' | 'ADMIN'; cancelAt?: Date; deliveredAt?: Date; returnedAt?: Date; adminId?: string; userId?: string },
): OrderSpec['history'] {
  const h: OrderSpec['history'] = [];
  const steps = opts.stepsH ?? [0.2, 20, 30, 70];
  const first: OrderStatus = opts.paidOnline ? 'PENDING_PAYMENT' : 'CONFIRMED';
  h.push({ from: 'NEW', to: first, at: created, actor: 'CUSTOMER' });
  if (target === 'PENDING_PAYMENT') return h;
  if (target === 'CANCELLED') {
    h.push({ from: first, to: 'CANCELLED', at: opts.cancelAt ?? plus(created, 3 * HOUR), actor: opts.cancelBy ?? 'CUSTOMER', actorId: opts.cancelBy === 'ADMIN' ? opts.adminId : opts.userId, note: opts.cancelBy === 'ADMIN' ? 'Khách báo huỷ qua Zalo OA' : undefined });
    return h;
  }
  if (opts.paidOnline) h.push({ from: 'PENDING_PAYMENT', to: 'CONFIRMED', at: plus(created, steps[0]! * HOUR), actor: 'SYSTEM', note: 'Thanh toán thành công' });
  if (target === 'CONFIRMED') return h;
  h.push({ from: 'CONFIRMED', to: 'PACKED', at: plus(created, steps[1]! * HOUR), actor: 'PANCAKE' });
  if (target === 'PACKED') return h;
  h.push({ from: 'PACKED', to: 'SHIPPING', at: plus(created, steps[2]! * HOUR), actor: 'PANCAKE' });
  if (target === 'SHIPPING') return h;
  const delivered = opts.deliveredAt ?? plus(created, steps[3]! * HOUR);
  h.push({ from: 'SHIPPING', to: 'DELIVERED', at: delivered, actor: 'PANCAKE' });
  if (target === 'DELIVERED') return h;
  h.push({ from: 'DELIVERED', to: 'RETURNED', at: opts.returnedAt ?? plus(delivered, 5 * DAY), actor: 'ADMIN', actorId: opts.adminId, note: 'Duyệt đổi/trả — lỗi nhà sản xuất' });
  return h;
}
function ghnHistory(code: string, created: Date, upto: 'SHIPPING' | 'DELIVERED') {
  const carrier = 'Giao Hàng Nhanh';
  const hist = [
    { at: plus(created, 22 * HOUR), status: 'Chờ lấy hàng', carrier, code },
    { at: plus(created, 27 * HOUR), status: 'Lấy hàng thành công', carrier, code },
    { at: plus(created, 34 * HOUR), status: 'Đang luân chuyển qua kho trung chuyển', carrier, code },
    { at: plus(created, 44 * HOUR), status: 'Đang giao hàng', carrier, code },
  ];
  if (upto === 'DELIVERED') hist.push({ at: plus(created, 70 * HOUR), status: 'Giao hàng thành công', carrier, code });
  return hist;
}

// ───────────────────────────── ledgers ─────────────────────────────
async function points(userId: string, delta: number, reason: string, createdAt: Date, extra: { refType?: string; refId?: string; expires?: boolean } = {}) {
  await prisma.pointsTransaction.create({
    data: {
      userId, delta, reason, refType: extra.refType ?? null, refId: extra.refId ?? null, createdAt,
      expiresAt: delta > 0 && extra.expires !== false ? plus(createdAt, 365 * DAY) : null,
    },
  });
}
async function coins(userId: string, delta: number, reason: string, createdAt: Date, refType?: string, refId?: string) {
  await prisma.coinTransaction.create({ data: { userId, delta, reason, refType: refType ?? null, refId: refId ?? null, createdAt } });
}
const RATES: Record<string, number> = {
  Visante: 12, 'Pơ Lang': 10, Fuwa3e: 10, Cobote: 12, 'Le Plateau Coffee': 8, 'BH.Nong': 15, Sokfram: 10, Hector: 10,
};
const BLOCKED_PRODUCT = 'p-hector-deo';
async function commissionFor(o: BuiltOrder, status: 'PENDING' | 'LOCKED' | 'APPROVED' | 'PAID' | 'REJECTED', t: { lockedAt?: Date; approvedAt?: Date; paidAt?: Date; payoutBatchId?: string } = {}) {
  if (!o.referrerUserId) throw new Error(`order ${o.key} has no referrer`);
  let amount = 0;
  let rateSum = 0;
  let commissionable = 0;
  for (const it of o.items) {
    const v = [...VARS.values()].find((x) => x.id === it.variationId)!;
    const rate = v.productId === BLOCKED_PRODUCT ? 0 : RATES[v.product.brand] ?? 10;
    amount += Math.floor((it.total * rate) / 100);
    rateSum += rate;
    if (rate > 0) commissionable += it.total;
  }
  const c = await prisma.commission.create({
    data: {
      id: cid(`commission:${o.key}`),
      affiliateUserId: o.referrerUserId,
      orderId: o.id,
      orderTotal: o.total,
      commissionableTotal: commissionable,
      rate: new Prisma.Decimal((rateSum / o.items.length).toFixed(2)),
      amount,
      status,
      lockedAt: t.lockedAt ?? null,
      approvedAt: t.approvedAt ?? null,
      paidAt: t.paidAt ?? null,
      payoutBatchId: t.payoutBatchId ?? null,
      createdAt: o.createdAt,
    },
  });
  return { id: c.id as string, amount, commissionable };
}

// ───────────────────────────── cleanup ─────────────────────────────
async function cleanup() {
  const ids = AUDIT_USER_IDS;
  const orderIds = (await prisma.order.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((o: { id: string }) => o.id);
  const postIds = (await prisma.feedPost.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p: { id: string }) => p.id);
  const commentIds = (await prisma.feedComment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((c: { id: string }) => c.id);
  const links = await prisma.affiliateLink.findMany({ where: { userId: { in: ids } }, select: { shortCode: true } });
  const stores = await prisma.storefront.findMany({ where: { ownerUserId: { in: ids } }, select: { id: true } });
  const storeIds = stores.map((s: { id: string }) => s.id);

  await prisma.commission.deleteMany({ where: { OR: [{ affiliateUserId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.ctvMilestoneClaim.deleteMany({ where: { userId: { in: ids } } });
  await prisma.payout.deleteMany({ where: { userId: { in: ids } } });
  await prisma.affiliateClick.deleteMany({ where: { shortCode: { in: links.map((l: { shortCode: string }) => l.shortCode) } } });
  await prisma.affiliateLink.deleteMany({ where: { userId: { in: ids } } });
  await prisma.cashbackTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.cashbackClick.deleteMany({ where: { userId: { in: ids } } });
  await prisma.returnRequest.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.gomdonWebhookEvent.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { dedupeKey: { startsWith: 'audit:' } }] } });
  await prisma.couponRedemption.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.review.deleteMany({ where: { userId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.pointsTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.coinTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.loyaltyCheckIn.deleteMany({ where: { userId: { in: ids } } });
  await prisma.posPointCredit.deleteMany({ where: { OR: [{ memberId: { in: ids } }, { staffUserId: { in: ids } }] } });
  await prisma.wishlist.deleteMany({ where: { userId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notificationLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gardenPlot.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userSpecies.deleteMany({ where: { userId: { in: ids } } });
  await prisma.plantedTree.deleteMany({ where: { userId: { in: ids } } });
  await prisma.waterGift.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { recipientId: { in: ids } }] } });
  await prisma.communityContribution.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gameSpin.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gameQuizAttempt.deleteMany({ where: { userId: { in: ids } } });
  await prisma.missionProgress.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userSeasonPass.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gameProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.bottleReturn.deleteMany({ where: { userId: { in: ids } } });
  await prisma.betaFeedback.deleteMany({ where: { userId: { in: ids } } });
  await prisma.betaTester.deleteMany({ where: { userId: { in: ids } } });
  await prisma.communityReport.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { targetId: { in: [...postIds, ...commentIds] } }] } });
  await prisma.reputationEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.feedReaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.feedPost.updateMany({ where: { bestCommentId: { in: commentIds } }, data: { bestCommentId: null } });
  await prisma.feedComment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.feedPost.deleteMany({ where: { id: { in: postIds } } });
  await prisma.communityProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.groupBuyMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.groupBuy.deleteMany({ where: { initiatorId: { in: ids } } });
  await prisma.dealerRewardClaim.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dealerCreditLedger.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dealerOrderTemplate.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dealerApplication.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dealerPriceHistory.deleteMany({ where: { changedBy: { in: ids } } });
  await prisma.product.deleteMany({ where: { storefrontId: { in: storeIds }, pancakeId: { startsWith: 'audit-merchant-' } } });
  await prisma.storefront.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.attendanceSession.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.shift.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.payrollAdjustment.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.payrollDay.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.payrollMonth.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.staffProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.roleGrant.deleteMany({ where: { phone: { in: AUDIT_PHONES } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.referralTouch.deleteMany({ where: { OR: [{ userId: { in: ids } }, { referrerUserId: { in: ids } }] } });
  await prisma.flashSaleReminder.deleteMany({ where: { userId: { in: ids } } });
  await prisma.flashSalePurchase.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await prisma.brandFollow.deleteMany({ where: { userId: { in: ids } } });
  await prisma.brand.updateMany({ where: { ownerUserId: { in: ids } }, data: { ownerUserId: null } });
  // Personal coupons issued to audit users (scopeMeta.userId) — recreated below.
  const personal = await prisma.coupon.findMany({ where: { scope: 'USER_GROUP' }, select: { id: true, scopeMeta: true } });
  const mine = personal.filter((c: { scopeMeta: { userId?: string } | null }) => c.scopeMeta && ids.includes(c.scopeMeta.userId ?? ''));
  if (mine.length) {
    await prisma.couponRedemption.deleteMany({ where: { couponId: { in: mine.map((c: { id: string }) => c.id) } } });
    await prisma.coupon.deleteMany({ where: { id: { in: mine.map((c: { id: string }) => c.id) } } });
  }
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  if (process.argv.includes('--tokens-only')) {
    // Re-mint only: revoke every refresh token of the audit users and write a fresh personas.json.
    const users = await prisma.user.count({ where: { id: { in: Object.values(P).map((u) => u.id) } } });
    if (users !== Object.keys(P).length) throw new Error('Persona users missing — run the full seed first.');
    const revoked = await prisma.refreshToken.deleteMany({ where: { userId: { in: AUDIT_USER_IDS } } });
    const minted = await mintPersonas();
    console.log(JSON.stringify({ db: EXPECTED_DB, mode: 'tokens-only', revokedRefreshTokens: revoked.count, personas: minted.map((m) => ({ name: m.name, userId: m.userId, role: m.role })), file: path.relative(REPO, path.join(OUT_DIR, 'personas.json')) }, null, 2));
    return;
  }
  const vars = await prisma.variation.findMany({ include: { product: true } });
  if (vars.length < 40) throw new Error('Base catalog missing — run apps/api/prisma/seed.ts on the audit DB first.');
  VARS = new Map(vars.map((v: Var) => [v.sku, v]));
  const tpls = await prisma.notificationTemplate.findMany();
  TEMPLATES = new Map(tpls.map((t: { code: string; bodyTemplate: string }) => [t.code, t.bodyTemplate]));
  const cats = await prisma.communityCategory.findMany();
  const CAT = new Map<string, string>(cats.map((c: { slug: string; id: string }) => [c.slug, c.id]));

  // ── 0) wipe everything previously owned by audit users ──
  await cleanup();

  // ── 1) shared reference data (upserts) ──
  const cfg = async (key: string, value: unknown, category: string, description: string) =>
    prisma.systemConfig.upsert({ where: { key }, update: { value, updatedBy: 'audit-seed' }, create: { key, value, category, description, updatedBy: 'audit-seed' } });
  await cfg('loyalty.pos_credit_enabled', true, 'loyalty', 'Bật tích điểm tại quầy (POS) do nhân viên nhập');
  await cfg('beta.features', [
    { key: 'ai-advisor', title: 'Tư vấn AI 24/7', desc: 'Hỏi nhanh về thành phần, cách dùng, chọn sản phẩm hợp da.' },
    { key: 'garden-plots', title: 'Mở rộng vườn nhiều lô', desc: 'Trồng song song nhiều cây, thu hoạch nhanh hơn.' },
    { key: 'refill-station', title: 'Trạm đổi vỏ chai', desc: 'Đổi vỏ chai rỗng lấy giọt nước tưới cây.' },
  ], 'beta', 'Danh sách tính năng beta hiển thị cho người tham gia (mảng {key,title,desc})');
  await cfg('attendance.office_ips', ['127.0.0.1', '::1', '::ffff:127.0.0.1'], 'attendance', 'Danh sách IP/CIDR nội bộ được phép checkin (audit: localhost)');
  await cfg('attendance.office_lat', 10.8505, 'attendance', 'Vĩ độ văn phòng (audit: Golf Park, Thủ Đức)');
  await cfg('attendance.office_lng', 106.7717, 'attendance', 'Kinh độ văn phòng (audit: Golf Park, Thủ Đức)');
  await cfg('app.miniapp_base_url', 'http://localhost:3213', 'app', 'URL gốc Mini App dùng dựng link chia sẻ (audit: localhost)');

  // Commission rates per brand + one affiliate-blocked product + a sold-out variation (backorder).
  for (const [brand, rate] of Object.entries(RATES)) {
    await prisma.variation.updateMany({ where: { product: { brand } }, data: { affiliateRate: new Prisma.Decimal(rate) } });
  }
  await prisma.product.update({ where: { id: BLOCKED_PRODUCT }, data: { affiliateBlocked: true } });
  await prisma.variation.update({ where: { sku: 'FUWA-DW-5L' }, data: { stock: 0 } });
  await prisma.variation.update({ where: { sku: 'VIS-EYE-15' }, data: { stock: 4 } });
  const SOLD_EXTERNAL: Record<string, number> = {
    'p-fuwa-dishwash': 1840, 'p-fuwa-laundry': 1325, 'p-visante-serum': 962, 'p-polang-shampoo': 1510,
    'p-cobote-tram': 2280, 'p-leplateau-arabica': 684, 'p-bhnong-honey': 540, 'p-sokfram-rice': 890,
  };
  for (const [id, sold] of Object.entries(SOLD_EXTERNAL)) await prisma.product.update({ where: { id }, data: { soldExternal: sold } });
  await prisma.variation.update({ where: { sku: 'FUWA-LD-2L' }, data: { dealerPrices: { DEALER_2: 138000, DEALER_3: 125000 } } });
  VARS = new Map((await prisma.variation.findMany({ include: { product: true } })).map((v: Var) => [v.sku, v]));

  // Brands (id = md5(name), like migration 20260626020000_brand_backfill) + link products.
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const BRANDS = [
    { name: 'Fuwa3e', slug: 'fuwa3e', verified: true, published: true, owner: P.brand_owner.id, tagline: 'Tẩy rửa sinh học lên men từ enzyme dứa', origin: 'Thủ Đức, TP.HCM', story: 'Fuwa3e bắt đầu từ một căn bếp nhỏ ở Thủ Đức: ủ vỏ dứa với đường mía thành enzyme, thay dần các chất tẩy rửa hoá học trong nhà. Mỗi chai Fuwa3e phân huỷ sinh học hoàn toàn, an toàn cho da tay và cho cả những con kênh sau nhà.', certs: [{ code: 'ECO', label: 'Sản phẩm thân thiện môi trường', verified: true }, { code: 'SGS', label: 'Kiểm nghiệm SGS an toàn da tay', verified: true }, { code: 'ISO', label: 'ISO 22716 (đang thẩm định)', verified: false }], followers: 1284 },
    { name: 'Visante', slug: 'visante', verified: true, published: true, tagline: 'Mỹ phẩm thiên nhiên từ rau má Việt', origin: 'Đà Lạt, Lâm Đồng', story: 'Visante trồng rau má hữu cơ tại Đà Lạt và chiết xuất lạnh để giữ trọn hoạt chất.', certs: [{ code: 'USDA', label: 'USDA Organic', verified: true }, { code: 'VEGAN', label: 'Vegan', verified: true }], followers: 2311 },
    { name: 'Pơ Lang', slug: 'po-lang', verified: true, published: true, tagline: 'Dược liệu Tây Nguyên', origin: 'Buôn Ma Thuột, Đắk Lắk', story: 'Pơ Lang hợp tác với các buôn làng Ê Đê thu hái bưởi, bồ kết và hương nhu theo mùa.', certs: [{ code: 'VEGAN', label: 'Vegan', verified: true }], followers: 1760 },
    { name: 'Cobote', slug: 'cobote', verified: true, published: true, tagline: 'Chăm sóc bé bằng thảo dược', origin: 'Huế', story: 'Cobote chưng cất tinh dầu tràm Huế theo phương pháp truyền thống.', certs: [{ code: 'PURE', label: 'Nguyên chất 100%', verified: true }], followers: 980 },
    { name: 'Le Plateau Coffee', slug: 'le-plateau-coffee', verified: true, published: true, tagline: 'Cà phê đặc sản Cầu Đất', origin: 'Cầu Đất, Đà Lạt', story: 'Cà phê Arabica trồng ở độ cao 1.650m, rang mộc theo từng mẻ nhỏ.', certs: [{ code: 'RA', label: 'Rainforest Alliance', verified: true }], followers: 655 },
    { name: 'BH.Nong', slug: 'bh-nong', verified: false, published: true, tagline: 'Nông sản sạch từ nông hộ', origin: 'Bình Phước', story: 'Kết nối nông hộ trồng điều, tiêu, mật ong rừng với người tiêu dùng thành thị.', certs: [{ code: 'OCOP', label: 'OCOP 4 sao', verified: false }], followers: 212 },
    { name: 'Sokfram', slug: 'sokfram', verified: false, published: true, tagline: 'Thực phẩm hữu cơ cho bữa cơm nhà', origin: 'Long An', story: 'Gạo lứt, dầu dừa, hạt dinh dưỡng từ vùng nguyên liệu hữu cơ.', certs: [], followers: 148 },
    { name: 'Hector', slug: 'hector', verified: false, published: false, tagline: 'Chăm sóc cá nhân cho nam', origin: 'TP.HCM', story: null, certs: [], followers: 0 },
  ];
  for (const b of BRANDS) {
    const data = {
      slug: b.slug, name: b.name, tagline: b.tagline, story: b.story, origin: b.origin,
      certifications: b.certs, isVerified: b.verified, isPublished: b.published, ownerUserId: b.owner ?? null,
      followerCount: b.followers, logoUrl: null, coverUrl: null, storyImages: [],
    };
    await prisma.brand.upsert({ where: { id: md5(b.name) }, update: data, create: { id: md5(b.name), ...data } });
    await prisma.product.updateMany({ where: { brand: b.name }, data: { brandId: md5(b.name) } });
  }
  const FUWA_BRAND = md5('Fuwa3e');
  const VIS_BRAND = md5('Visante');
  const promo = async (key: string, brandId: string, data: Record<string, unknown>) =>
    prisma.brandPromotion.upsert({ where: { id: cid(`promo:${key}`) }, update: data, create: { id: cid(`promo:${key}`), brandId, ...data } });
  await promo('fuwa-week', FUWA_BRAND, { title: 'Tuần lễ Sạch Xanh Fuwa3e', subtitle: 'Giảm 15% toàn bộ nước giặt, nước rửa chén enzyme', themeColor: '#E8B72C', couponCode: 'FUWA15', startAt: at(3, 0), endAt: at(-10, 23, 59), isActive: true, sortOrder: 0 });
  await promo('fuwa-refill', FUWA_BRAND, { title: 'Đổi vỏ can 5L — tặng 50 giọt nước', subtitle: 'Áp dụng tại trạm đổi vỏ chai', themeColor: '#509018', couponCode: null, startAt: at(-5, 0), endAt: at(-35, 23, 59), isActive: true, sortOrder: 1 });
  await promo('fuwa-summer', FUWA_BRAND, { title: 'Hè sạch khuẩn', subtitle: 'Đã kết thúc', themeColor: '#7CC0DB', couponCode: null, startAt: at(90, 0), endAt: at(40, 23, 59), isActive: false, sortOrder: 2 });
  await promo('visante-autumn', VIS_BRAND, { title: 'Visante — Dưỡng ẩm mùa thu', subtitle: 'Tặng mặt nạ rau má cho đơn từ 300k', themeColor: '#8B3A3A', couponCode: null, startAt: at(2, 0), endAt: at(-14, 23, 59), isActive: true, sortOrder: 0 });

  const coupon = async (code: string, data: Record<string, unknown>) =>
    prisma.coupon.upsert({ where: { code }, update: data, create: { code, ...data } });
  await coupon('FUWA15', { type: 'PERCENT', value: 15, minOrder: 250000, maxDiscount: 60000, startAt: at(3, 0), endAt: at(-10, 23, 59), perUserLimit: 1, usageLimit: 500, scope: 'PUBLIC', applyTo: { brand: 'Fuwa3e' } });
  await coupon('HANGXANH50', { type: 'AMOUNT', value: 50000, minOrder: 499000, startAt: at(20, 0), endAt: at(-20, 23, 59), perUserLimit: 1, usageLimit: 300, scope: 'TIER', scopeMeta: { tierId: 'LOC_BIEC' } });

  // Current season (base seed's summer season is over) — season pass needs an active one.
  const p0 = vnParts(NOW);
  const qs = vnQuarter(NOW);
  await prisma.season.upsert({
    where: { id: 'se-audit-current' },
    update: { startAt: qs.start, endAt: new Date(qs.end.getTime() + 60 * DAY - 1000) },
    create: { id: 'se-audit-current', name: 'Mùa Thu Xanh — Rừng thông Tây Nguyên', theme: 'Rừng thông & rừng đầu nguồn', region: 'Lâm Đồng', featuredSpeciesIds: ['sp-thong', 'sp-po-mu', 'sp-bach-xanh'], startAt: qs.start, endAt: new Date(qs.end.getTime() + 60 * DAY - 1000) },
  });
  await prisma.communityGoal.update({ where: { id: 'cg-cangio-2026' }, data: { currentDrops: 48250 } });

  // Dealer rewards (global + brand).
  const reward = async (key: string, data: Record<string, unknown>) =>
    prisma.dealerReward.upsert({ where: { id: cid(`reward:${key}`) }, update: data, create: { id: cid(`reward:${key}`), ...data } });
  const R1 = await reward('q-gift-30m', { brandId: null, type: 'GIFT', title: 'Bộ quà tri ân quý (máy lọc nước mini)', description: 'Đạt 30 triệu doanh số đã chốt trong quý', threshold: 30_000_000, period: 'QUARTER', isActive: true, sortOrder: 0 });
  const R2 = await reward('q-shelf-60m', { brandId: null, type: 'OTHER', title: 'Kệ trưng bày Tubu Tree + 2 triệu hỗ trợ POSM', description: 'Đạt 60 triệu doanh số đã chốt trong quý, có mặt bằng trưng bày', threshold: 60_000_000, period: 'QUARTER', isActive: true, sortOrder: 1 });
  const R3 = await reward('y-tour-200m', { brandId: null, type: 'TOUR', title: 'Tour Đà Lạt 3N2Đ cho 2 người', description: 'Đạt 200 triệu doanh số đã chốt trong năm', threshold: 200_000_000, period: 'YEAR', isActive: true, sortOrder: 2 });
  const R4 = await reward('q-fuwa-20m', { brandId: FUWA_BRAND, type: 'GIFT', title: 'Combo hàng Fuwa3e trị giá 5 triệu', description: 'Đạt 20 triệu doanh số đã chốt trong quý', threshold: 20_000_000, period: 'QUARTER', isActive: true, sortOrder: 3 });

  // Flash sales: one live now, one upcoming (remind-me).
  await prisma.flashSale.upsert({ where: { id: cid('flash:live') }, update: { startAt: hoursAgo(1), endAt: plus(NOW, 72 * HOUR), isActive: true }, create: { id: cid('flash:live'), title: 'Giờ vàng Sống Xanh', startAt: hoursAgo(1), endAt: plus(NOW, 72 * HOUR), isActive: true, createdBy: P.admin.id } });
  await prisma.flashSale.upsert({ where: { id: cid('flash:next') }, update: { startAt: plus(NOW, 20 * HOUR), endAt: plus(NOW, 44 * HOUR), isActive: true }, create: { id: cid('flash:next'), title: 'Săn deal đầu tuần', startAt: plus(NOW, 20 * HOUR), endAt: plus(NOW, 44 * HOUR), isActive: true, createdBy: P.admin.id } });
  const flashItem = async (sale: string, sku: string, flashPrice: number, quota: number, soldCount: number) =>
    prisma.flashSaleItem.upsert({
      where: { flashSaleId_variationId: { flashSaleId: cid(`flash:${sale}`), variationId: V(sku).id } },
      update: { flashPrice, quota, soldCount, perUserLimit: 3 },
      create: { flashSaleId: cid(`flash:${sale}`), variationId: V(sku).id, flashPrice, quota, soldCount, perUserLimit: 3 },
    });
  await flashItem('live', 'FUWA-LD-2L', 159000, 80, 47);
  await flashItem('live', 'VIS-SR-30', 219000, 40, 31);
  await flashItem('live', 'LP-ARA-250', 139000, 60, 12);
  const nextFlash = await flashItem('next', 'COBOTE-TR-50', 65000, 100, 0);
  await flashItem('next', 'BHN-HN-500', 199000, 30, 0);

  // Academy.
  const course = async (key: string, data: Record<string, unknown>, lessons: { title: string; type: 'ARTICLE' | 'VIDEO'; body?: string; videoUrl?: string }[]) => {
    const id = cid(`course:${key}`);
    await prisma.course.upsert({ where: { id }, update: data, create: { id, ...data } });
    const ids: string[] = [];
    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i]!;
      const lid = cid(`lesson:${key}:${i}`);
      const ld = { courseId: id, title: l.title, contentType: l.type, body: l.body ?? null, videoUrl: l.videoUrl ?? null, sortOrder: i };
      await prisma.lesson.upsert({ where: { id: lid }, update: ld, create: { id: lid, ...ld } });
      ids.push(lid);
    }
    return { id, lessons: ids };
  };
  const C1 = await course('ctv-101', { title: 'Khởi nghiệp CTV cùng Tubu Tree', description: 'Từ con số 0 tới những đơn hàng đầu tiên: dựng gian hàng, chọn sản phẩm, chia sẻ đúng cách.', sortOrder: 0, isPublished: true }, [
    { title: 'CTV Tubu Tree kiếm tiền thế nào?', type: 'ARTICLE', body: 'Bạn nhận hoa hồng 8–15% trên giá trị hàng của mỗi đơn khách mua qua gian hàng hoặc link giới thiệu của bạn. Hoa hồng được chốt sau khi đơn giao thành công và hết thời gian đổi/trả.' },
    { title: 'Dựng gian hàng trong 10 phút', type: 'ARTICLE', body: 'Đặt tên gian hàng gần gũi, viết lời chào ngắn, thêm 5–8 sản phẩm bạn thật sự dùng. Ghim sản phẩm bán chạy lên đầu và tạo combo để tăng giá trị đơn.' },
    { title: 'Viết bài chia sẻ không "bán hàng"', type: 'ARTICLE', body: 'Kể trải nghiệm thật, chụp ảnh tự nhiên, trả lời câu hỏi thay vì quảng cáo. Dùng Content Kit để có sẵn bài mẫu và USP.' },
    { title: 'Livestream bán hàng cơ bản', type: 'VIDEO', videoUrl: 'https://www.youtube.com/watch?v=tubu-audit-demo' },
  ]);
  const C2 = await course('san-pham-xanh', { title: 'Hiểu sản phẩm xanh để tư vấn đúng', description: 'Thành phần, chứng nhận và cách đọc nhãn — trả lời tự tin mọi câu hỏi của khách.', sortOrder: 1, isPublished: true }, [
    { title: 'Enzyme sinh học khác gì chất tẩy thường?', type: 'ARTICLE', body: 'Enzyme lên men phân giải dầu mỡ ở nhiệt độ thường, phân huỷ sinh học nhanh, dịu nhẹ với da tay.' },
    { title: 'Đọc hiểu chứng nhận USDA Organic, Vegan, OCOP', type: 'ARTICLE', body: 'Mỗi chứng nhận nói lên một điều khác nhau — đừng dùng lẫn lộn khi tư vấn.' },
    { title: 'Tư vấn cho mẹ bầu và em bé', type: 'ARTICLE', body: 'Ưu tiên sản phẩm không hương liệu tổng hợp, pH dịu nhẹ và có kiểm nghiệm da liễu.' },
  ]);
  await course('draft-kpi', { title: 'Quản lý đội nhóm CTV (bản nháp)', description: 'Khoá học đang biên soạn.', sortOrder: 2, isPublished: false }, [
    { title: 'Đặt mục tiêu tháng cho nhóm', type: 'ARTICLE', body: 'Đang cập nhật.' },
  ]);

  // FAQ + CSKH quick replies.
  const FAQ = [
    ['Vận chuyển', 'Bao lâu thì tôi nhận được hàng?', 'Nội thành TP.HCM và Hà Nội 1–2 ngày, tỉnh thành khác 2–4 ngày làm việc. Bạn theo dõi hành trình ngay trong mục Đơn hàng.'],
    ['Vận chuyển', 'Đơn bao nhiêu thì được miễn phí vận chuyển?', 'Đơn từ 200.000đ được miễn phí vận chuyển. Thành viên Lộc Biếc được miễn phí từ 99.000đ.'],
    ['Đổi trả', 'Tôi được đổi/trả hàng trong bao lâu?', 'Trong 7 ngày kể từ khi nhận hàng, với sản phẩm lỗi do nhà sản xuất. Tiền hoàn vào Ví Tubu.'],
    ['Thanh toán', 'Tubu Tree hỗ trợ những hình thức thanh toán nào?', 'COD, ZaloPay, chuyển khoản ngân hàng (VietQR), Ví Tubu và TubuXu.'],
    ['Điểm Xanh', 'Điểm Xanh dùng để làm gì?', 'Đổi voucher, trừ tối đa 20% giá trị đơn và xét hạng thành viên. Điểm có hạn 12 tháng.'],
    ['Sản phẩm', 'Sản phẩm có an toàn cho bé không?', 'Các sản phẩm nhóm "Cho bé" đều có kiểm nghiệm da liễu, không hương liệu tổng hợp.'],
    ['CTV', 'Làm sao để trở thành CTV?', 'Vào Cá nhân → Kiếm thưởng → Đăng ký CTV. Bạn có gian hàng riêng và nhận hoa hồng ngay đơn đầu tiên.'],
    ['Tái chế', 'Gửi lại vỏ chai như thế nào?', 'Chọn "Gửi lại vật liệu tái chế" khi thanh toán, bưu tá sẽ thu vỏ chai sạch khi giao hàng.'],
  ];
  for (let i = 0; i < FAQ.length; i++) {
    const [category, question, answer] = FAQ[i]!;
    const id = cid(`faq:${i}`);
    await prisma.faqEntry.upsert({ where: { id }, update: { category, question, answer, isActive: true, sortOrder: i }, create: { id, category, question, answer, isActive: true, sortOrder: i } });
  }
  const QR = [
    { title: 'Lời chào tự động', category: 'Chung', keywords: ['xin chào', 'hello', 'alo'], content: 'Tubu Tree xin chào bạn 🌿 Bạn cần tư vấn sản phẩm, kiểm tra đơn hay đổi trả ạ?', isGreeting: true },
    { title: 'Tra đơn hàng', category: 'Vận chuyển', keywords: ['đơn hàng', 'kiểm tra đơn', 'giao chưa'], content: 'Bạn gửi giúp Tubu mã đơn (bắt đầu bằng TUBU) để mình kiểm tra ngay nhé!', isGreeting: false },
    { title: 'Chính sách đổi trả', category: 'Đổi trả', keywords: ['đổi trả', 'hoàn tiền', 'lỗi'], content: 'Tubu hỗ trợ đổi/trả trong 7 ngày với lỗi nhà sản xuất. Bạn chụp giúp ảnh sản phẩm và mã đơn nhé.', isGreeting: false },
    { title: 'Thanh toán chuyển khoản', category: 'Thanh toán', keywords: ['chuyển khoản', 'stk', 'số tài khoản'], content: 'Bạn quét mã VietQR trong trang thanh toán để chuyển đúng số tiền và nội dung, đơn sẽ tự xác nhận.', isGreeting: false },
    { title: 'Đăng ký CTV', category: 'CTV', keywords: ['ctv', 'cộng tác viên', 'hoa hồng'], content: 'Bạn vào Cá nhân → Đăng ký CTV để mở gian hàng miễn phí và nhận hoa hồng 8–15% nhé 🌱', isGreeting: false },
  ];
  for (let i = 0; i < QR.length; i++) {
    const id = cid(`qr:${i}`);
    await prisma.quickReplyTemplate.upsert({ where: { id }, update: { ...QR[i], isActive: true, sortOrder: i }, create: { id, ...QR[i], isActive: true, sortOrder: i } });
  }

  // Content kits.
  const KITS: Record<string, { captions: string[]; usps: string[]; faqs: { q: string; a: string }[] }> = {
    'p-fuwa-laundry': {
      captions: ['Từ ngày chuyển sang nước giặt Fuwa3e, đồ của bé mềm hẳn mà không còn mùi hoá chất 🌿 Mình để link ở đây cho các mẹ nhé: {link} — {ten_ctv}', 'Giặt sạch, xả ít nước, không hại da tay. Nước giặt enzyme Fuwa3e — thử 1 can là mê! {link}'],
      usps: ['Enzyme dứa lên men, phân huỷ sinh học', 'Dịu nhẹ cho đồ sơ sinh', 'Ít bọt, xả nhanh tiết kiệm nước'],
      faqs: [{ q: 'Dùng cho máy giặt cửa trước được không?', a: 'Được, ít bọt nên phù hợp cả máy cửa trước.' }],
    },
    'p-visante-serum': {
      captions: ['Da mình nhạy cảm nhưng dùng serum rau má Visante 2 tuần đã dịu hẳn 💚 {link}'],
      usps: ['Chiết xuất rau má 5%', 'Hyaluronic Acid 2% cấp ẩm sâu', 'USDA Organic, Vegan'],
      faqs: [{ q: 'Da dầu mụn dùng được không?', a: 'Được, kết cấu mỏng nhẹ, không gây bít tắc.' }],
    },
    'p-cobote-tram': {
      captions: ['Mùa mưa là tủ thuốc nhà mình không thể thiếu dầu tràm Cobote cho bé 🌧️ {link}'],
      usps: ['Tràm Huế nguyên chất 100%', 'Giữ ấm, phòng cảm lạnh', 'Chai 50ml tiện mang theo'],
      faqs: [],
    },
  };
  for (const [productId, k] of Object.entries(KITS)) {
    await prisma.productContentKit.upsert({ where: { productId }, update: { ...k, videoUrls: [] }, create: { productId, ...k, videoUrls: [] } });
  }

  // Community event (open) + tags.
  await prisma.communityEvent.upsert({
    where: { id: cid('event:open') },
    update: { startAt: at(5, 0), endAt: at(-9, 23, 59), status: 'OPEN' },
    create: { id: cid('event:open'), title: 'Khoe góc xanh mùa thu', description: 'Chụp góc cây xanh, ban công hoặc góc bếp "không nhựa" của bạn. 3 bài được yêu thích nhất nhận 50.000 TubuXu.', startAt: at(5, 0), endAt: at(-9, 23, 59), rewardXu: 50000, status: 'OPEN' },
  });
  await prisma.communityEvent.upsert({
    where: { id: cid('event:closed') },
    update: { status: 'CLOSED', winnerUserId: P.active_customer.id },
    create: { id: cid('event:closed'), title: 'Thử thách 7 ngày không túi ni-lông', description: 'Chia sẻ hành trình giảm rác nhựa của bạn.', startAt: at(45, 0), endAt: at(30, 23, 59), rewardXu: 30000, status: 'CLOSED', winnerUserId: P.active_customer.id },
  });
  const tag = async (slug: string, name: string) => prisma.tag.upsert({ where: { slug }, update: { name }, create: { slug, name } });
  const TAG = {
    meVaBe: await tag('me-va-be', 'mẹ và bé'),
    fuwa: await tag('fuwa3e', 'Fuwa3e'),
    banCong: await tag('ban-cong-xanh', 'ban công xanh'),
    meo: await tag('meo-tiet-kiem', 'mẹo tiết kiệm'),
  };

  // Shift templates.
  const tplShift = async (key: string, name: string, startMin: number, endMin: number, sortOrder: number) =>
    prisma.shiftTemplate.upsert({ where: { id: cid(`shift-tpl:${key}`) }, update: { name, startMin, endMin, active: true, sortOrder }, create: { id: cid(`shift-tpl:${key}`), name, startMin, endMin, active: true, sortOrder } });
  const TPL_MORNING = await tplShift('morning', 'Ca sáng', 480, 720, 0);
  const TPL_AFTERNOON = await tplShift('afternoon', 'Ca chiều', 780, 1020, 1);
  await tplShift('evening', 'Ca tối', 1080, 1320, 2);

  // ── 2) users ──
  for (const u of ALL_USERS) {
    const meta: Record<string, unknown> = { ...(u.extraMeta ?? {}) };
    if (u.segments) {
      meta.segments = u.segments;
      meta.onboardedAt = plus(at(u.createdDaysAgo, 9), 10 * MIN).toISOString();
    }
    const base = {
      zaloId: u.zaloId, phone: u.phone, email: u.email ?? null, fullName: u.fullName, dob: u.dob ?? null,
      avatarUrl: null, role: u.role, referralCode: u.referralCode, isBlocked: false, metadata: meta,
      tierId: null, tierGraceUntil: null, referredById: null, pointsBalance: 0, walletBalance: 0, coinsBalance: 0, cashbackPending: 0,
    };
    const createdAt = u.createdDaysAgo === 0 ? minsAgo(40) : at(u.createdDaysAgo, 9);
    await prisma.user.upsert({ where: { id: u.id }, update: base, create: { id: u.id, ...base, createdAt } });
  }
  await prisma.user.upsert({
    where: { id: GUEST_USER.id },
    update: { zaloId: GUEST_USER.zaloId, fullName: 'Khách', metadata: { segments: [], onboardedAt: at(2, 20).toISOString() }, role: 'CUSTOMER' },
    create: { id: GUEST_USER.id, zaloId: GUEST_USER.zaloId, fullName: 'Khách', referralCode: GUEST_USER.referralCode, metadata: { segments: [], onboardedAt: at(2, 20).toISOString() }, createdAt: at(2, 20) },
  });
  const upd = (id: string, data: Record<string, unknown>) => prisma.user.update({ where: { id }, data });
  await upd(P.active_customer.id, { referredById: P.ctv.id, tierId: 'LOC_BIEC' });
  await upd(P.ctv.id, { tierId: 'MAM_XANH' });
  await upd(P.staff.id, { tierId: 'MAM_XANH' });
  await upd(BG.linh.id, { referredById: P.ctv.id, tierId: 'MAM_XANH' });
  await upd(BG.thinh.id, { referredById: P.ctv.id, tierId: 'MAM_XANH' });
  await upd(BG.ngoc.id, { referredById: P.ctv.id, tierId: 'MAM_XANH' });
  await upd(BG.huy.id, { referredById: P.active_customer.id, tierId: 'MAM_XANH' });

  // Role grants (RBAC by phone).
  await prisma.roleGrant.create({ data: { phone: P.admin.phone, role: 'ADMIN', grantedBy: 'seed', note: 'Quản trị viên vận hành', createdAt: at(400, 9) } });
  await prisma.roleGrant.create({ data: { phone: P.staff.phone, role: 'STAFF', grantedBy: P.admin.id, note: 'Nhân viên cửa hàng Thủ Đức', createdAt: at(180, 10) } });

  // Addresses.
  const mkAddr = async (userId: string, a: Addr) => prisma.address.create({ data: { ...a, userId } });
  await mkAddr(P.active_customer.id, ADDR.activeHome);
  await mkAddr(P.active_customer.id, ADDR.activeOffice);
  await mkAddr(P.ctv.id, ADDR.ctvHome);
  await mkAddr(P.brand_owner.id, ADDR.brandOwner);
  await mkAddr(BG.linh.id, ADDR.linh);
  await mkAddr(BG.thinh.id, ADDR.thinh);
  await mkAddr(BG.ngoc.id, ADDR.ngoc);
  await mkAddr(BG.huy.id, ADDR.huy);

  // ── 3) CTV storefront ──
  const CTV_SLUG = P.ctv.referralCode.toLowerCase();
  const sfId = cid('storefront:ctv');
  await prisma.storefront.create({
    data: {
      id: sfId, type: 'CTV', slug: CTV_SLUG, subdomain: 'goc-xanh-nha-mai', ownerUserId: P.ctv.id,
      title: 'Góc Xanh Nhà Mai', headerNote: 'Đồ xanh chính hãng — Mai dùng thật, tư vấn tận tâm, giao nhanh nội thành HCM 🌿',
      theme: 'leaf-orange', themeColor: '#16a34a', bankName: 'Vietcombank', bankBin: '970436', bankAccountNo: '0071000123456', bankAccountName: 'LE HOANG MAI',
      warehouseAddress: '45/2 Nguyễn Văn Đậu', warehouseCity: 'Thành phố Hồ Chí Minh', warehouseWard: 'Phường Bình Lợi Trung', warehousePhone: '0900000003',
      isPublished: true, publishedAt: at(150, 20), createdAt: at(155, 20), lastReminderAt: at(6, 9),
    },
  });
  const collection = async (key: string, data: Record<string, unknown>, products: { id: string; note?: string; pinned?: boolean }[]) => {
    const colId = cid(`sfcol:${key}`);
    await prisma.storefrontCollection.create({ data: { id: colId, storefrontId: sfId, ...data } });
    for (let i = 0; i < products.length; i++) {
      await prisma.storefrontItem.create({ data: { collectionId: colId, productId: products[i]!.id, note: products[i]!.note ?? null, isPinned: products[i]!.pinned ?? false, sortOrder: i } });
    }
  };
  await collection('bestseller', { title: 'Mai dùng hằng ngày', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0 }, [
    { id: 'p-visante-serum', note: 'Da nhạy cảm của Mai hợp nhất em này', pinned: true },
    { id: 'p-fuwa-laundry', note: 'Giặt đồ bé siêu an tâm' },
    { id: 'p-polang-shampoo' },
    { id: 'p-leplateau-arabica', note: 'Cà phê sáng của cả nhà' },
    { id: 'p-bhnong-honey' },
  ]);
  await collection('mom-baby', { title: 'Chăm sóc mẹ & bé', kind: 'NORMAL', layout: 'GRID', sortOrder: 1 }, [
    { id: 'p-cobote-tram' }, { id: 'p-cobote-wash' }, { id: 'p-fuwa-bottle' }, { id: 'p-visante-cream' },
  ]);
  await collection('combo-clean', { title: 'Combo nhà sạch -10%', kind: 'COMBO', layout: 'STACK', sortOrder: 2, comboDiscountPct: 10 }, [
    { id: 'p-fuwa-dishwash' }, { id: 'p-fuwa-floor' }, { id: 'p-fuwa-handwash' },
  ]);

  // Dealer merchant storefront + one partner product waiting for approval.
  const DEALER_SLUG = P.dealer.referralCode.toLowerCase();
  const dealerSf = cid('storefront:dealer');
  await prisma.storefront.create({
    data: {
      id: dealerSf, type: 'MERCHANT', slug: DEALER_SLUG, subdomain: 'duc-phat', ownerUserId: P.dealer.id, title: 'Tạp hoá Xanh Đức Phát',
      headerNote: 'Đại lý Tubu Tree khu vực Bình Thạnh — nhận giao sỉ lẻ', themeColor: '#16a34a', isPublished: true, publishedAt: at(70, 10), createdAt: at(70, 10),
      warehouseAddress: '120 Bạch Đằng', warehouseCity: 'Thành phố Hồ Chí Minh', warehouseWard: 'Phường Gia Định', warehousePhone: '0900000004',
      collections: { create: { title: 'Sản phẩm nổi bật', sortOrder: 0 } },
    },
  });
  const merchantProductId = cid('product:merchant-pending');
  await prisma.product.create({
    data: {
      id: merchantProductId, pancakeId: `audit-merchant-${merchantProductId}`, brand: 'Đức Phát', slug: 'nuoc-rua-rau-cu-duc-phat',
      name: 'Nước rửa rau củ sinh học Đức Phát 500ml', description: 'Chiết xuất vỏ bưởi, rửa sạch thuốc trừ sâu tồn dư. Sản phẩm do đại lý Đức Phát đóng chai.',
      shortDesc: 'Rửa sạch rau củ, không tồn dư hoá chất.', images: [], categoryIds: ['cat-cleaning'], tags: ['đức phát'], basePrice: 65000,
      storefrontId: dealerSf, approvalStatus: 'PENDING_REVIEW', isActive: true, createdAt: at(2, 15),
      variations: { create: { pancakeId: `audit-merchant-${merchantProductId}-v1`, sku: 'DUCPHAT-RRC-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 65000, stock: 120, weight: 540 } },
    },
  });

  // ── 4) orders ──
  const A = P.active_customer.id;
  const CTV = P.ctv.id;
  const ADMIN = P.admin.id;
  const vnd = (n: number) => n.toLocaleString('vi-VN');

  // active_customer — every status.
  const o1c = at(74, 20, 15);
  const o1 = await createOrder({ key: 'active:o1', userId: A, createdAt: o1c, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'VIS-SR-30', qty: 2 }, { sku: 'POLANG-SP-500', qty: 1 }, { sku: 'FUWA-LD-2L', qty: 2 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.activeHome), deliveredAt: plus(o1c, 70 * HOUR), pancakeOrderId: '31045', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLK8T2P1', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLK8T2P1', history: ghnHistory('GHNLK8T2P1', o1c, 'DELIVERED') }, history: trail(o1c, 'DELIVERED', {}) });
  const o2c = at(46, 12, 5);
  const o2 = await createOrder({ key: 'active:o2', userId: A, createdAt: o2c, status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', items: [{ sku: 'LP-ARA-250', qty: 2 }, { sku: 'BHN-HN-500', qty: 1 }, { sku: 'SOK-GR-400', qty: 2 }], discount: 50000, couponCode: `REFERRED-${A}`.toUpperCase(), address: snap(ADDR.activeHome), deliveredAt: plus(o2c, 52 * HOUR), pancakeOrderId: '33219', shipping: { partner: 'Giao Hàng Tiết Kiệm', code: 'S21547.SG01.B7.8812', status: 'Đã giao hàng', link: 'https://i.ghtk.vn/S21547.SG01.B7.8812', history: [{ at: plus(o2c, 20 * HOUR), status: 'Đã lấy hàng', carrier: 'Giao Hàng Tiết Kiệm', code: 'S21547.SG01.B7.8812' }, { at: plus(o2c, 52 * HOUR), status: 'Đã giao hàng', carrier: 'Giao Hàng Tiết Kiệm', code: 'S21547.SG01.B7.8812' }] }, history: trail(o2c, 'DELIVERED', { paidOnline: true, deliveredAt: plus(o2c, 52 * HOUR) }) });
  const o3c = at(28, 9, 30);
  const o3 = await createOrder({ key: 'active:o3', userId: A, createdAt: o3c, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', items: [{ sku: 'COBOTE-TR-50', qty: 3 }, { sku: 'COBOTE-WS-250', qty: 2 }, { sku: 'FUWA-BT-500', qty: 2 }, { sku: 'VIS-CR-100', qty: 1 }, { sku: 'FUWA-LD-2L', qty: 2 }], pointsUsed: 40, referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.activeHome), deliveredAt: plus(o3c, 60 * HOUR), pancakeOrderId: '35870', invoiceRequest: { companyName: 'Công ty TNHH Thu Hà Decor', taxCode: '0316789123', address: 'Tầng 5, 81 Cách Mạng Tháng Tám, Phường Bến Thành, TP.HCM', email: 'ketoan.thuha@example.com' }, shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLP3Q7Z9', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLP3Q7Z9', history: ghnHistory('GHNLP3Q7Z9', o3c, 'DELIVERED') }, history: trail(o3c, 'DELIVERED', { paidOnline: true, stepsH: [1.5, 20, 30, 60] }) });
  const o4c = at(8, 19, 40);
  const o4 = await createOrder({ key: 'active:o4', userId: A, createdAt: o4c, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'VIS-VITC-20', qty: 1 }, { sku: 'VIS-CL-300', qty: 2 }, { sku: 'POLANG-FM-150', qty: 1 }], discount: 30000, couponCode: 'WELCOME30', referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.activeOffice), deliveredAt: at(5, 15, 20), pancakeOrderId: '38102', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLV5M2K8', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLV5M2K8', history: ghnHistory('GHNLV5M2K8', o4c, 'DELIVERED') }, history: trail(o4c, 'DELIVERED', { deliveredAt: at(5, 15, 20) }) });
  const o5c = at(6, 8, 10);
  const o5 = await createOrder({ key: 'active:o5', userId: A, createdAt: o5c, status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', items: [{ sku: 'POLANG-SP-300', qty: 2 }, { sku: 'POLANG-BW-500', qty: 2 }, { sku: 'POLANG-HO-50', qty: 1 }, { sku: 'LP-DRIP-10', qty: 1 }], address: snap(ADDR.activeHome), deliveredAt: at(3, 11, 5), pancakeOrderId: '38544', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLW8R4D2', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLW8R4D2', history: ghnHistory('GHNLW8R4D2', o5c, 'DELIVERED') }, history: trail(o5c, 'DELIVERED', { paidOnline: true, deliveredAt: at(3, 11, 5) }) });
  const o6c = at(24, 21, 0);
  const o6 = await createOrder({ key: 'active:o6', userId: A, createdAt: o6c, status: 'RETURNED', paymentMethod: 'ZALOPAY', paymentStatus: 'REFUNDED', items: [{ sku: 'HEC-FW-120', qty: 2 }, { sku: 'HEC-CL-80', qty: 1 }], address: snap(ADDR.activeHome), deliveredAt: at(22, 10, 0), pancakeOrderId: '36711', note: 'Mua tặng chồng', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLR2T6X4', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLR2T6X4', history: ghnHistory('GHNLR2T6X4', o6c, 'DELIVERED') }, history: trail(o6c, 'RETURNED', { paidOnline: true, deliveredAt: at(22, 10, 0), returnedAt: at(17, 16, 30), adminId: ADMIN }) });
  const o7c = at(12, 14, 20);
  const o7 = await createOrder({ key: 'active:o7', userId: A, createdAt: o7c, status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'SOK-CO-500', qty: 2 }, { sku: 'SOK-CH-500', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.activeHome), note: 'Đặt nhầm địa chỉ', history: trail(o7c, 'CANCELLED', { cancelAt: plus(o7c, 40 * MIN), userId: A }) });
  const o8c = hoursAgo(50);
  const o8 = await createOrder({ key: 'active:o8', userId: A, createdAt: o8c, status: 'SHIPPING', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', tierMult: 1.2, freeshipFrom: 99000, items: [{ sku: 'FUWA-DW-1L', qty: 3 }, { sku: 'FUWA-FL-2L', qty: 2 }, { sku: 'FUWA-HW-500', qty: 2 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.activeHome), pancakeOrderId: '39027', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLZ9W3C5', status: 'Đang giao hàng', link: 'https://donhang.ghn.vn/?order_code=GHNLZ9W3C5', history: ghnHistory('GHNLZ9W3C5', o8c, 'SHIPPING') }, history: trail(o8c, 'SHIPPING', { paidOnline: true, stepsH: [0.1, 18, 26, 0] }) });
  const o9c = hoursAgo(26);
  const o9 = await createOrder({ key: 'active:o9', userId: A, createdAt: o9c, status: 'PACKED', paymentMethod: 'WALLET', paymentStatus: 'PAID', tierMult: 1.2, freeshipFrom: 99000, items: [{ sku: 'LP-ROB-250', qty: 1 }, { sku: 'LP-CB-5', qty: 1 }], address: snap(ADDR.activeOffice), pancakeOrderId: '39240', history: trail(o9c, 'PACKED', { stepsH: [0, 20] }) });
  const o10c = minsAgo(95);
  const o10 = await createOrder({ key: 'active:o10', userId: A, createdAt: o10c, status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', tierMult: 1.2, freeshipFrom: 99000, items: [{ sku: 'BHN-CW-500', qty: 1 }, { sku: 'BHN-TEA-20', qty: 2 }], address: snap(ADDR.activeHome), note: 'Giao giờ hành chính giúp mình', history: trail(o10c, 'CONFIRMED', {}) });
  const o11c = minsAgo(25);
  const o11 = await createOrder({ key: 'active:o11', userId: A, createdAt: o11c, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', tierMult: 1.2, freeshipFrom: 99000, items: [{ sku: 'VIS-SR-50', qty: 1 }, { sku: 'VIS-EYE-15', qty: 1 }], address: snap(ADDR.activeHome), history: trail(o11c, 'PENDING_PAYMENT', { paidOnline: true }) });
  const o12c = hoursAgo(30);
  const o12 = await createOrder({ key: 'active:o12-recycling', userId: A, createdAt: o12c, status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', tierMult: 1.2, freeshipFrom: 99000, items: [{ sku: 'FUWA-DW-1L', qty: 2 }, { sku: 'FUWA-GL-500', qty: 2 }], address: snap(ADDR.activeHome), note: 'Có gửi lại vỏ chai', pancakeOrderId: '39198', recycling: { note: '3 chai nhựa 1L + 2 can 5L đã rửa sạch, để sẵn trong túi vải', gomdonOrderId: '48213', partnerCode: '8250927041832', status: '4', statusAt: hoursAgo(5) }, shipping: { partner: 'BestExpress', code: '8250927041832', status: 'Đang vận chuyển đến bưu cục nhận', history: [{ at: plus(o12c, 12 * MIN), status: 'Tạo đơn thành công', carrier: 'BestExpress', code: '8250927041832' }, { at: hoursAgo(20), status: 'Đã lấy hàng', carrier: 'BestExpress', code: '8250927041832' }, { at: hoursAgo(5), status: 'Đang vận chuyển đến bưu cục nhận', carrier: 'BestExpress', code: '8250927041832' }] }, history: [{ from: 'NEW', to: 'CONFIRMED', at: o12c, actor: 'CUSTOMER' }, { from: 'CONFIRMED', to: 'SHIPPING', at: hoursAgo(20), actor: 'SYSTEM', note: 'Gomdon: Đã lấy hàng' }] });
  const o14c = at(15, 21, 30);
  const o14 = await createOrder({ key: 'active:o14-xu', userId: A, createdAt: o14c, status: 'DELIVERED', paymentMethod: 'XU', paymentStatus: 'PAID', items: [{ sku: 'VIS-MASK-1', qty: 2 }], address: snap(ADDR.activeHome), deliveredAt: at(13, 10), pancakeOrderId: '37320', shipping: { partner: 'Giao Hàng Nhanh', code: 'GHNLT4H8B6', status: 'Giao hàng thành công', link: 'https://donhang.ghn.vn/?order_code=GHNLT4H8B6', history: ghnHistory('GHNLT4H8B6', o14c, 'DELIVERED') }, history: trail(o14c, 'DELIVERED', { deliveredAt: at(13, 10) }) });
  // Gomdon webhook trail for the recycling order.
  let evN = 0;
  for (const [st, when] of [[1, plus(o12c, 12 * MIN)], [3, hoursAgo(20)], [4, hoursAgo(5)]] as const) {
    await prisma.gomdonWebhookEvent.create({ data: { dedupeKey: `audit:48213:${st}:${when.toISOString()}`, gomdonOrderId: '48213', orderCode: o12.code, gomdonStatus: st, eventTime: when, rawPayload: { order_id: 48213, order_code: '8250927041832', order_customer_id: o12.code, status: st, created_time: when.toISOString() }, receivedAt: plus(when, 3000), processedAt: plus(when, 5000), status: 'PROCESSED', attempts: 1, orderId: o12.id } });
    evN++;
  }

  // Background customers (orders via the CTV storefront feed the CTV screens).
  const L = BG.linh.id;
  const linhA = await createOrder({ key: 'linh:a', userId: L, createdAt: plus(inPrevMonth(0.55), -24 * DAY), status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'VIS-SR-30', qty: 2 }, { sku: 'VIS-SUN-50', qty: 1 }, { sku: 'VIS-LIP-4', qty: 2 }, { sku: 'POLANG-SP-500', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.linh), deliveredAt: plus(inPrevMonth(0.55), -21 * DAY), pancakeOrderId: '34001', history: trail(plus(inPrevMonth(0.55), -24 * DAY), 'DELIVERED', { deliveredAt: plus(inPrevMonth(0.55), -21 * DAY) }) });
  const linhB = await createOrder({ key: 'linh:b', userId: L, createdAt: plus(inThisMonth(0.3), -24 * DAY), status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', items: [{ sku: 'VIS-CR-100', qty: 1 }, { sku: 'VIS-CL-300', qty: 2 }, { sku: 'VIS-MASK-1', qty: 10 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.linh), deliveredAt: plus(inThisMonth(0.3), -21 * DAY), pancakeOrderId: '36002', history: trail(plus(inThisMonth(0.3), -24 * DAY), 'DELIVERED', { paidOnline: true, deliveredAt: plus(inThisMonth(0.3), -21 * DAY) }) });
  const linhC = await createOrder({ key: 'linh:c', userId: L, createdAt: plus(inThisMonth(0.5), -24 * DAY), status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'FUWA-LD-2L', qty: 2 }, { sku: 'FUWA-BT-500', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.linh), deliveredAt: plus(inThisMonth(0.5), -21 * DAY), pancakeOrderId: '36377', history: trail(plus(inThisMonth(0.5), -24 * DAY), 'DELIVERED', { deliveredAt: plus(inThisMonth(0.5), -21 * DAY) }) });
  const T = BG.thinh.id;
  const thinhA = await createOrder({ key: 'thinh:a', userId: T, createdAt: plus(inThisMonth(0.6), -24 * DAY), status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', items: [{ sku: 'FUWA-DW-5L', qty: 1 }, { sku: 'FUWA-FL-2L', qty: 1 }, { sku: 'FUWA-HW-500', qty: 2 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.thinh), deliveredAt: plus(inThisMonth(0.6), -21 * DAY), pancakeOrderId: '36590', history: trail(plus(inThisMonth(0.6), -24 * DAY), 'DELIVERED', { paidOnline: true, deliveredAt: plus(inThisMonth(0.6), -21 * DAY) }) });
  const thinhAttention = await createOrder({ key: 'thinh:recycling-attention', userId: T, createdAt: hoursAgo(20), status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'FUWA-DW-1L', qty: 4 }, { sku: 'FUWA-LD-2L', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.thinh), note: 'Thu gom vỏ chai giúp em', recycling: { note: '5 chai 1L + 1 can 2L', status: 'NEEDS_MANUAL_CHECK', statusAt: hoursAgo(19) }, history: [{ from: 'NEW', to: 'CONFIRMED', at: hoursAgo(20), actor: 'CUSTOMER' }] });
  const N = BG.ngoc.id;
  const ngocA = await createOrder({ key: 'ngoc:a', userId: N, createdAt: plus(inPrevMonth(0.8), -24 * DAY), status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', items: [{ sku: 'COBOTE-TR-50', qty: 4 }, { sku: 'COBOTE-PW-100', qty: 2 }, { sku: 'COBOTE-DC-50', qty: 2 }, { sku: 'COBOTE-MS-100', qty: 2 }, { sku: 'VIS-CR-100', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.ngoc), deliveredAt: plus(inPrevMonth(0.8), -20 * DAY), pancakeOrderId: '34555', history: trail(plus(inPrevMonth(0.8), -24 * DAY), 'DELIVERED', { paidOnline: true, deliveredAt: plus(inPrevMonth(0.8), -20 * DAY) }) });
  const ngocB = await createOrder({ key: 'ngoc:b', userId: N, createdAt: plus(inThisMonth(0.75), -24 * DAY), status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'COBOTE-WS-250', qty: 3 }, { sku: 'FUWA-BT-500', qty: 2 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.ngoc), deliveredAt: plus(inThisMonth(0.75), -21 * DAY), pancakeOrderId: '36901', history: trail(plus(inThisMonth(0.75), -24 * DAY), 'DELIVERED', { deliveredAt: plus(inThisMonth(0.75), -21 * DAY) }) });
  const ngocC = await createOrder({ key: 'ngoc:c', userId: N, createdAt: hoursAgo(9), status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'COBOTE-TR-50', qty: 2 }, { sku: 'VIS-CR-100', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, address: snap(ADDR.ngoc), history: trail(hoursAgo(9), 'CONFIRMED', {}) });
  const H = BG.huy.id;
  const huyA = await createOrder({ key: 'huy:a', userId: H, createdAt: at(33, 20), status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'HEC-CL-80', qty: 1 }, { sku: 'HEC-SH-300', qty: 1 }, { sku: 'HEC-FW-120', qty: 1 }], address: snap(ADDR.huy), deliveredAt: at(30, 11), pancakeOrderId: '35012', history: trail(at(33, 20), 'DELIVERED', { deliveredAt: at(30, 11) }) });
  // CTV "lên đơn hộ khách".
  const ctvFor = await createOrder({ key: 'ctv:for-customer', userId: CTV, createdAt: hoursAgo(4), status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [{ sku: 'VIS-SR-30', qty: 1 }, { sku: 'VIS-CL-300', qty: 1 }], referrerUserId: CTV, storefrontSlug: CTV_SLUG, placedForCustomer: true, address: { recipient: 'Chị Hạnh (khách của Mai)', phone: '0900000021', province: HCM.province, district: '', ward: 'Phường Gia Định', street: '66 Nơ Trang Long', provinceCode: HCM.provinceCode, districtCode: '', wardCode: '84_VN7926905' }, note: 'CTV Mai lên đơn hộ khách', history: trail(hoursAgo(4), 'CONFIRMED', {}) });

  // Dealer orders.
  const D = P.dealer.id;
  const dealerPrice = (sku: string) => { const v = V(sku); const tierOverride = (v as unknown as { dealerPrices?: Record<string, number> }).dealerPrices?.DEALER_2; return tierOverride ?? Math.round(v.retailPrice * 0.7); };
  const dItems = (rows: [string, number, number?][]) => rows.map(([sku, qty, backordered]) => ({ sku, qty, unitPrice: dealerPrice(sku), backordered }));
  const dealerAddr = { note: 'Giao theo hợp đồng đại lý' };
  const dPrevA = inQuarter(Q_PREV, 0.25);
  const dq1 = await createOrder({ key: 'dealer:q-prev-a', userId: D, type: 'DEALER', createdAt: dPrevA, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', items: dItems([['FUWA-DW-1L', 120], ['FUWA-LD-2L', 80], ['FUWA-FL-2L', 60], ['POLANG-SP-300', 40]]), address: dealerAddr, deliveredAt: plus(dPrevA, 3 * DAY), pancakeOrderId: '30011', history: trail(dPrevA, 'DELIVERED', { paidOnline: true, stepsH: [5, 24, 30, 72] }) });
  const dPrevB = inQuarter(Q_PREV, 0.7);
  const dq2 = await createOrder({ key: 'dealer:q-prev-b', userId: D, type: 'DEALER', createdAt: dPrevB, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', items: dItems([['COBOTE-TR-50', 150], ['COBOTE-WS-250', 60], ['VIS-CL-300', 50], ['BHN-HN-500', 20], ['LP-ROB-250', 20]]), address: dealerAddr, deliveredAt: plus(dPrevB, 3 * DAY), pancakeOrderId: '32140', history: trail(dPrevB, 'DELIVERED', { paidOnline: true, stepsH: [3, 24, 30, 72] }) });
  const dCurA = inQuarter(Q_CUR, 0.15);
  const dq3 = await createOrder({ key: 'dealer:q-cur-a', userId: D, type: 'DEALER', createdAt: dCurA, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', items: dItems([['FUWA-DW-1L', 150], ['FUWA-LD-2L', 100], ['FUWA-HW-500', 120], ['LP-ARA-250', 30], ['SOK-RC-1KG', 80]]), address: dealerAddr, deliveredAt: past(plus(dCurA, 3 * DAY)), pancakeOrderId: '34718', history: trail(dCurA, 'DELIVERED', { paidOnline: true, stepsH: [4, 24, 30, 72], deliveredAt: past(plus(dCurA, 3 * DAY)) }) });
  const dCurB = inQuarter(Q_CUR, 0.55);
  const dq4 = await createOrder({ key: 'dealer:q-cur-credit', userId: D, type: 'DEALER', createdAt: dCurB, status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', items: dItems([['POLANG-SP-300', 60], ['POLANG-BW-500', 40], ['VIS-CR-100', 20], ['COBOTE-TR-50', 80]]), address: dealerAddr, note: 'Ghi công nợ — NET 15', deliveredAt: past(plus(dCurB, 3 * DAY)), pancakeOrderId: '36640', history: trail(dCurB, 'DELIVERED', { stepsH: [0, 24, 30, 72], deliveredAt: past(plus(dCurB, 3 * DAY)) }) });
  const dCurC = hoursAgo(6 * 24 + 3);
  const dq5 = await createOrder({ key: 'dealer:credit-open', userId: D, type: 'DEALER', createdAt: dCurC, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', items: dItems([['FUWA-GL-500', 40], ['FUWA-HW-500', 30]]), address: dealerAddr, note: 'Ghi công nợ', history: trail(dCurC, 'CONFIRMED', {}) });
  const dq6 = await createOrder({ key: 'dealer:backorder', userId: D, type: 'DEALER', createdAt: hoursAgo(28), status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', items: dItems([['FUWA-DW-5L', 20, 20], ['FUWA-DW-1L', 48, 0]]), address: dealerAddr, note: 'Đặt trước can 5L — giao khi hàng về', history: trail(hoursAgo(28), 'PENDING_PAYMENT', { paidOnline: true }) });

  // ── 5) money ledgers per persona ──
  // Coupons (personal) + redemptions.
  const welcomeActive = await prisma.coupon.findUnique({ where: { code: 'WELCOME30' } });
  await prisma.couponRedemption.create({ data: { couponId: welcomeActive.id, userId: A, orderId: o4.id, redeemedAt: o4c } });
  await prisma.coupon.update({ where: { code: 'WELCOME30' }, data: { usedCount: await prisma.couponRedemption.count({ where: { couponId: welcomeActive.id } }) } });
  const personalCoupon = async (code: string, userId: string, data: Record<string, unknown>) =>
    prisma.coupon.create({ data: { code: code.toUpperCase(), usageLimit: 1, perUserLimit: 1, scope: 'USER_GROUP', scopeMeta: { userId, ...(data.reason ? { reason: data.reason } : {}) }, ...Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'reason')) } });
  const referredCoupon = await personalCoupon(`REFERRED-${A}`, A, { type: 'AMOUNT', value: 50000, minOrder: 200000, startAt: plus(o1.deliveredAt!, HOUR), endAt: plus(o1.deliveredAt!, 30 * DAY + HOUR) });
  await prisma.couponRedemption.create({ data: { couponId: referredCoupon.id, userId: A, orderId: o2.id, redeemedAt: o2c } });
  await prisma.coupon.update({ where: { id: referredCoupon.id }, data: { usedCount: 1 } });
  await personalCoupon(`REFER-${CTV}-${A}`, CTV, { type: 'AMOUNT', value: 50000, minOrder: 200000, startAt: plus(o1.deliveredAt!, HOUR), endAt: plus(NOW, 9 * DAY) });
  const gameCoupon = `GAME30000-${A.slice(-5)}-${digits('game-coupon:active', 4)}`.toUpperCase();
  await personalCoupon(gameCoupon, A, { type: 'AMOUNT', value: 30000, minOrder: 30000, startAt: at(9, 20), endAt: plus(at(9, 20), 30 * DAY) });
  const loyalCoupon = `REWARD-AMO100K-${sha('loyal:active').slice(0, 8).toUpperCase()}`;
  await personalCoupon(loyalCoupon, A, { type: 'AMOUNT', value: 100000, minOrder: 600000, startAt: at(10, 21), endAt: plus(NOW, 2 * DAY) });
  await personalCoupon(`WINBACK-${A}-OLD`, A, { type: 'AMOUNT', value: 40000, minOrder: 250000, startAt: at(80, 2), endAt: at(50, 2), reason: 'WINBACK' });
  await personalCoupon(`WELCOME-${P.new_customer.id}`, P.new_customer.id, { type: 'AMOUNT', value: 30000, minOrder: 199000, startAt: minsAgo(35), endAt: plus(minsAgo(35), 30 * DAY), reason: 'WELCOME' });
  await personalCoupon(`WELCOME-${BG.duong.id}`, BG.duong.id, { type: 'AMOUNT', value: 30000, minOrder: 199000, startAt: at(19, 10), endAt: plus(at(19, 10), 30 * DAY), reason: 'WELCOME' });

  // Points ledger — active_customer (mirrors creditOrderPoints / reviews / check-in / POS / game / redeem).
  const del = (o: BuiltOrder) => points(A, o.pointsEarned, `ORDER_DELIVERED:${o.code}`, o.deliveredAt!, { refType: 'ORDER', refId: o.id });
  for (const o of [o1, o2, o3, o4, o5, o6]) await del(o);
  await points(A, -o6.pointsEarned, `ORDER_REVERSED:${o6.code}`, at(17, 16, 31), { refType: 'ORDER', refId: o6.id });
  await points(A, -40, `ORDER_REDEEM:${o3.code}`, o3c, { refType: 'ORDER', refId: o3.id });
  await points(A, -100, 'LOYALTY_REDEEM_VOUCHER:reward-discount-100k', at(10, 21), { refType: 'REWARD' });
  await points(A, -10, 'GAME_SPIN_COST', at(9, 20, 5), { refType: 'GAME' });
  await points(A, 20, 'GAME_SPIN_WIN:p3', at(9, 20, 5), { refType: 'GAME' });

  // Daily check-in streak (6 days ending yesterday) — loyalty_check_ins + CHECKIN ledger rows.
  const table = [1, 1, 1, 1, 1, 1, 2];
  for (let i = 6; i >= 1; i--) {
    const d = at(i, 7, 30 + i);
    const cycleDay = 7 - i; // 1..6
    const dayKey = vnDayKey(d);
    await prisma.loyaltyCheckIn.create({ data: { userId: A, dayKey, cycleDay, streakDays: cycleDay, points: table[cycleDay - 1]!, createdAt: d } });
    await points(A, table[cycleDay - 1]!, `DAILY_CHECKIN:DAY_${cycleDay}`, d, { refType: 'CHECKIN', refId: dayKey });
  }
  // POS credit at the counter by staff.
  const posAt = at(3, 18, 12);
  const pos = await prisma.posPointCredit.create({ data: { receiptId: 'HD-TD-2026-0187', memberId: A, staffUserId: P.staff.id, orderTotal: 356000, points: 42, multiplier: new Prisma.Decimal(1.2), note: 'Mua tại cửa hàng Thủ Đức', dayKey: vnDayKey(posAt), createdAt: posAt } });
  await points(A, 42, `POS_OFFLINE_ORDER:${pos.receiptId}`, posAt, { refType: 'POS', refId: pos.id });

  // Reviews on delivered items (+REVIEW points, product rating recomputed below).
  const REVIEWED = new Set<string>();
  const review = async (userId: string, o: BuiltOrder, idx: number, rating: number, comment: string, createdAt: Date, withPoints = true) => {
    const it = o.items[idx]!;
    const r = await prisma.review.create({ data: { userId, productId: it.productId, orderId: o.id, rating, comment, images: [], pointsEarned: 5, createdAt } });
    REVIEWED.add(it.productId);
    if (withPoints) await points(userId, 5, `REVIEW:${it.productSlug}`, createdAt, { refType: 'REVIEW', refId: r.id });
    return r;
  };
  await review(A, o1, 0, 5, 'Serum thấm nhanh, da nhạy cảm của mình dùng 2 tuần thấy dịu hẳn. Sẽ mua lại chai 50ml.', plus(o1.deliveredAt!, 2 * DAY));
  await review(A, o1, 2, 4, 'Giặt sạch, thơm nhẹ, đồ của bé mềm. Can hơi khó rót khi còn đầy.', plus(o1.deliveredAt!, 3 * DAY));
  await review(A, o2, 0, 5, 'Hương trái cây rõ, chua thanh dễ uống. Đóng gói kỹ, có van một chiều.', plus(o2.deliveredAt!, 1 * DAY));
  await review(BG.linh.id, linhA, 0, 5, 'Mua lần 3 rồi, chưa thấy serum nào hợp da như này.', plus(linhA.deliveredAt!, DAY));
  await review(BG.ngoc.id, ngocA, 0, 5, 'Dầu tràm thơm dịu, bé nhà mình ngủ ngon hơn hẳn.', plus(ngocA.deliveredAt!, DAY));
  await review(BG.huy.id, huyA, 0, 4, 'Sáp giữ nếp tốt, không bết. Mùi hơi nhạt.', plus(huyA.deliveredAt!, DAY));
  await review(BG.thinh.id, thinhA, 1, 5, 'Lau sàn thơm mùi thảo mộc, không trơn.', plus(thinhA.deliveredAt!, DAY));

  // Return requests: open (o5), approved (o6 → RETURNED + refund), rejected (huy).
  await prisma.returnRequest.create({ data: { orderId: o5.id, userId: A, reason: 'Chai dầu gội 300ml bị nứt nắp khi nhận, dầu gội rò rỉ ra hộp.', images: [], status: 'REQUESTED', refundMethod: 'WALLET', createdAt: at(2, 19, 45) } });
  await prisma.returnRequest.create({ data: { orderId: o6.id, userId: A, reason: 'Sữa rửa mặt bị vón cục, hạn dùng in mờ không đọc được.', images: [], status: 'APPROVED', refundMethod: 'WALLET', adminNote: 'Lỗi lô sản xuất — hoàn tiền vào Ví Tubu', reviewedBy: ADMIN, reviewedAt: at(17, 16, 30), createdAt: at(20, 9, 15) } });
  await prisma.returnRequest.create({ data: { orderId: huyA.id, userId: H, reason: 'Mùi sáp không giống quảng cáo.', images: [], status: 'REJECTED', refundMethod: 'WALLET', adminNote: 'Không thuộc lỗi nhà sản xuất', reviewedBy: ADMIN, reviewedAt: at(27, 10), createdAt: at(28, 20) } });

  // Coins (TubuXu) — active_customer.
  await coins(A, 60000, 'CONVERT_FROM_WALLET', at(40, 20), 'CONVERT', `audit-convert-${A}-1`);
  await coins(A, 30000, 'CONVERT_FROM_WALLET', at(16, 21), 'CONVERT', `audit-convert-${A}-2`);
  await coins(A, 5000, `REFERRED_CASHBACK:${A}`, at(35, 10), 'REFERRAL', A);
  await coins(A, -300, 'GAME_BUY_SEEDS', at(11, 20), 'GAME');
  await coins(A, -o14.total, `ORDER_PAY:${o14.code}`, o14c, 'ORDER', o14.id);

  // Cashback (AccessTrade) — PAID / CONFIRMED / PENDING.
  const merchants = await prisma.cashbackMerchant.findMany();
  const MER = new Map<string, string>(merchants.map((m: { slug: string; id: string }) => [m.slug, m.id]));
  const cbClick = async (key: string, slug: string, at_: Date, url: string) => prisma.cashbackClick.create({ data: { userId: A, merchantId: MER.get(slug), utmTraceId: `audit-${digits(key, 10)}`, destinationUrl: `https://gostore.accesstrade.vn/deep_link/${slug}?utm_content=audit-${digits(key, 10)}`, productUrl: url, clickedAt: at_, ip: '127.0.0.1' } });
  const c1 = await cbClick('cb1', 'shopee', at(62, 21), 'https://shopee.vn/may-loc-khong-khi-mini');
  const c2 = await cbClick('cb2', 'lazada', at(18, 20), 'https://www.lazada.vn/products/binh-giu-nhiet-inox');
  const c3 = await cbClick('cb3', 'tiktokshop', at(4, 22), 'https://shop.tiktok.com/view/product/tui-vai-canvas');
  await prisma.cashbackTransaction.create({ data: { userId: A, clickId: c1.id, provider: 'accesstrade', merchantOrderId: '240726SHP8812031', orderAmount: 1320000, commission: 26400, userReward: 18500, status: 'PAID', postbackPayload: { transaction_id: 'AT-8812031', merchant: 'shopee', status: 1 }, confirmedAt: at(55, 10), paidAt: at(25, 10, 30) } });
  await prisma.cashbackTransaction.create({ data: { userId: A, clickId: c2.id, provider: 'accesstrade', merchantOrderId: 'LZD-39920145', orderAmount: 585000, commission: 17550, userReward: 12300, status: 'CONFIRMED', postbackPayload: { transaction_id: 'AT-39920145', merchant: 'lazada', status: 1 }, confirmedAt: at(9, 10) } });
  await prisma.cashbackTransaction.create({ data: { userId: A, clickId: c3.id, provider: 'accesstrade', merchantOrderId: 'TTS-5581023377', orderAmount: 229000, commission: 11220, userReward: 7800, status: 'PENDING', postbackPayload: { transaction_id: 'AT-5581023377', merchant: 'tiktokshop', status: 0 } } });

  // ── 6) CTV money: commissions / payout / milestone / links ──
  const payoutId = cid('payout:ctv:prev-month');
  const payoutAt = inThisMonth(0.04);
  const paidCommissions = [
    await commissionFor(o1, 'PAID', { lockedAt: o1.deliveredAt, approvedAt: plus(o1.deliveredAt!, 20 * DAY + HOUR), paidAt: payoutAt, payoutBatchId: payoutId }),
    await commissionFor(linhA, 'PAID', { lockedAt: linhA.deliveredAt, approvedAt: plus(linhA.deliveredAt!, 20 * DAY + HOUR), paidAt: payoutAt, payoutBatchId: payoutId }),
    await commissionFor(ngocA, 'PAID', { lockedAt: ngocA.deliveredAt, approvedAt: plus(ngocA.deliveredAt!, 20 * DAY + HOUR), paidAt: payoutAt, payoutBatchId: payoutId }),
  ];
  await prisma.payout.create({ data: { id: payoutId, userId: CTV, amount: paidCommissions.reduce((s, c) => s + c.amount, 0), fee: 0, method: 'BANK', bankInfo: { bankName: 'Vietcombank', accountNumber: '0071000123456', accountName: 'LE HOANG MAI' }, status: 'PAID', idempotencyKey: `audit-payout-${CTV}`, requestedAt: payoutAt, paidAt: plus(payoutAt, 20 * HOUR) } });
  const approved = [
    await commissionFor(o3, 'APPROVED', { lockedAt: o3.deliveredAt, approvedAt: plus(o3.deliveredAt!, 20 * DAY + HOUR) }),
    await commissionFor(linhB, 'APPROVED', { lockedAt: linhB.deliveredAt, approvedAt: plus(linhB.deliveredAt!, 20 * DAY + HOUR) }),
    await commissionFor(linhC, 'APPROVED', { lockedAt: linhC.deliveredAt, approvedAt: plus(linhC.deliveredAt!, 20 * DAY + HOUR) }),
    await commissionFor(thinhA, 'APPROVED', { lockedAt: thinhA.deliveredAt, approvedAt: plus(thinhA.deliveredAt!, 20 * DAY + HOUR) }),
    await commissionFor(ngocB, 'APPROVED', { lockedAt: ngocB.deliveredAt, approvedAt: plus(ngocB.deliveredAt!, 20 * DAY + HOUR) }),
  ];
  await commissionFor(o4, 'LOCKED', { lockedAt: o4.deliveredAt });
  await commissionFor(o8, 'PENDING');
  await commissionFor(ngocC, 'PENDING');
  await commissionFor(thinhAttention, 'PENDING');
  await commissionFor(ctvFor, 'PENDING');
  await commissionFor(o7, 'REJECTED');
  const prevMonthRevenue = paidCommissions.reduce((s, c) => s + c.commissionable, 0);
  const thisMonthRevenue = approved.reduce((s, c) => s + c.commissionable, 0);
  // Milestone claimed last month (+50.000 xu); this month's 3M milestone left CLAIMABLE on purpose.
  const claimPrev = await prisma.ctvMilestoneClaim.create({ data: { userId: CTV, milestoneId: 'milestone-3m', monthKey: monthKeyOf(PREV_MONTH_START), rewardXu: 50000, revenue: prevMonthRevenue, createdAt: plus(MONTH_START, -2 * DAY) } });
  await coins(CTV, 50000, `AFFILIATE_MILESTONE:milestone-3m:${monthKeyOf(PREV_MONTH_START)}`, plus(MONTH_START, -2 * DAY), 'AFFILIATE_MILESTONE', claimPrev.id);
  await coins(CTV, -20000, 'GAME_BUY_SEEDS', at(7, 21), 'GAME');
  // Referrer side of active_customer's first confirmed cashback (CoinsService.grantReferralCoins).
  await coins(CTV, 5000, `REFERRAL_CASHBACK:${A}`, at(35, 10), 'REFERRAL', A);
  // Affiliate links + clicks.
  const link = async (key: string, targetType: string, targetId: string | null, clicks: number, conversions: number, revenue: number, createdAt: Date) => {
    const shortCode = b64url(Buffer.from(sha(`link:${key}`).slice(0, 10), 'hex')).slice(0, 7);
    await prisma.affiliateLink.create({ data: { userId: CTV, shortCode, targetType, targetId, clicks, conversions, revenue, createdAt } });
    return shortCode;
  };
  const l1 = await link('serum', 'PRODUCT', 'serum-duong-am-visante', 318, 14, 4960000, at(120, 21));
  await link('storefront', 'STOREFRONT', CTV_SLUG, 1264, 31, 12850000, at(150, 20));
  await link('fuwa', 'BRAND', 'fuwa3e', 142, 5, 1870000, at(40, 21));
  for (let i = 0; i < 8; i++) {
    await prisma.affiliateClick.create({ data: { shortCode: l1, visitorId: `v_${digits(`visitor:${i}`, 10)}`, ipHash: sha(`ip:${i}`).slice(0, 32), userAgent: 'Mozilla/5.0 (Linux; Android 14) Zalo/24.09', referrer: i % 2 ? 'https://zalo.me' : 'https://www.facebook.com/', clickedAt: at(i * 3 + 1, 20, i * 5) } });
  }
  await prisma.referralTouch.create({ data: { userId: A, referrerUserId: CTV, storefrontSlug: CTV_SLUG, kind: 'ctv', expiresAt: plus(NOW, 2 * DAY) } });
  // Academy progress.
  for (const [lesson, days] of [[C1.lessons[0], 140], [C1.lessons[1], 139], [C1.lessons[2], 60], [C2.lessons[0], 20]] as const) {
    await prisma.userLessonProgress.create({ data: { userId: CTV, lessonId: lesson, completedAt: at(days, 21) } });
  }
  await prisma.userLessonProgress.create({ data: { userId: BG.linh.id, lessonId: C1.lessons[0], completedAt: at(15, 21) } });

  // ── 7) dealer: application, credit ledger, rewards claims, template ──
  const svg = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380"><rect width="600" height="380" rx="24" fill="#EEF7D9"/><text x="300" y="200" font-size="28" text-anchor="middle" fill="#3C6D12" font-family="sans-serif">${label} (mẫu audit)</text></svg>`)}`;
  await prisma.dealerApplication.create({ data: { userId: D, businessName: 'Tạp hoá Xanh Đức Phát', taxCode: '0314556677', ownerName: 'Phạm Văn Đức', phone: P.dealer.phone, address: '120 Bạch Đằng, Phường Gia Định, TP.HCM', cccdFrontUrl: svg('CCCD mặt trước'), cccdBackUrl: svg('CCCD mặt sau'), storeFrontUrl: svg('Mặt tiền cửa hàng'), monthlyVolumeEstimate: 40000000, notes: 'Cửa hàng tạp hoá 12 năm, có 2 nhân viên giao hàng.', status: 'APPROVED', reviewedBy: ADMIN, reviewedAt: at(250, 10), createdAt: at(255, 15) } });
  await prisma.dealerApplication.create({ data: { userId: BG.ngoc.id, businessName: 'Cửa hàng Ngọc Organic', taxCode: null, ownerName: 'Trịnh Bảo Ngọc', phone: BG.ngoc.phone, address: '203 Xuân Thủy, Phường Cầu Giấy, Hà Nội', cccdFrontUrl: svg('CCCD mặt trước'), cccdBackUrl: svg('CCCD mặt sau'), storeFrontUrl: null, monthlyVolumeEstimate: 15000000, notes: 'Muốn làm đại lý khu vực Cầu Giấy.', status: 'PENDING', createdAt: at(1, 16) } });
  await prisma.dealerApplication.create({ data: { userId: BG.duong.id, businessName: 'Đại lý Dương Xanh', taxCode: '8765432109', ownerName: 'Đỗ Thùy Dương', phone: BG.duong.phone, address: '15 Lê Lợi, Phường Sài Gòn, TP.HCM', cccdFrontUrl: svg('CCCD mặt trước'), cccdBackUrl: svg('CCCD mặt sau'), storeFrontUrl: svg('Mặt tiền cửa hàng'), monthlyVolumeEstimate: 25000000, notes: null, status: 'PENDING', createdAt: hoursAgo(5) } });
  const ledger = async (delta: number, refType: string, refId: string | null, note: string, createdAt: Date) =>
    prisma.dealerCreditLedger.create({ data: { userId: D, delta, refType, refId, note, createdAt } });
  const prevQVolume = dq1.total + dq2.total;
  const bonusPct = prevQVolume >= 200e6 ? 4 : prevQVolume >= 100e6 ? 3 : prevQVolume >= 50e6 ? 2 : 0;
  const bonus = Math.round((prevQVolume * bonusPct) / 100);
  if (bonus > 0) await ledger(-bonus, 'QUARTER_BONUS', Q_PREV.key, `Thưởng doanh số ${Q_PREV.key}`, past(plus(Q_CUR.start, 9 * DAY + 4 * HOUR)));
  await ledger(dq4.total, 'ORDER', dq4.id, `Đơn ${dq4.code}`, dCurB);
  await ledger(-Math.round(dq4.total * 0.6 / 100000) * 100000, 'PAYMENT', null, 'Chuyển khoản VCB — thanh toán công nợ', past(plus(dCurB, 12 * DAY)));
  await ledger(dq5.total, 'ORDER', dq5.id, `Đơn ${dq5.code}`, dCurC);
  const curQVolume = dq3.total + dq4.total; // settled (paid or on credit + packed/shipped/delivered)
  const claim = async (rewardRow: { id: string; title: string; type: string; period: string; threshold: number }, periodKey: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID', volume: number, createdAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.dealerRewardClaim.create({ data: { userId: D, rewardId: rewardRow.id, periodKey, rewardTitle: rewardRow.title, rewardType: rewardRow.type, rewardPeriod: rewardRow.period, threshold: rewardRow.threshold, volumeAtClaim: volume, status, createdAt, ...extra } });
  await claim(R1, Q_PREV.key, 'PAID', prevQVolume, past(plus(Q_PREV.end, 2 * DAY)), { note: 'Nhờ Tubu giao quà trong giờ hành chính', reviewedBy: ADMIN, reviewedAt: past(plus(Q_PREV.end, 3 * DAY)), paidBy: ADMIN, paidAt: past(plus(Q_PREV.end, 9 * DAY)), adminNote: 'Đã giao máy lọc nước tại cửa hàng' });
  await claim(R2, Q_PREV.key, 'REJECTED', prevQVolume, past(plus(Q_PREV.end, 2 * DAY + HOUR)), { reviewedBy: ADMIN, reviewedAt: past(plus(Q_PREV.end, 4 * DAY)), rejectionReason: 'Chưa có mặt bằng trưng bày theo tiêu chuẩn (tối thiểu 1,2m kệ).' });
  if (curQVolume >= R1.threshold) {
    await claim(R1, Q_CUR.key, 'APPROVED', curQVolume, hoursAgo(50), { note: 'Quà quý này giao cùng đơn hàng kế tiếp giúp em', reviewedBy: ADMIN, reviewedAt: hoursAgo(20) });
  }
  const r2Claimable = curQVolume >= R2.threshold;
  if (r2Claimable) await claim(R2, Q_CUR.key, 'PENDING', curQVolume, hoursAgo(3), { note: 'Đã bố trí kệ 1,5m ngay cửa ra vào' });
  await prisma.dealerOrderTemplate.create({ data: { userId: D, name: 'Đơn nhập hàng tuần', items: [{ variationId: V('FUWA-DW-1L').id, quantity: 48 }, { variationId: V('FUWA-LD-2L').id, quantity: 24 }, { variationId: V('COBOTE-TR-50').id, quantity: 30 }], createdAt: at(40, 9) } });
  await prisma.dealerPriceHistory.create({ data: { variationId: V('FUWA-LD-2L').id, sku: 'FUWA-LD-2L', tierId: 'DEALER_2', oldPrice: null, newPrice: 138000, changedBy: ADMIN, createdAt: at(45, 10) } });

  // ── 8) staff: profile, shifts, attendance, payroll ──
  const S = P.staff.id;
  await prisma.staffProfile.create({ data: { userId: S, hourlyRate: 32000, bankBin: '970436', bankAccountNo: '0441000765432', bankAccountName: 'DANG NGOC LAN', active: true, createdAt: at(180, 10) } });
  const shiftAt = (daysAgo: number, tpl: { id: string; startMin: number; endMin: number }) => ({
    workDate: workDateOf(at(daysAgo, 12)),
    startAt: at(daysAgo, Math.floor(tpl.startMin / 60), tpl.startMin % 60),
    endAt: at(daysAgo, Math.floor(tpl.endMin / 60), tpl.endMin % 60),
    templateId: tpl.id,
  });
  let workedDays = 0;
  for (let d = 1; workedDays < 10 && d < 20; d++) {
    if (vnParts(at(d, 12)).dow === 0) continue; // Chủ nhật nghỉ
    workedDays++;
    const tpl = workedDays % 4 === 0 ? TPL_AFTERNOON : TPL_MORNING;
    const s = shiftAt(d, tpl);
    const late = workedDays === 3;
    const shift = await prisma.shift.create({ data: { staffId: S, ...s, status: 'APPROVED', approvedBy: ADMIN, approvedAt: plus(s.startAt, -3 * DAY), createdAt: plus(s.startAt, -5 * DAY) } });
    const checkin = plus(s.startAt, late ? 42 * MIN : -(4 + (d % 7)) * MIN);
    const checkout = plus(s.endAt, (3 + (d % 5)) * MIN);
    await prisma.attendanceSession.create({ data: { shiftId: shift.id, staffId: S, checkinAt: checkin, checkoutAt: checkout, checkinLat: 10.85051, checkinLng: 106.77168, checkinIp: '::1', lastHeartbeatAt: plus(checkout, -2 * MIN), closeReason: 'MANUAL', isLate: late, createdAt: checkin } });
  }
  const future = async (daysAhead: number, tpl: typeof TPL_MORNING, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', extra: Record<string, unknown> = {}) => {
    const s = shiftAt(-daysAhead, tpl);
    return prisma.shift.create({ data: { staffId: S, ...s, status, createdAt: hoursAgo(30 + daysAhead), ...(status === 'APPROVED' ? { approvedBy: ADMIN, approvedAt: hoursAgo(10) } : {}), ...extra } });
  };
  await future(1, TPL_MORNING, 'APPROVED');
  await future(2, TPL_AFTERNOON, 'APPROVED');
  await future(8, TPL_MORNING, 'PENDING');
  await future(9, TPL_MORNING, 'PENDING');
  await future(4, TPL_AFTERNOON, 'REJECTED', { rejectReason: 'Ca chiều đã đủ người, em đăng ký ca sáng nhé.' });
  await future(5, TPL_MORNING, 'CANCELLED', { cancelReason: 'Việc gia đình đột xuất', cancelledAt: hoursAgo(8), cancelPenalty: false });
  await prisma.payrollAdjustment.create({ data: { staffId: S, workDate: workDateOf(at(2, 12)), type: 'MANUAL', amount: -50000, reason: 'Thưởng hỗ trợ kiểm kho cuối tuần', createdBy: ADMIN, createdAt: at(2, 18) } });
  // Previous month: finalized & paid (locked, so recompute never touches it).
  const prevY = vnParts(PREV_MONTH_START).y;
  const prevM = vnParts(PREV_MONTH_START).m + 1;
  let pTotalMin = 0;
  let pGross = 0;
  for (let day = 2; day <= 27; day++) {
    const wd = new Date(Date.UTC(prevY, prevM - 1, day));
    if (wd.getUTCDay() === 0) continue;
    const minutes = day % 6 === 0 ? 480 : 240;
    const gross = Math.round((minutes / 60) * 32000);
    pTotalMin += minutes;
    pGross += gross;
    await prisma.payrollDay.create({ data: { staffId: S, workDate: wd, workedMinutes: minutes, hourlyRate: 32000, gross, fines: 0, net: gross, finalizedAt: plus(MONTH_START, 2 * DAY) } });
  }
  await prisma.payrollMonth.create({ data: { staffId: S, year: prevY, month: prevM, totalMinutes: pTotalMin, gross: pGross, totalFines: 0, net: pGross, status: 'PAID', finalizedAt: plus(MONTH_START, 2 * DAY), paidAt: plus(MONTH_START, 4 * DAY), paidBy: ADMIN, note: 'Chuyển khoản VCB' } });

  // ── 9) game, season pass, refill, beta, wishlist, cart, subscription, brand follows ──
  const game = async (userId: string, data: Record<string, unknown>) => prisma.gameProfile.create({ data: { userId, ...data } });
  await game(A, { streakDays: 12, longestStreak: 21, lastCheckInAt: at(1, 20, 15), treeStage: 3, totalSeeds: 185, ecoImpact: { progress: 410, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 2 }, badges: ['FIRST_HARVEST', 'STREAK_7', 'REFILL_HERO'], lastWateredAt: at(1, 20, 20), streakFreezes: 1, lastDewAt: at(1, 7, 5) });
  await game(CTV, { streakDays: 3, longestStreak: 9, lastCheckInAt: at(1, 21), treeStage: 2, totalSeeds: 60, ecoImpact: { progress: 180, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 1 }, badges: ['FIRST_HARVEST'], lastWateredAt: at(1, 21, 5) });
  await game(BG.linh.id, { streakDays: 28, longestStreak: 28, lastCheckInAt: at(1, 6, 50), treeStage: 4, totalSeeds: 420, ecoImpact: { progress: 520, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 6 }, badges: ['FIRST_HARVEST', 'STREAK_7', 'STREAK_21'], lastWateredAt: at(1, 7) });
  await game(BG.huy.id, { streakDays: 0, longestStreak: 4, lastCheckInAt: at(9, 21), treeStage: 1, totalSeeds: 35, ecoImpact: { progress: 90, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 }, badges: [], lastWateredAt: at(9, 21), brokenStreakDays: 4, brokenStreakAt: hoursAgo(30) });
  await prisma.plantedTree.create({ data: { userId: A, certificateCode: `TUBU-${sha('cert:a1').slice(0, 8).toUpperCase()}`, treeType: 'Cây Dứa Fuwa3e', region: 'Rừng ngập mặn Cần Giờ', status: 'PLANTED', pledgedAt: at(60, 20), plantedAt: at(30, 9) } });
  await prisma.plantedTree.create({ data: { userId: A, certificateCode: `TUBU-${sha('cert:a2').slice(0, 8).toUpperCase()}`, treeType: 'Cây Dứa Fuwa3e', status: 'PLEDGED', pledgedAt: at(9, 20) } });
  await prisma.plantedTree.create({ data: { userId: CTV, certificateCode: `TUBU-${sha('cert:c1').slice(0, 8).toUpperCase()}`, treeType: 'Cây Dứa Fuwa3e', status: 'PLEDGED', pledgedAt: at(20, 21) } });
  await prisma.userSpecies.create({ data: { userId: A, speciesId: 'sp-duoc', count: 1, firstCollectedAt: at(60, 20) } });
  await prisma.userSpecies.create({ data: { userId: A, speciesId: 'sp-phuong', count: 1, firstCollectedAt: at(9, 20) } });
  await prisma.userSpecies.create({ data: { userId: CTV, speciesId: 'sp-tram', count: 1, firstCollectedAt: at(20, 21) } });
  await prisma.gardenPlot.create({ data: { userId: A, slot: 1, treeType: 'Cây Sao Đen', speciesId: 'sp-sao', progress: 120, target: 600, treeStage: 1, lastWateredAt: at(1, 20, 22), createdAt: at(20, 20) } });
  for (const [prizeId, prizeName, value, rewardType, d] of [['p3', '20 điểm Xanh', 20, 'POINTS', 9], ['p5', '30 💧', 30, 'SEEDS', 18], ['p8', 'Chúc may mắn lần sau', 0, 'NONE', 25]] as const) {
    await prisma.gameSpin.create({ data: { userId: A, prizeId, prizeName, prizeValue: value, rewardType, spunAt: at(d, 20, 5) } });
  }
  await prisma.waterGift.create({ data: { senderId: CTV, recipientId: A, amount: 20, dayKey: vnDayKey(at(1, 21)), createdAt: at(1, 21, 2) } });
  await prisma.waterGift.create({ data: { senderId: A, recipientId: BG.huy.id, amount: 20, dayKey: vnDayKey(at(1, 20)), createdAt: at(1, 20, 25) } });
  await prisma.waterGift.create({ data: { senderId: BG.linh.id, recipientId: A, amount: 20, dayKey: vnDayKey(at(3, 7)), createdAt: at(3, 7, 1) } });
  await prisma.communityContribution.create({ data: { userId: A, goalId: 'cg-cangio-2026', drops: 1200 } });
  await prisma.communityContribution.create({ data: { userId: BG.linh.id, goalId: 'cg-cangio-2026', drops: 3600 } });
  await prisma.communityContribution.create({ data: { userId: CTV, goalId: 'cg-cangio-2026', drops: 600 } });
  for (const [quizId, ok] of [['q1', true], ['q4', false]] as const) {
    await prisma.gameQuizAttempt.create({ data: { userId: A, quizId, isCorrect: ok, attemptedAt: at(1, 20, 30), dayKey: vnDayKey(at(1, 20)) } });
  }
  await prisma.userSeasonPass.create({ data: { userId: A, seasonId: 'se-audit-current', xp: 90, claimedFree: [0], claimedPremium: [0] } });
  await coins(A, 5000, 'SEASONPASS:se-audit-current:0:premium', at(12, 20), 'SEASONPASS', 'se-audit-current');
  await prisma.userSeasonPass.create({ data: { userId: CTV, seasonId: 'se-audit-current', xp: 30, claimedFree: [], claimedPremium: [] } });
  // Refill / bottle returns.
  await prisma.bottleReturn.create({ data: { userId: A, quantity: 3, seedsAwarded: 150, status: 'APPROVED', createdAt: at(20, 17) } });
  await prisma.bottleReturn.create({ data: { userId: A, quantity: 2, seedsAwarded: 100, status: 'APPROVED', createdAt: at(8, 17) } });
  await prisma.bottleReturn.create({ data: { userId: A, quantity: 4, seedsAwarded: 200, status: 'PENDING', createdAt: hoursAgo(26) } });
  await prisma.bottleReturn.create({ data: { userId: A, quantity: 1, seedsAwarded: 50, status: 'REJECTED', createdAt: at(30, 17) } });
  await prisma.bottleReturn.create({ data: { userId: BG.linh.id, quantity: 6, seedsAwarded: 300, status: 'PENDING', createdAt: hoursAgo(3) } });
  // Beta.
  await prisma.betaTester.create({ data: { userId: A, status: 'ACTIVE', joinedAt: at(30, 21) } });
  await prisma.betaFeedback.create({ data: { userId: A, message: 'Mong có thêm bộ lọc "an toàn cho bà bầu" ở trang danh mục.', createdAt: at(12, 21) } });
  await prisma.betaTester.create({ data: { userId: CTV, status: 'ACTIVE', joinedAt: at(50, 21) } });
  // Wishlist / cart / subscriptions / follows / flash reminder.
  for (const [pid, d] of [['p-visante-vitc', 20], ['p-leplateau-coldbrew', 12], ['p-sokfram-granola', 6], ['p-bhnong-cagaileo', 2]] as const) {
    await prisma.wishlist.create({ data: { userId: A, productId: pid, createdAt: at(d, 21) } });
  }
  await prisma.wishlist.create({ data: { userId: CTV, productId: 'p-visante-eye', createdAt: at(4, 21) } });
  await prisma.cart.create({ data: { userId: A, items: { create: [{ variationId: V('VIS-SR-30').id, quantity: 1 }, { variationId: V('COBOTE-TR-50').id, quantity: 2 }] }, abandonRemindedAt: null } });
  await prisma.cart.create({ data: { userId: CTV, items: { create: [{ variationId: V('FUWA-LD-2L').id, quantity: 1 }] } } });
  await prisma.subscription.create({ data: { userId: A, variationId: V('FUWA-LD-2L').id, quantity: 1, intervalWeeks: 6, addressId: ADDR.activeHome.id, status: 'ACTIVE', nextRunAt: at(-12, 9), lastOrderId: o3.id, createdAt: at(70, 21) } });
  await prisma.subscription.create({ data: { userId: A, variationId: V('SOK-RC-1KG').id, quantity: 2, intervalWeeks: 4, addressId: ADDR.activeHome.id, status: 'PAUSED', nextRunAt: at(-20, 9), createdAt: at(50, 21) } });
  await prisma.brandFollow.create({ data: { userId: A, brandId: FUWA_BRAND, createdAt: at(60, 21) } });
  await prisma.brandFollow.create({ data: { userId: A, brandId: VIS_BRAND, createdAt: at(40, 21) } });
  await prisma.flashSaleReminder.create({ data: { userId: A, flashSaleItemId: nextFlash.id } });

  // Group buy (open, needs 1 more) + a successful one from last month.
  const gbOpen = cid('groupbuy:open');
  const laundry = V('FUWA-LD-2L');
  await prisma.groupBuy.create({ data: { id: gbOpen, productId: laundry.productId, initiatorId: A, targetSize: 3, currentSize: 2, unitPrice: Math.round(laundry.retailPrice * 0.85), basePrice: laundry.retailPrice, status: 'OPEN', expiresAt: plus(NOW, 40 * HOUR), createdAt: hoursAgo(8) } });
  await prisma.groupBuyMember.create({ data: { groupBuyId: gbOpen, userId: A, joinedAt: hoursAgo(8) } });
  await prisma.groupBuyMember.create({ data: { groupBuyId: gbOpen, userId: BG.linh.id, joinedAt: hoursAgo(5) } });
  const gbDone = cid('groupbuy:success');
  const honey = V('BHN-HN-500');
  await prisma.groupBuy.create({ data: { id: gbDone, productId: honey.productId, initiatorId: BG.linh.id, targetSize: 3, currentSize: 3, unitPrice: Math.round(honey.retailPrice * 0.85), basePrice: honey.retailPrice, status: 'SUCCESS', expiresAt: at(18, 20), createdAt: at(20, 20), couponsGrantedAt: at(19, 9) } });
  for (const [u, h] of [[BG.linh.id, 0], [A, 5], [BG.ngoc.id, 9]] as const) {
    await prisma.groupBuyMember.create({ data: { groupBuyId: gbDone, userId: u, joinedAt: plus(at(20, 20), h * HOUR) } });
  }

  // ── 10) community ──
  const post = async (key: string, data: Record<string, unknown>) => prisma.feedPost.create({ data: { id: cid(`post:${key}`), images: [], ...data } });
  const comment = async (key: string, postId: string, userId: string, body: string, createdAt: Date, isAccepted = false) =>
    prisma.feedComment.create({ data: { id: cid(`comment:${key}`), postId, userId, body, createdAt, isAccepted } });
  const qPost = await post('active:question', { userId: A, kind: 'QUESTION', status: 'PUBLISHED', categoryId: CAT.get('hoi-mua-gi') ?? null, title: 'Nước giặt Fuwa3e có dùng được cho đồ sơ sinh không ạ?', body: 'Bé nhà mình 2 tháng tuổi, da hay nổi mẩn. Mình đang dùng nước giặt cho bé của hãng ngoại nhưng muốn chuyển sang đồ Việt, enzyme sinh học. Mọi người dùng Fuwa3e cho đồ sơ sinh thấy sao ạ? Có cần xả 2 lần không?', viewCount: 214, createdAt: at(4, 21, 10) });
  const cBest = await comment('staff:answer', qPost.id, P.staff.id, 'Chào chị Hà, nước giặt Fuwa3e dùng được cho đồ sơ sinh ạ: enzyme dứa, không chất tăng trắng quang học, đã kiểm nghiệm kích ứng da. Chị pha 1 nắp cho 6–8kg đồ, chế độ xả 1 lần là đủ vì ít bọt. Với bé da nhạy cảm, lần đầu chị giặt thử vài món nhỏ trước nhé 🌿', at(4, 21, 40), true);
  await comment('ctv:answer', qPost.id, CTV, 'Mình dùng cho bé từ lúc mới sinh tới giờ, không bị mẩn gì chị ạ. Chị để ý phơi nắng nhẹ là đồ thơm lắm.', at(4, 22, 5));
  await comment('linh:answer', qPost.id, BG.linh.id, 'Nhà mình xả 1 lần thôi, đồ mềm hơn hẳn nước giặt cũ.', at(3, 7, 30));
  await prisma.feedPost.update({ where: { id: qPost.id }, data: { bestCommentId: cBest.id } });
  await prisma.postProductTag.create({ data: { postId: qPost.id, productId: 'p-fuwa-laundry' } });
  await prisma.postTag.create({ data: { postId: qPost.id, tagId: TAG.meVaBe.id } });
  await prisma.postTag.create({ data: { postId: qPost.id, tagId: TAG.fuwa.id } });
  const showcase = await post('active:showcase', { userId: A, kind: 'SHOWCASE', status: 'PUBLISHED', categoryId: CAT.get('khoe-vuon') ?? null, title: 'Góc ban công xanh nhà mình 🌿', body: 'Sau 3 tháng tự trồng rau thơm và mấy chậu trầu bà, ban công 4m² nhà mình mát hẳn. Tưới bằng nước vo gạo, bón vỏ trứng — không tốn đồng nào!', meta: { eventId: cid('event:open') }, viewCount: 96, createdAt: at(2, 20, 30) });
  await prisma.postTag.create({ data: { postId: showcase.id, tagId: TAG.banCong.id } });
  const harvest = await post('active:harvest', { userId: A, kind: 'HARVEST', status: 'PUBLISHED', body: 'Vừa thu hoạch 1 cây trong Vườn Xanh 🌳', meta: { treesPlanted: 2 }, createdAt: at(9, 20, 1) });
  const tip = await post('ctv:tip', { userId: CTV, kind: 'TIP', status: 'PUBLISHED', categoryId: CAT.get('meo-hay') ?? null, title: '3 mẹo dùng nước rửa chén enzyme tiết kiệm một nửa', body: '1) Pha loãng 1:3 vào chai xịt. 2) Ngâm chén 5 phút với nước ấm trước khi rửa. 3) Dùng miếng rửa bằng xơ mướp — ít tốn nước rửa hơn hẳn!', isPinned: true, viewCount: 530, createdAt: at(6, 20) });
  await prisma.postTag.create({ data: { postId: tip.id, tagId: TAG.meo.id } });
  await prisma.postProductTag.create({ data: { postId: tip.id, productId: 'p-fuwa-dishwash' } });
  const staffTip = await post('staff:tip', { userId: P.staff.id, kind: 'TIP', status: 'PUBLISHED', categoryId: CAT.get('cham-soc') ?? null, title: 'Cách phân biệt cây thiếu nước và cây úng nước', body: 'Lá héo + đất khô là thiếu nước; lá vàng mềm + đất ướt lâu là úng. Kiểm tra bằng cách cắm ngón tay sâu 2 đốt vào đất trước khi tưới.', viewCount: 311, createdAt: at(10, 9) });
  const pending = await post('duong:pending', { userId: BG.duong.id, kind: 'QUESTION', status: 'PENDING', categoryId: CAT.get('sau-benh') ?? null, title: 'Cây hoa hồng bị rệp trắng xử lý sao ạ?', body: 'Mình mới mua cây hồng leo được 2 tuần thì thấy rệp trắng bám dưới lá. Có cách nào tự nhiên không, xem thêm ảnh ở link.', createdAt: hoursAgo(6) });
  const spam = await post('huy:reported', { userId: BG.huy.id, kind: 'MANUAL', status: 'PUBLISHED', body: 'Ai cần mua sỉ chậu nhựa giá rẻ inbox mình nhé, giao toàn quốc!!!', createdAt: hoursAgo(30) });
  await prisma.communityReport.create({ data: { reporterId: A, targetType: 'POST', targetId: spam.id, reason: 'Quảng cáo, không liên quan cộng đồng', status: 'OPEN', createdAt: hoursAgo(20) } });
  await prisma.communityReport.create({ data: { reporterId: BG.linh.id, targetType: 'POST', targetId: spam.id, reason: 'Spam', status: 'OPEN', createdAt: hoursAgo(18) } });
  for (const [pid, users] of [[qPost.id, [CTV, BG.linh.id, BG.ngoc.id, P.staff.id]], [showcase.id, [BG.linh.id, CTV]], [tip.id, [A, BG.linh.id, BG.thinh.id, BG.ngoc.id, P.staff.id]], [staffTip.id, [A, CTV]], [harvest.id, [BG.linh.id]]] as const) {
    for (const u of users) await prisma.feedReaction.create({ data: { postId: pid, userId: u } });
  }
  // Reputation ledger + profiles (reputation = Σ events).
  const rep = async (userId: string, amount: number, reason: string, refId: string, createdAt: Date) => prisma.reputationEvent.create({ data: { userId, amount, reason, refId, createdAt } });
  await rep(A, 5, 'POST', qPost.id, at(4, 21, 10));
  await rep(A, 5, 'POST', showcase.id, at(2, 20, 30));
  await rep(CTV, 5, 'POST', tip.id, at(6, 20));
  await rep(CTV, 2, 'ANSWER', cid('comment:ctv:answer'), at(4, 22, 5));
  await rep(P.staff.id, 5, 'POST', staffTip.id, at(10, 9));
  await rep(P.staff.id, 2, 'ANSWER', cBest.id, at(4, 21, 40));
  await rep(P.staff.id, 15, 'BEST_ANSWER', qPost.id, at(4, 23));
  await rep(BG.linh.id, 2, 'ANSWER', cid('comment:linh:answer'), at(3, 7, 30));
  await prisma.communityProfile.create({ data: { userId: A, reputation: 10, level: 1, isTrusted: true, postCount: 3, bestAnswerCount: 0 } });
  await prisma.communityProfile.create({ data: { userId: CTV, reputation: 7, level: 1, isTrusted: true, postCount: 1 } });
  await prisma.communityProfile.create({ data: { userId: P.staff.id, reputation: 22, level: 1, isTrusted: true, isExpert: true, postCount: 1, bestAnswerCount: 1 } });
  await prisma.communityProfile.create({ data: { userId: BG.linh.id, reputation: 2, level: 1, isTrusted: true } });
  await coins(A, 200, `COMMUNITY_POST:${qPost.id}`, at(4, 21, 10), 'COMMUNITY', qPost.id);
  await coins(A, 200, `COMMUNITY_POST:${showcase.id}`, at(2, 20, 30), 'COMMUNITY', showcase.id);
  await coins(A, 30000, `COMMUNITY_EVENT_WIN:${cid('event:closed')}:${A}`, at(29, 10), 'COMMUNITY', cid('event:closed'));
  await coins(CTV, 200, `COMMUNITY_POST:${tip.id}`, at(6, 20), 'COMMUNITY', tip.id);
  await coins(CTV, 100, `COMMUNITY_ANSWER:${cid('comment:ctv:answer')}`, at(4, 22, 5), 'COMMUNITY', cid('comment:ctv:answer'));
  await coins(P.staff.id, 100, `COMMUNITY_ANSWER:${cBest.id}`, at(4, 21, 40), 'COMMUNITY', cBest.id);
  await coins(P.staff.id, 500, `COMMUNITY_BEST:${qPost.id}`, at(4, 23), 'COMMUNITY', qPost.id);
  await coins(P.staff.id, 200, `COMMUNITY_POST:${staffTip.id}`, at(10, 9), 'COMMUNITY', staffTip.id);

  // ── 11) notifications (read + unread, many template codes) ──
  await notify(A, 'ORDER_CONFIRMED', { order_code: o11.code }, plus(o11c, 5000), false);
  await notify(A, 'ORDER_CONFIRMED', { order_code: o10.code }, plus(o10c, 5000), false);
  await notify(A, 'ORDER_SHIPPING', { order_code: o8.code }, plus(o8c, 26 * HOUR), false);
  await notify(A, 'ORDER_PACKED', { order_code: o9.code }, plus(o9c, 20 * HOUR), true);
  await notify(A, 'RETURN_REQUESTED', { order_code: o5.code }, at(2, 19, 46), false);
  await notify(A, 'COMMUNITY_EXPERT_REPLIED', { title: qPost.title }, at(4, 21, 41), false);
  await notify(A, 'COMMUNITY_NEW_ANSWER', { author: P.ctv.fullName, title: qPost.title }, at(4, 22, 6), true);
  await notify(A, 'GAME_WATER_GIFT', { amount: '20' }, at(1, 21, 3), false);
  await notify(A, 'ORDER_DELIVERED', { order_code: o4.code }, o4.deliveredAt!, true);
  await notify(A, 'ORDER_DELIVERED', { order_code: o5.code }, o5.deliveredAt!, true);
  await notify(A, 'RETURN_APPROVED', { order_code: o6.code }, at(17, 16, 31), true);
  await notify(A, 'CASHBACK_PAID', { amount: vnd(18500) }, at(25, 10, 31), true);
  await notify(A, 'FLASH_STARTING', { product: V('FUWA-LD-2L').product.name }, hoursAgo(1), true);
  await notify(A, 'SUBSCRIPTION_ORDER', { order_code: o3.code }, o3c, true);
  await notify(A, 'GROUP_BUY_SUCCESS', { discount: vnd(Math.round(honey.retailPrice * 0.15)) }, at(19, 9), true);
  await notify(A, 'GAME_CHECKIN_REMINDER', { streak: '11' }, at(1, 11), true);
  await notify(A, 'WELCOME_VOUCHER', { code: 'WELCOME30', value: '30000', expires: at(110, 9).toLocaleDateString('vi-VN') }, at(139, 10), true);
  await notify(P.new_customer.id, 'WELCOME_VOUCHER', { code: `WELCOME-${P.new_customer.id}`.toUpperCase(), value: '30000', expires: plus(NOW, 30 * DAY).toLocaleDateString('vi-VN') }, minsAgo(34), false);
  await notify(CTV, 'STOREFRONT_TRENDING_PRODUCTS', { count: '3', sample: 'Tinh chất Vitamin C Visante' }, at(6, 9), false);
  await notify(CTV, 'COMMUNITY_POST_APPROVED', {}, at(6, 20, 5), true);
  await notify(CTV, 'ORDER_CONFIRMED', { order_code: ctvFor.code }, plus(hoursAgo(4), 5000), false);
  await notify(D, 'DEALER_BONUS_PAID', { quarter: Q_PREV.key, amount: vnd(bonus), revenue: vnd(prevQVolume) }, past(plus(Q_CUR.start, 9 * DAY + 4 * HOUR)), true);
  await notify(D, 'DEALER_REWARD_CLAIM_PAID', { reward: R1.title, period: `Quý ${Q_PREV.key.slice(1)}` }, past(plus(Q_PREV.end, 9 * DAY)), true);
  await notify(D, 'DEALER_REWARD_CLAIM_REJECTED', { reward: R2.title, period: `Quý ${Q_PREV.key.slice(1)}`, reason: 'Chưa có mặt bằng trưng bày theo tiêu chuẩn (tối thiểu 1,2m kệ).' }, past(plus(Q_PREV.end, 4 * DAY)), true);
  await notify(D, 'DEALER_REWARD_CLAIM_APPROVED', { reward: R1.title, period: `Quý ${Q_CUR.key.slice(1)}` }, hoursAgo(20), false);
  await notify(ADMIN, 'DEALER_REWARD_CLAIM_NEW', { dealer: 'Tạp hoá Xanh Đức Phát', reward: R2.title, period: `Quý ${Q_CUR.key.slice(1)}`, volume: vnd(curQVolume) }, hoursAgo(3), false);
  await notify(ADMIN, 'OPS_GOMDON_ALERT', { order_code: thinhAttention.code, message: 'Kết quả tạo vận đơn không rõ (timeout) — kiểm tra trên Gomdon trước khi tạo lại.' }, hoursAgo(19), false);
  await notify(P.staff.id, 'COMMUNITY_BEST_ANSWER', {}, at(4, 23, 1), true);

  // ── 12) balances derived from the ledgers (+ wallet / cashback pending) ──
  for (const u of [...ALL_USERS.map((x) => x.id), GUEST_USER.id]) {
    const [pAgg, cAgg] = await Promise.all([
      prisma.pointsTransaction.aggregate({ where: { userId: u }, _sum: { delta: true } }),
      prisma.coinTransaction.aggregate({ where: { userId: u }, _sum: { delta: true } }),
    ]);
    await prisma.user.update({ where: { id: u }, data: { pointsBalance: pAgg._sum.delta ?? 0, coinsBalance: cAgg._sum.delta ?? 0 } });
  }
  const wallet = (id: string, walletBalance: number, cashbackPending = 0) => prisma.user.update({ where: { id }, data: { walletBalance, cashbackPending } });
  // Wallet: refund o6 + cashback paid − two Ví→xu conversions − o9 paid by wallet.
  await wallet(A, o6.total + 18500 - 50000 - 25000 - o9.total, 12300);
  await wallet(CTV, 85000);
  await wallet(BG.linh.id, 12000);

  // Product ratings (denormalized) for reviewed products.
  for (const productId of REVIEWED) {
    const agg = await prisma.review.aggregate({ where: { productId, isVisible: true }, _avg: { rating: true }, _count: { _all: true } });
    await prisma.product.update({ where: { id: productId }, data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count._all } });
  }

  // ── 13) tokens + personas.json + routes.json ──
  const personasOut = await mintPersonas();
  const routes = buildRoutes({
    productSlug: 'nuoc-giat-fuwa3e',
    productSlugAlt: 'serum-duong-am-visante',
    outOfStockSlug: 'nuoc-rua-chen-fuwa3e',
    ctvSlug: CTV_SLUG,
    ctvSubdomain: 'goc-xanh-nha-mai',
    dealerStoreSlug: DEALER_SLUG,
    brandSlug: 'fuwa3e',
    brandSlugAlt: 'visante',
    unpublishedBrandSlug: 'hector',
    postId: qPost.id,
    showcasePostId: showcase.id,
    pendingPostId: pending.id,
    courseId: C1.id,
    courseId2: C2.id,
    bankPaymentCode: o11.code,
    dealerBankPaymentCode: dq6.code,
    orderCodes: {
      PENDING_PAYMENT: o11.code, CONFIRMED: o10.code, PACKED: o9.code, SHIPPING: o8.code, DELIVERED: o4.code,
      DELIVERED_OPEN_RETURN: o5.code, DELIVERED_OLD_REVIEWED: o1.code, DELIVERED_PAID_WITH_XU: o14.code,
      RETURNED: o6.code, CANCELLED: o7.code, RECYCLING_SHIPPING: o12.code, INVOICE_REQUESTED: o3.code,
    },
    ctvOrderForCustomer: ctvFor.code,
    dealerOrderCodes: { backorder: dq6.code, creditOpen: dq5.code, creditDelivered: dq4.code, paidDelivered: dq3.code },
    recyclingAttentionOrder: thinhAttention.code,
  });

  const summary = {
    db: EXPECTED_DB,
    seededAt: NOW.toISOString(),
    users: Object.fromEntries([...Object.entries(P), ...Object.entries(BG)].map(([k, u]) => [k, { id: u.id, role: u.role, phone: u.phone, fullName: u.fullName, referralCode: u.referralCode }])),
    guestOnboardedUser: { id: GUEST_USER.id, deviceId: GUEST_DEVICE_ID },
    storefronts: { ctv: { id: sfId, slug: CTV_SLUG, subdomain: 'goc-xanh-nha-mai' }, dealerMerchant: { id: dealerSf, slug: DEALER_SLUG, subdomain: 'duc-phat' } },
    brands: { owned: { id: FUWA_BRAND, slug: 'fuwa3e', owner: P.brand_owner.id }, others: BRANDS.filter((b) => b.name !== 'Fuwa3e').map((b) => b.slug) },
    orders: Object.fromEntries([...ORDERS.values()].map((o) => [o.key, { id: o.id, code: o.code, status: o.status, total: o.total }])),
    ctv: { thisMonthConfirmedRevenue: thisMonthRevenue, prevMonthConfirmedRevenue: prevMonthRevenue, payoutId },
    dealer: { tier: 'DEALER_2', prevQuarter: Q_PREV.key, prevQuarterVolume: prevQVolume, currentQuarter: Q_CUR.key, currentQuarterSettledVolume: curQVolume, quarterBonus: bonus, rewards: { R1: R1.id, R2: R2.id, R3: R3.id, R4: R4.id }, r2PendingClaim: r2Claimable },
    community: { questionPostId: qPost.id, showcasePostId: showcase.id, tipPostId: tip.id, pendingPostId: pending.id, reportedPostId: spam.id, openEventId: cid('event:open') },
    academy: { courses: [C1.id, C2.id] },
    groupBuys: { open: gbOpen, success: gbDone },
    flashSales: { live: cid('flash:live'), upcoming: cid('flash:next') },
    coupons: { personalActive: [gameCoupon, loyalCoupon, `REFERRED-${A}`.toUpperCase() + ' (used)'], public: ['XANH10', 'FREESHIP', 'FUWA15'], used: ['WELCOME30'] },
    gomdonWebhookEvents: evN,
    files: { personas: path.relative(REPO, path.join(OUT_DIR, 'personas.json')), routes: path.relative(REPO, path.join(OUT_DIR, 'routes.json')) },
    tokenMint: { personas: personasOut.length, refreshTokensPerPersona: REFRESH_POOL, accessTokenTtlDays: ACCESS_TTL_DAYS },
    routeCount: { miniapp: routes.miniapp.length, web: routes.web.length },
  };
  mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(path.join(AUDIT_DIR, 'seed-output.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

// ───────────────────────────── tokens / personas.json ─────────────────────────────
const REFRESH_POOL = 25;
const ACCESS_TTL_DAYS = 7;
const MINIAPP_ORIGIN = 'http://localhost:3213';
const WEB_ORIGIN = 'http://localhost:3212';
const API_ORIGIN = 'http://localhost:3201';

async function mintPersonas() {
  const out: Record<string, unknown>[] = [];
  const keys: (PersonaKey | 'guest')[] = ['guest', 'new_customer', 'active_customer', 'ctv', 'dealer', 'brand_owner', 'staff', 'admin'];
  for (const key of keys) {
    if (key === 'guest') {
      out.push({
        name: 'guest',
        userId: null,
        role: null,
        description: 'Anonymous visitor. Miniapp: no storage → restore() finds no refresh token, Zalo login fails outside Zalo, app falls back to POST /auth/guest and CREATES a new guest user (onboarding quiz overlay shows). Web: no cookie/marker → logged-out pages.',
        miniapp: {
          origin: MINIAPP_ORIGIN,
          localStorage: {},
          variantOnboardedGuest: {
            note: 'Optional: reuse a pre-seeded, already-onboarded guest (no onboarding overlay). POST /auth/guest resolves deviceId → this user.',
            userId: GUEST_USER.id,
            localStorage: { tubu_device_id: zmpEncode(GUEST_DEVICE_ID) },
          },
        },
        web: { origin: WEB_ORIGIN, localStorage: {}, cookies: [] },
      });
      continue;
    }
    const u = P[key];
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const jwt = signJwt(
      { sub: user.id, role: user.role, zaloId: user.zaloId ?? undefined, affiliateEnabled: user.role === 'AFFILIATE' || user.role === 'ADMIN', dealerEnabled: user.role === 'DEALER' },
      ACCESS_TTL_DAYS * 86400,
    );
    const pool: string[] = [];
    const expiresAt = plus(new Date(), REFRESH_TTL_DAYS * DAY);
    for (let i = 0; i < REFRESH_POOL; i++) {
      const token = randomBytes(48).toString('base64url');
      await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: sha(token), expiresAt } });
      pool.push(token);
    }
    const authUser = {
      id: user.id, zaloId: user.zaloId, phone: user.phone, email: user.email, fullName: user.fullName, avatarUrl: user.avatarUrl,
      role: user.role, tierId: user.tierId, referralCode: user.referralCode, pointsBalance: user.pointsBalance,
      walletBalance: user.walletBalance, coinsBalance: user.coinsBalance,
    };
    out.push({
      name: key,
      userId: user.id,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      referralCode: user.referralCode,
      tokens: {
        accessToken: jwt.token,
        accessTokenExpiresAt: new Date(jwt.exp * 1000).toISOString(),
        refreshTokens: pool,
        refreshTokensExpireAt: expiresAt.toISOString(),
        note: 'Refresh tokens are SINGLE-USE (rotated by POST /auth/refresh; presenting a used one revokes ALL of this user\'s sessions). Use a fresh one per new browser context, or keep one context per persona. Re-run the seed to re-mint.',
      },
      authUser,
      miniapp: {
        origin: MINIAPP_ORIGIN,
        mustUseHostname: 'localhost (zmp-sdk only enables storage when location.hostname includes "localhost")',
        localStorageKey: 'tubu_refresh_token',
        localStorageValueEncoding: 'btoa(encodeURIComponent(JSON.stringify(refreshToken)))',
        localStorage: { tubu_refresh_token: zmpEncode(pool[0]) },
        localStorageForPoolIndex: 'replace tubu_refresh_token with zmpEncode(tokens.refreshTokens[i]) for a new context',
        sessionStorage: {},
        interceptAlternative: {
          note: 'Parallel-safe alternative: fulfil POST {api}/auth/refresh yourself with this body (keep a dummy tubu_refresh_token in storage so the app calls refresh). Every other API call is real.',
          url: `${API_ORIGIN}/api/auth/refresh`,
          responseBody: { accessToken: jwt.token, refreshToken: 'audit-static-refresh', user: authUser },
          corsHeaders: { 'access-control-allow-origin': MINIAPP_ORIGIN, 'access-control-allow-credentials': 'true' },
        },
      },
      web: {
        origin: WEB_ORIGIN,
        localStorage: { tubu_web_session: '1' },
        sessionStorage: {},
        cookies: [
          { name: 'tubu_rt', value: pool[1], domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax', expires: Math.floor(expiresAt.getTime() / 1000) },
        ],
        cookieNote: 'HttpOnly refresh cookie normally set by the API (localhost:3201) — same-site with localhost:3212, sent by fetch(credentials:"include") to /api/auth/*. Use a DIFFERENT pool token than the miniapp.',
        interceptAlternative: {
          url: `${API_ORIGIN}/api/auth/refresh`,
          responseBody: { accessToken: jwt.token, refreshToken: '', user: { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl, role: user.role, pointsBalance: user.pointsBalance, walletBalance: user.walletBalance, referralCode: user.referralCode } },
          corsHeaders: { 'access-control-allow-origin': WEB_ORIGIN, 'access-control-allow-credentials': 'true' },
        },
      },
    });
  }
  const doc = {
    generatedAt: new Date().toISOString(),
    db: EXPECTED_DB,
    api: `${API_ORIGIN}/api`,
    miniapp: MINIAPP_ORIGIN,
    web: WEB_ORIGIN,
    warning: 'LOCAL TEST TOKENS for the isolated audit DB only (signed with the dedicated audit JWT secret in .audit/api.env). Re-running seed-audit-personas.ts revokes and re-mints them.',
    personas: out,
  };
  writeFileSync(path.join(OUT_DIR, 'personas.json'), JSON.stringify(doc, null, 2) + '\n');
  return out;
}

// ───────────────────────────── routes.json ─────────────────────────────
interface RouteCtx {
  productSlug: string; productSlugAlt: string; outOfStockSlug: string; ctvSlug: string; ctvSubdomain: string; dealerStoreSlug: string;
  brandSlug: string; brandSlugAlt: string; unpublishedBrandSlug: string; postId: string; showcasePostId: string; pendingPostId: string;
  courseId: string; courseId2: string; bankPaymentCode: string; dealerBankPaymentCode: string; orderCodes: Record<string, string>;
  ctvOrderForCustomer: string; dealerOrderCodes: Record<string, string>; recyclingAttentionOrder: string;
}
function buildRoutes(c: RouteCtx) {
  const ALL = ['guest', 'new_customer', 'active_customer', 'ctv', 'dealer', 'brand_owner', 'staff', 'admin'];
  const LOGGED = ALL.filter((p) => p !== 'guest');
  const oc = c.orderCodes;
  const miniapp = [
    { pattern: '/', personas: ALL, examples: ['/', `/?s=${c.ctvSlug}`, `/?ref=${P.ctv.referralCode}`] },
    { pattern: '/browse', personas: ALL, examples: ['/browse', '/browse?brand=Fuwa3e', '/browse?brand=Visante,Cobote', '/browse?segment=mom_baby', '/browse?focus=search'] },
    { pattern: '/product/:slug', personas: ALL, examples: [`/product/${c.productSlug}`, `/product/${c.productSlugAlt}`, `/product/${c.outOfStockSlug}`], notes: `${c.productSlug} has a live flash price + open group buy; ${c.productSlugAlt} has reviews; ${c.outOfStockSlug} has the sold-out "Can 5L" variation.` },
    { pattern: '/cart', personas: ALL, examples: ['/cart'], notes: 'active_customer and ctv have items; new_customer empty.' },
    { pattern: '/checkout', personas: ['active_customer', 'new_customer', 'ctv'], examples: ['/checkout'], notes: 'Reached from /cart; active_customer has 2 addresses + points + wallet + xu.' },
    { pattern: '/bank-payment/:code', personas: ['active_customer'], examples: [`/bank-payment/${c.bankPaymentCode}`], notes: 'PENDING_PAYMENT bank-transfer order (VietQR).' },
    { pattern: '/orders', personas: LOGGED, examples: ['/orders'], notes: 'Status tabs are local UI state (click them).' },
    { pattern: '/order/:code', personas: ['active_customer'], examples: Object.values(oc).map((code) => `/order/${code}`), orderCodesByStatus: oc, notes: 'One order per status + open return + recycling (Gomdon waybill) + XU-paid + VAT invoice requested.' },
    { pattern: '/order/:code (ctv)', personas: ['ctv'], examples: [`/order/${c.ctvOrderForCustomer}`], notes: 'CTV "lên đơn hộ khách" order.' },
    { pattern: '/game', personas: LOGGED, examples: ['/game'], notes: 'active_customer: streak 12, tree progress 410/600, extra plot, season pass.' },
    { pattern: '/feed', personas: ALL, examples: ['/feed'] },
    { pattern: '/feed/leaderboard', personas: ALL, examples: ['/feed/leaderboard'] },
    { pattern: '/feed/events', personas: ALL, examples: ['/feed/events'] },
    { pattern: '/feed/:id', personas: ALL, examples: [`/feed/${c.postId}`, `/feed/${c.showcasePostId}`], notes: 'Question with accepted expert answer + product tag; showcase entered in the open event.' },
    { pattern: '/ai-advisor', personas: LOGGED, examples: ['/ai-advisor'], notes: 'AI keys are blank in the audit env → graceful "not available" state.' },
    { pattern: '/group-buy', personas: LOGGED, examples: ['/group-buy'] },
    { pattern: '/refill', personas: LOGGED, examples: ['/refill'] },
    { pattern: '/beta', personas: LOGGED, examples: ['/beta'] },
    { pattern: '/profile', personas: ALL, examples: ['/profile'] },
    { pattern: '/loyalty', personas: LOGGED, examples: ['/loyalty'] },
    { pattern: '/wallet', personas: LOGGED, examples: ['/wallet'] },
    { pattern: '/addresses', personas: LOGGED, examples: ['/addresses'], notes: 'Add-address geo picker proxies Pancake → unavailable in audit env.' },
    { pattern: '/notifications', personas: LOGGED, examples: ['/notifications'] },
    { pattern: '/affiliate', personas: ['ctv', 'active_customer', 'admin'], examples: ['/affiliate'], notes: 'ctv = full dashboard; customers see the sign-up pitch.' },
    { pattern: '/academy', personas: ['ctv', 'admin'], examples: ['/academy'] },
    { pattern: '/academy/:courseId', personas: ['ctv', 'admin'], examples: [`/academy/${c.courseId}`, `/academy/${c.courseId2}`] },
    { pattern: '/cashback', personas: LOGGED, examples: ['/cashback'], notes: 'active_customer has PAID/CONFIRMED/PENDING cashback.' },
    { pattern: '/dealer', personas: ['dealer', 'active_customer'], examples: ['/dealer'], notes: 'dealer: tier DEALER_2, credit ledger, backorder, reward claims (PENDING/APPROVED/REJECTED/PAID); customers see the application form.' },
    { pattern: '/about', personas: ALL, examples: ['/about'] },
    { pattern: '/wishlist', personas: LOGGED, examples: ['/wishlist'] },
    { pattern: '/edit-profile', personas: LOGGED, examples: ['/edit-profile'] },
    { pattern: '/settings', personas: ALL, examples: ['/settings'] },
    { pattern: '/brand-story', personas: ALL, examples: ['/brand-story'] },
    { pattern: '/subscriptions', personas: LOGGED, examples: ['/subscriptions'], notes: 'active_customer: 1 ACTIVE + 1 PAUSED.' },
    { pattern: '/storefront', personas: ['ctv', 'admin'], examples: ['/storefront'], notes: 'Storefront builder (CTV).' },
    { pattern: '/s/:slug', personas: ALL, examples: [`/s/${c.ctvSlug}`, `/s/${c.ctvSubdomain}`, `/s/${c.dealerStoreSlug}`] },
    { pattern: '/brand/:slug', personas: ALL, examples: [`/brand/${c.brandSlug}`, `/brand/${c.brandSlugAlt}`, `/brand/${c.unpublishedBrandSlug}`], notes: `${c.unpublishedBrandSlug} is unpublished → not-found state.` },
    { pattern: '/brand-owner', personas: ['brand_owner', 'active_customer'], examples: ['/brand-owner'], notes: 'brand_owner owns Fuwa3e; others get "not granted".' },
    { pattern: '/admin', personas: ['admin', 'staff'], examples: ['/admin'], notes: 'HR admin (grants, shift approvals, attendance, payroll) — ADMIN only.' },
    { pattern: '/admin/community', personas: ['admin', 'staff'], examples: ['/admin/community'], notes: `Pending post ${c.pendingPostId} + 2 open reports.` },
    { pattern: '/staff', personas: ['staff', 'admin'], examples: ['/staff'] },
    { pattern: '/my-payroll', personas: ['staff', 'admin'], examples: ['/my-payroll'] },
    { pattern: '*', personas: ALL, examples: ['/khong-ton-tai'], notes: 'NotFound page.' },
  ];
  const ADMIN_TABS = ['dashboard', 'dealers', 'dealerClaims', 'orders', 'returns', 'cashback', 'posCredits', 'users', 'config', 'coupons', 'brands', 'merchantProducts', 'flashSales', 'faqs', 'contentKit', 'academy', 'quickReplies'];
  const web = [
    { pattern: '/', personas: ALL, examples: ['/'] },
    { pattern: '/san-pham/[slug]', personas: ALL, examples: [`/san-pham/${c.productSlug}`, `/san-pham/${c.productSlugAlt}`, '/san-pham/khong-ton-tai'] },
    { pattern: '/brand/[slug]', personas: ALL, examples: [`/brand/${c.brandSlug}`, `/brand/${c.brandSlugAlt}`] },
    { pattern: '/s/[slug]', personas: ALL, examples: [`/s/${c.ctvSlug}`, `/s/${c.dealerStoreSlug}`], subdomainVariant: `http://${c.ctvSubdomain}.localhost:3212/ (middleware rewrites / → /s/${c.ctvSubdomain})` },
    { pattern: '/gio-hang', personas: ALL, examples: ['/gio-hang'] },
    { pattern: '/thanh-toan', personas: ['active_customer', 'new_customer'], examples: ['/thanh-toan'] },
    { pattern: '/tai-khoan', personas: ALL, examples: ['/tai-khoan'] },
    { pattern: '/dang-nhap', personas: ['guest'], examples: ['/dang-nhap'], notes: 'Zalo OAuth start needs NEXT_PUBLIC_ZALO_APP_ID (unset in audit) → shows config error on click.' },
    { pattern: '/dang-nhap/callback', personas: ['guest'], examples: ['/dang-nhap/callback?code=invalid&state=x'], notes: 'Error state (state mismatch).' },
    { pattern: '/merchant', personas: ['ctv', 'dealer', 'admin', 'active_customer'], examples: ['/merchant'], notes: 'DEALER/AFFILIATE/ADMIN only; customer sees access notice.' },
    { pattern: '/admin', personas: ['admin', 'staff', 'active_customer'], examples: ['/admin', ...ADMIN_TABS.filter((t) => t !== 'dashboard').map((t) => `/admin?tab=${t}`), '/admin?tab=orders&recycling=attention', '/admin?tab=orders&recycling=all'], tabs: ADMIN_TABS, notes: `ADMIN only (staff/customer see "no permission"). Recycling attention order: ${c.recyclingAttentionOrder}.` },
    { pattern: '/admin/pos', personas: ['staff', 'admin'], examples: ['/admin/pos'], notes: 'POS enabled in audit config (loyalty.pos_credit_enabled=true). Member code for active_customer: TUBU' + P.active_customer.referralCode },
    { pattern: '/robots.txt', personas: ['guest'], examples: ['/robots.txt'] },
    { pattern: '/sitemap.xml', personas: ['guest'], examples: ['/sitemap.xml'] },
    { pattern: 'not-found', personas: ['guest'], examples: ['/trang-khong-ton-tai'] },
  ];
  const doc = {
    generatedAt: new Date().toISOString(),
    miniappBase: MINIAPP_ORIGIN,
    webBase: WEB_ORIGIN,
    apiBase: `${API_ORIGIN}/api`,
    notes: [
      'Use hostname "localhost" (not 127.0.0.1): zmp-sdk storage and the web refresh cookie both depend on it.',
      'Miniapp routes come from apps/miniapp/src/components/app.tsx (41 paths + "*" catch-all = 42 <Route>s; /order/:code is listed twice here for the ctv variant).',
      'Web routes come from apps/web/src/app/** (page.tsx files + robots/sitemap + not-found).',
      'Query variants: /admin?tab=<tab> for every admin tab, /admin?tab=orders&recycling=attention|all.',
    ],
    params: c,
    miniapp,
    web,
  };
  writeFileSync(path.join(OUT_DIR, 'routes.json'), JSON.stringify(doc, null, 2) + '\n');
  return { miniapp, web };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
