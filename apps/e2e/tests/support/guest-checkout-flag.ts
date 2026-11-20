import type { APIRequestContext } from '@playwright/test';
import { createHmac } from 'crypto';
import path from 'path';
import { seedDatabaseUrl } from './a11y-db';
import { parseEnvFile } from './env-file';
import { writableTempDb } from './waste-db';

/**
 * Cờ `web.guest_checkout_enabled` ở PHÍA MÁY CHỦ cho spec đặt hàng không đăng nhập. Layout `/don/[code]` đọc cờ từ API thật lúc dựng trang (mock của
 * trình duyệt không chạm tới) và trả 404 khi cờ tắt; seed để cờ tắt. Ghi qua `PUT /api/admin/config` thay vì ghi thẳng DB: đường đó xoá đệm 60 giây
 * của SystemConfigService, nên lần dựng trang ngay sau đã thấy cờ mới. Chỉ chạy trên DB tạm (web-gate.sh hoặc job CI); DB khác thì không ghi gì.
 *
 * Spec bật cờ đúng lúc cần trang `/don` và tắt lại sau ca: `/thanh-toan` đọc cờ ở máy chủ với đệm 60 giây, bật suốt ca thì bản đệm mang cờ bật có thể
 * lọt sang ca "cờ tắt" và các spec khác.
 */
const KEY = 'web.guest_checkout_enabled';
const ADMIN_ID = 'e2e-guest-flag-admin';
const API = `http://localhost:${process.env.E2E_API_PORT}/api`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prisma = any;

function prismaFor(url: string): Prisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  return new PrismaClient({ datasources: { db: { url } } });
}

function signAdminToken(): string | null {
  const secret = process.env.JWT_ACCESS_SECRET ?? parseEnvFile(path.resolve(__dirname, '../../../api/.env'))['JWT_ACCESS_SECRET'] ?? '';
  if (secret.length < 16) return null;
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

let token: string | null | undefined;

/** Tài khoản ADMIN riêng của spec trong DB tạm (tạo trước lần gọi API đầu: API nhớ trạng thái phiên theo id). null khi không phải DB tạm. */
async function adminToken(): Promise<string | null> {
  if (token !== undefined) return token;
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return (token = null);
  const prisma = prismaFor(url);
  try {
    await prisma.user.upsert({
      where: { id: ADMIN_ID },
      update: { role: 'ADMIN', isBlocked: false },
      create: { id: ADMIN_ID, role: 'ADMIN', fullName: 'E2E cờ đặt hàng khách', referralCode: 'E2EGFLAG' },
    });
  } finally {
    await prisma.$disconnect();
  }
  return (token = signAdminToken());
}

/**
 * Ca có thể bật cờ ở máy chủ: DB tạm, có khoá ký JWT, và chạy MỘT worker (web-gate.sh và CI đặt `CI` nên playwright.config cho 1 worker). Cờ là dữ
 * liệu dùng chung của cả lượt chạy: nhiều worker thì lần tắt cờ cuối ca này có thể rơi đúng lúc ca khác đang mở `/don`. Không ghi gì.
 */
export async function serverGuestCheckoutReady(workers: number): Promise<boolean> {
  return workers === 1 && (await adminToken()) !== null;
}

/**
 * Đặt cờ ở máy chủ và chờ `/config/public` trả đúng giá trị. `false` khi không ghi được (không phải DB tạm, thiếu khoá ký JWT): ca cần cờ bật ở máy
 * chủ thì bỏ qua thay vì đỏ giả.
 */
export async function setServerGuestCheckout(request: APIRequestContext, on: boolean): Promise<boolean> {
  const t = await adminToken();
  if (!t) return false;
  const res = await request.put(`${API}/admin/config`, { headers: { Authorization: `Bearer ${t}` }, data: { key: KEY, value: on } });
  if (!res.ok()) throw new Error(`PUT /admin/config ${KEY}=${on}: ${res.status()} ${await res.text()}`);
  const pub = await request.get(`${API}/config/public`);
  const body = (await pub.json()) as { webGuestCheckoutEnabled?: unknown };
  if ((body.webGuestCheckoutEnabled === true) !== on) throw new Error(`/config/public chưa thấy ${KEY}=${on}`);
  return true;
}
