// Thư viện chung của bộ khung UAT: cấu hình lane, env lane, Prisma của apps/api, ký JWT, gọi API lane.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HARNESS = path.dirname(fileURLToPath(import.meta.url));
export const WT = path.resolve(HARNESS, '../../../..');
export const API_DIR = path.join(WT, 'apps/api');
export const STATE = path.join(HARNESS, 'state');
export const PG_PORT = 25432;
export const REDIS_PORT = 26379;

const requireApi = createRequire(path.join(API_DIR, 'package.json'));

/**
 * Lane 1..8 (6 agent chọn 6 lane có cổng trống: lane 2 = 3221-3223 trùng API/web/Vite UAT đang chạy); lane 9 chỉ để dựng DB mẫu
 * (cổng 3291/3298). Redis của lane 9 là db 15, không phải 9: API perf (3229)
 * của phiên khác đang dùng db 9, và hai API chung một db Redis thì worker BullMQ của bên này nhận job của bên kia.
 */
export function lane(n) {
  const N = Number(n);
  if (!Number.isInteger(N) || N < 1 || N > 9) {
    throw new Error(`lane phải là 1..8 (hoặc 9 = dựng mẫu), nhận "${n}"`);
  }
  const base = 3200 + N * 10;
  const db = N === 9 ? 'tubutree_uat_tpl' : `tubutree_uat_l${N}`;
  const dir = path.join(STATE, `lane-${N}`);
  return {
    n: N,
    apiPort: base + 1,
    webPort: base + 2,
    miniPort: base + 3,
    pancakePort: base + 8,
    db,
    redisDb: N === 9 ? 15 : N,
    dir,
    envFile: path.join(dir, 'lane.env'),
    pancakeDir: path.join(dir, 'pancake'),
    logDir: path.join(dir, 'logs'),
    apiUrl: `http://localhost:${base + 1}/api`,
    apiUrl127: `http://127.0.0.1:${base + 1}/api`,
    webUrl: `http://localhost:${base + 2}`,
    miniUrl: `http://localhost:${base + 3}`,
    pancakeUrl: `http://127.0.0.1:${base + 8}`,
    databaseUrl: `postgresql://tubu@127.0.0.1:${PG_PORT}/${db}?schema=public`,
  };
}

/** Chỉ DB của lane hoặc DB mẫu: chặn mọi công cụ ghi nhầm vào tubutree_uat (API 3221) hay DB dùng chung. */
export function assertLaneDb(url) {
  const m = /^postgresql:\/\/[^@]+@127\.0\.0\.1:25432\/(tubutree_uat_l[1-8]|tubutree_uat_tpl)(\?|$)/.exec(url);
  if (!m) throw new Error(`Từ chối DB không phải tubutree_uat_l1..8/tubutree_uat_tpl trên 127.0.0.1:25432: ${url}`);
  return m[1];
}

/** Đọc file env dạng KEY=VALUE (không hỗ trợ xuống dòng trong giá trị — env lane không cần). */
export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const hex = (n) => randomBytes(n).toString('hex');

/**
 * Env riêng của lane: secret JWT/webhook riêng, Pancake trỏ giả, mọi tích hợp ra ngoài (Zalo OA, Gomdon, ZaloPay, AccessTrade, LLM)
 * tắt bằng giá trị rỗng. process.env thắng apps/api/.env trong ConfigModule nên các khoá ở đây đè được .env của worktree.
 * Secret giữ nguyên qua các lần lane-up (token đã ký vẫn hợp lệ), chỉ sinh khi file chưa có.
 */
export function ensureLaneEnv(L) {
  fs.mkdirSync(L.dir, { recursive: true });
  const prev = parseEnvFile(L.envFile);
  const keep = (k, gen) => prev[k] || gen();
  const env = {
    NODE_ENV: 'development',
    PORT: String(L.apiPort),
    DATABASE_URL: L.databaseUrl,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}/${L.redisDb}`,
    CORS_ORIGINS: '',
    JWT_ACCESS_SECRET: keep('JWT_ACCESS_SECRET', () => `uat-l${L.n}-access-${hex(24)}`),
    JWT_REFRESH_SECRET: keep('JWT_REFRESH_SECRET', () => `uat-l${L.n}-refresh-${hex(24)}`),
    PANCAKE_BASE_URL: `${L.pancakeUrl}/api/v1`,
    PANCAKE_API_KEY: `uat-fake-pancake-key-l${L.n}`,
    PANCAKE_SHOP_ID: `uatshop${L.n}`,
    PANCAKE_WEBHOOK_SECRET: keep('PANCAKE_WEBHOOK_SECRET', () => `uat-l${L.n}-pancake-${hex(16)}`),
    ZALO_OA_WEBHOOK_SECRET: keep('ZALO_OA_WEBHOOK_SECRET', () => `uat-l${L.n}-zalooa-${hex(16)}`),
    GOMDON_WEBHOOK_SECRET: keep('GOMDON_WEBHOOK_SECRET', () => `uat-l${L.n}-gomdon-${hex(16)}`),
    ACCESSTRADE_WEBHOOK_SECRET: keep('ACCESSTRADE_WEBHOOK_SECRET', () => `uat-l${L.n}-at-${hex(16)}`),
    THROTTLE_BYPASS_TOKEN: keep('THROTTLE_BYPASS_TOKEN', () => `uat-l${L.n}-throttle-${hex(20)}`),
    // Cookie refresh của web phải thuộc host localhost (web 32N2 và API 32N1 cùng site): domain của .env worktree sẽ làm
    // trình duyệt bỏ Set-Cookie sau lần xoay đầu tiên.
    AUTH_COOKIE_DOMAIN: '',
    AUTH_COOKIE_SAMESITE: 'lax',
    // Tích hợp thật ra ngoài: tắt (rỗng) để lane không bao giờ gọi Zalo/Gomdon/ZaloPay/AccessTrade/LLM thật.
    ZALO_APP_SECRET: '',
    ZALO_OA_ACCESS_TOKEN: '',
    ZALO_OA_REFRESH_TOKEN: '',
    GOMDON_PHONE: '',
    GOMDON_PASSWORD: '',
    GOMDON_BASE_URL: `${L.pancakeUrl}/gomdon-disabled`,
    ZALOPAY_APP_ID: '',
    ACCESSTRADE_TOKEN: '',
    DEEPSEEK_API_KEY: '',
    GEMINI_API_KEY: '',
  };
  const body = [
    `# Env lane ${L.n} (sinh bởi uat-harness/lib.mjs ensureLaneEnv). Secret chỉ dùng cho UAT cục bộ.`,
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');
  fs.writeFileSync(L.envFile, body, { mode: 0o600 });
  return env;
}

export function laneEnv(L) {
  const env = parseEnvFile(L.envFile);
  if (!env.JWT_ACCESS_SECRET) throw new Error(`Lane ${L.n} chưa có ${L.envFile} — chạy lane-up.sh ${L.n} trước.`);
  return env;
}

let prismaCache = new Map();
/** PrismaClient của apps/api (đúng schema đang chạy), trỏ DB lane. */
export function prismaFor(L) {
  assertLaneDb(L.databaseUrl);
  if (prismaCache.has(L.n)) return prismaCache.get(L.n);
  const { PrismaClient } = requireApi('@prisma/client');
  const p = new PrismaClient({ datasources: { db: { url: L.databaseUrl } } });
  prismaCache.set(L.n, p);
  return p;
}

export async function closePrisma() {
  for (const p of prismaCache.values()) await p.$disconnect().catch(() => undefined);
  prismaCache = new Map();
}

export function requireFromApi(id) {
  return requireApi(id);
}

/** ioredis lấy qua bullmq của apps/api (apps/api không khai ioredis trực tiếp). */
export function redisFor(L) {
  const bullmq = requireApi.resolve('bullmq');
  const Redis = createRequire(bullmq)('ioredis');
  return new Redis({ host: '127.0.0.1', port: REDIS_PORT, db: L.redisDb, lazyConnect: false, maxRetriesPerRequest: 2 });
}

const b64url = (b) => Buffer.from(b).toString('base64url');

/** HS256 giống @nestjs/jwt: payload như AuthService.issueTokens (sub, role, zaloId, affiliateEnabled, dealerEnabled). */
export function signAccess(secret, user, ttlSec = 12 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    role: user.role,
    ...(user.zaloId ? { zaloId: user.zaloId } : {}),
    affiliateEnabled: user.role === 'AFFILIATE' || user.role === 'ADMIN',
    dealerEnabled: user.role === 'DEALER',
    iat: now,
    exp: now + ttlSec,
  };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function toAuthUser(u) {
  return {
    id: u.id,
    zaloId: u.zaloId,
    phone: u.phone,
    email: u.email,
    fullName: u.fullName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    tierId: u.tierId,
    referralCode: u.referralCode,
    pointsBalance: u.pointsBalance,
    pointsConvertedBalance: u.pointsConvertedBalance,
    walletBalance: u.walletBalance,
  };
}

/** Tìm user theo id, zaloId, SĐT hoặc bí danh vai trò (vd "returning" → id uat_returning). */
export async function findUser(L, key) {
  const prisma = prismaFor(L);
  const k = String(key).trim();
  const alias = k.startsWith('uat_') ? k : `uat_${k.replace(/-/g, '_')}`;
  const u =
    (await prisma.user.findUnique({ where: { id: k } })) ??
    (await prisma.user.findUnique({ where: { id: alias } })) ??
    (await prisma.user.findUnique({ where: { zaloId: k } })) ??
    (/^0\d{9}$/.test(k) ? await prisma.user.findUnique({ where: { phone: k } }) : null);
  if (!u) throw new Error(`Lane ${L.n}: không thấy user "${key}" (id/zaloId/SĐT/bí danh)`);
  return u;
}

/**
 * Refresh token THẬT: chèn dòng refresh_tokens (sha256 như AuthService.hashToken). Đổi được ở POST /auth/refresh của lane, nên
 * phiên trình duyệt đi đúng đường cấp token của API (issueTokens: chặn tài khoản khoá, applyGrants, liên kết điểm đơn chat).
 */
export async function mintRefresh(L, userId, ttlDays = 30) {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await prismaFor(L).refreshToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + ttlDays * 86_400_000) },
  });
  return token;
}

/** Access token ký tại chỗ bằng secret lane (không qua API) — cho curl/script. */
export async function mintAccessFor(L, key, ttlSec) {
  const u = await findUser(L, key);
  return { token: signAccess(laneEnv(L).JWT_ACCESS_SECRET, u, ttlSec), user: u };
}

/** LoginResponse do CHÍNH API lane cấp: chèn refresh token rồi đổi ở /auth/refresh. */
export async function realLogin(L, key, { web = false } = {}) {
  const u = await findUser(L, key);
  const rt = await mintRefresh(L, u.id);
  const res = await fetch(`${L.apiUrl127}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(web ? { 'x-client': 'web' } : {}) },
    body: JSON.stringify({ refreshToken: rt }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, setCookie: res.headers.get('set-cookie'), user: u };
}

/** Gọi API lane. token: chuỗi JWT hoặc bí danh user (tự ký). Luôn kèm x-throttle-bypass để script không dính 429. */
export async function api(L, method, p, { token, user, body, headers = {}, bypass = true } = {}) {
  let auth = token;
  if (!auth && user) auth = (await mintAccessFor(L, user)).token;
  const env = laneEnv(L);
  const res = await fetch(`${L.apiUrl127}${p.startsWith('/') ? p : `/${p}`}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(bypass && env.THROTTLE_BYPASS_TOKEN ? { 'x-throttle-bypass': env.THROTTLE_BYPASS_TOKEN } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json };
}

/** Như api() nhưng ném khi không 2xx — dùng trong seed/ca mẫu. */
export async function apiOk(L, method, p, opts) {
  const r = await api(L, method, p, opts);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  return r.body;
}

export function jsonOut(v) {
  process.stdout.write(`${JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x), 2)}\n`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Playwright của apps/e2e (không cài thêm gói). */
export function playwright() {
  const req = createRequire(path.join(WT, 'apps/e2e/package.json'));
  return req('@playwright/test');
}
